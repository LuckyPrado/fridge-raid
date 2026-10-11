"""Talking to the party: the player says what they want and an agent updates their preferences.

The model only proposes changes through a fixed schema. Every value is clamped by apply_draft
before it is saved, so a strange reply cannot write a strange profile.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Callable, Iterable, Literal, get_args

from app.catalog import normalize_name
from app.llm import LLM, LLMError
from app.schemas import MAX_AVOID, MAX_FAVORITES, ChatDraft, Diet, Goals, Profile

logger = logging.getLogger(__name__)

AgentName = Literal["chef", "nutritionist", "bargain_hunter"]

NO_CHANGE = -1
MAX_REPLY_CHARS = 400
MAX_FOOD_CHARS = 30
MAX_WATER_PER_MESSAGE = 8
DIETS: tuple[str, ...] = get_args(Diet)

PERSONAS: dict[str, str] = {
    "chef": "You are the Chef: bold, dramatic, obsessed with using food before it spoils. "
    "You care most about favorite foods, foods to avoid, the diet, and how many dinners to plan.",
    "nutritionist": "You are the Nutritionist: precise, a little stern, kind underneath. "
    "You care most about daily calories, daily protein, and the per-meal calorie and sodium limits.",
    "bargain_hunter": "You are the Shopper: thrifty and smug about a good deal. You care most about the weekly budget.",
}

CHAT_RULES = f"""You are one of three AI agents in a meal-planning app, talking with the player.
Read the player's message, update their preferences when they ask for a change, and answer in character.

Rules for the fields you return:
- "reply": at most 2 short sentences, in character. Say what you changed, or answer the question. No medical advice.
- Number fields: use {NO_CHANGE} when the player did not ask to change that value.
- "diet": one of none, vegetarian, vegan, pescatarian, kosher, halal, or an empty string for no change.
- "name": the player's first name if they just told you it, otherwise an empty string.
- "add_favorites" and "add_avoid": short lowercase food names, singular, only ones the player named.
- "remove_favorites" and "remove_avoid": foods the player wants taken off those lists.
- A food the player dislikes, cannot eat, or is allergic to goes in "add_avoid".
- "add_to_grocery": foods the player asked you to put on their grocery or shopping list. Otherwise empty.
- "remove_from_grocery": foods the player asked you to take off that list. Otherwise empty.
- "swap_recipe": true only when the player asks for a new, different or additional recipe.
- "add_water": glasses of water the player says they just drank, otherwise 0.
- Change only what the player asked for. Never invent preferences."""


def _profile_lines(profile: Profile) -> str:
    goals = profile.goals
    return (
        f"Name: {profile.name or 'not given'}. Diet: {goals.diet}. Weekly budget: ${goals.budget:.2f}. "
        f"Dinners to plan: {goals.meals}. Daily goals: {goals.daily_calories} kcal, {goals.daily_protein_g} g protein. "
        f"Per meal: at most {goals.max_calories} kcal and {goals.max_sodium_mg} mg sodium. "
        f"Favorite foods: {', '.join(goals.favorites) or 'none'}. Foods to avoid: {', '.join(goals.avoid) or 'none'}."
    )


def _foods(names: Iterable[str]) -> list[str]:
    cleaned = (" ".join(re.sub(r"[^a-z ]", " ", name.lower()).split())[:MAX_FOOD_CHARS] for name in names)
    return [name for name in dict.fromkeys(cleaned) if name]


def _merge(current: tuple[str, ...], add: Iterable[str], remove: Iterable[str], limit: int) -> tuple[str, ...]:
    removed = {normalize_name(name) for name in _foods(remove)}
    kept = [name for name in current if normalize_name(name) not in removed]
    seen = {normalize_name(name) for name in kept}
    for name in _foods(add):
        if normalize_name(name) not in seen:
            kept.append(name)
            seen.add(normalize_name(name))
    return tuple(kept[-limit:])


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _number_updates(draft: ChatDraft, goals: Goals) -> tuple[dict[str, float | int], list[str]]:
    specs: tuple[tuple[str, float, float, float, str], ...] = (
        ("budget", draft.budget, 0, 500, "Weekly budget ${:.2f}"),
        ("meals", draft.meals, 1, 7, "{:.0f} dinners per plan"),
        ("daily_calories", draft.daily_calories, 800, 6000, "{:.0f} kcal a day"),
        ("daily_protein_g", draft.daily_protein_g, 10, 400, "{:.0f} g protein a day"),
        ("max_calories", draft.max_calories, 200, 3000, "Up to {:.0f} kcal per meal"),
        ("max_sodium_mg", draft.max_sodium_mg, 100, 5000, "Up to {:.0f} mg sodium per meal"),
    )
    updates: dict[str, float | int] = {}
    changes: list[str] = []
    for field, asked, low, high, label in specs:
        if asked < 0:
            continue
        value = _clamp(asked, low, high)
        value = round(value, 2) if field == "budget" else int(round(value))
        if value != getattr(goals, field):
            updates[field] = value
            changes.append(label.format(value))
    return updates, changes


def apply_draft(profile: Profile, draft: ChatDraft) -> tuple[Profile, list[str]]:
    """Fold the agent's proposed changes into the profile. Returns the new profile and what changed."""
    goals = profile.goals
    updates, changes = _number_updates(draft, goals)

    diet = draft.diet.strip().lower()
    if diet in DIETS and diet != goals.diet:
        updates["diet"] = diet
        changes.append("No diet restriction" if diet == "none" else f"Diet: {diet}")

    avoid = _merge(goals.avoid, draft.add_avoid, draft.remove_avoid, MAX_AVOID)
    avoided = {normalize_name(name) for name in avoid}
    # A food cannot be both a favorite and avoided. The newer request to avoid it wins.
    still_liked = [name for name in draft.add_favorites if normalize_name(name) not in avoided]
    dropped = [*draft.remove_favorites, *(name for name in goals.favorites if normalize_name(name) in avoided)]
    favorites = _merge(goals.favorites, still_liked, dropped, MAX_FAVORITES)
    if avoid != goals.avoid:
        updates["avoid"] = avoid
        changes.append(f"Avoiding: {', '.join(avoid)}" if avoid else "Nothing to avoid")
    if favorites != goals.favorites:
        updates["favorites"] = favorites
        changes.append(f"Favorites: {', '.join(favorites)}" if favorites else "No favorites")

    name = " ".join(draft.name.split())[:24]
    renamed = bool(name) and name != profile.name
    if renamed:
        changes.append(f"Name: {name}")
    updated = profile.model_copy(
        update={"goals": goals.model_copy(update=updates), "name": name if renamed else profile.name}
    )
    return Profile.model_validate(updated.model_dump()), changes


def _blank_draft() -> ChatDraft:
    return ChatDraft(
        reply="", name="", diet="", budget=NO_CHANGE, meals=NO_CHANGE, daily_calories=NO_CHANGE,
        daily_protein_g=NO_CHANGE, max_calories=NO_CHANGE, max_sodium_mg=NO_CHANGE,
        add_favorites=[], remove_favorites=[], add_avoid=[], remove_avoid=[], add_to_grocery=[],
        remove_from_grocery=[], swap_recipe=False, add_water=0,
    )


_FOOD_LIST = r"([a-z][a-z ,&]*?)(?:[.!?;]|$| and i | i | but | because | so | please)"
_AVOID = re.compile(r"(?:hate|dislike|allergic to|avoid|can(?:no|')t eat|don'?t (?:like|eat|want)|no more|\bno)\s+" + _FOOD_LIST)
_LIKE = re.compile(r"(?:love|like|favorite (?:food )?(?:is|are)|enjoy|crave|more)\s+" + _FOOD_LIST)
_NUMBER = r"\$?\s*(\d+(?:\.\d+)?)"
_UNGROCERY = re.compile(r"(?:remove|take|delete)\s+(.+?)\s+(?:from|off)\s+(?:my |the )?(?:grocery |shopping )?list")
_SWAP = re.compile(
    r"(?:different|another|new|other|swap|change|replace)\b.{0,30}\b(?:recipe|dish|meal|dinner|idea)|something else|"
    r"(?:don'?t|do not) (?:like|want) (?:that|this|it)"
)
_WATER = re.compile(r"(?:drank|had|log|add)\s+(\d+|a|an|one|two|three|four)?\s*(?:more )?(?:glass(?:es)?|cups?)(?: of water)?|drank water")
WATER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4}
_GROCERY = re.compile(r"(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my |the )?(?:grocery |shopping )?list")


def _split_foods(text: str) -> list[str]:
    parts = re.split(r",|&| and | or ", text)
    return [part.strip().removeprefix("any ").removeprefix("the ") for part in parts if part.strip()]


def _first_number(pattern: str, text: str) -> float:
    match = re.search(pattern, text)
    return float(match.group(1)) if match else NO_CHANGE


def offline_draft(message: str) -> ChatDraft:
    """Rule-based reading of the message, used with no model key or when the model call fails."""
    text = " ".join(message.lower().split())
    draft = _blank_draft()
    draft.budget = _first_number(r"budget\D{0,12}" + _NUMBER, text)
    if draft.budget == NO_CHANGE:
        draft.budget = _first_number(r"\$\s*(\d+(?:\.\d+)?)", text)
    draft.daily_protein_g = int(_first_number(r"(\d+)\s*(?:g|grams?)?\s*(?:of )?protein", text))
    draft.daily_calories = int(_first_number(r"(\d{3,4})\s*(?:k?cal|calories)", text))
    draft.meals = int(_first_number(r"(\d)\s*(?:dinners|meals)", text))
    for diet in ("vegetarian", "vegan", "pescatarian", "kosher", "halal"):
        if diet in text:
            draft.diet = "none" if re.search(rf"(?:not|no longer|stop being) {diet}", text) else diet
    unlisted = _UNGROCERY.search(text)
    if unlisted:
        draft.remove_from_grocery = _split_foods(unlisted.group(1))
        return draft
    listed = _GROCERY.search(text)
    if listed:
        draft.add_to_grocery = _split_foods(listed.group(1))
        return draft
    if _SWAP.search(text):
        draft.swap_recipe = True
        return draft
    drank = _WATER.search(text)
    if drank:
        draft.add_water = WATER_WORDS.get(drank.group(1) or "a", 1) if not (drank.group(1) or "").isdigit() else int(drank.group(1))
        return draft
    avoid_matches = list(_AVOID.finditer(text))
    draft.add_avoid = [food for match in avoid_matches for food in _split_foods(match.group(1))]
    liked_text = text
    for match in avoid_matches:
        liked_text = liked_text.replace(match.group(0), " ")
    draft.add_favorites = [food for match in _LIKE.finditer(liked_text) for food in _split_foods(match.group(1))]
    return draft


@dataclass(frozen=True)
class ChatFacts:
    """What the agents can look up to answer a question without the live model."""

    next_dish: str = ""
    next_dish_minutes: int = 0
    use_soon: tuple[str, ...] = ()
    calories: int = 0
    protein_g: int = 0
    plan_cost: float | None = None
    store: str = ""
    price_of: Callable[[str], str | None] = lambda name: None


@dataclass(frozen=True)
class ChatOutcome:
    reply: str
    profile: Profile
    changes: list[str]
    grocery: list[str]
    ungrocery: list[str] = field(default_factory=list)
    swap_recipe: bool = False
    water: int = 0


HELP_LINES: dict[str, str] = {
    "chef": "I did not catch that. Ask me what to cook tonight, ask for a different recipe, "
    "or tell me foods you love or will not eat.",
    "nutritionist": "I did not catch that. Ask how your day is going, tell me you drank a glass of water, "
    "or set a goal like 120 g of protein.",
    "bargain_hunter": "I did not catch that. Ask what milk costs, tell me to add eggs to your list, "
    "or set a budget like $40.",
}

CONFIRM_LINES: dict[str, str] = {
    "chef": "Noted! {changes}. I will cook around it next time we plan.",
    "nutritionist": "Updated. {changes}. I will hold every meal to it.",
    "bargain_hunter": "Done. {changes}. Watch me make it stretch.",
}

_PRICE_QUESTION = re.compile(
    r"(?:how much (?:is|are|for|does)|price of|cost of|where (?:can i|do i|to) (?:buy|get|find)|cheapest)\s+"
    r"(?:the |some |a |an )?([a-z][a-z ]*?)(?: cost| costs)?(?:[?.!]|$)"
)


def _chef_answer(text: str, facts: ChatFacts) -> str | None:
    if re.search(r"expir|use first|going bad|spoil|use soon", text):
        if not facts.use_soon:
            return "Nothing in your fridge is close to spoiling. Lovely."
        return f"Use the {', '.join(facts.use_soon[:4])} first. They are on the clock."
    if re.search(r"cook|make|eat|tonight|dinner|recipe|hungry", text):
        if not facts.next_dish:
            return "Scan your fridge and I will have dinner planned in a minute."
        return f"Tonight I would make {facts.next_dish}. It takes {facts.next_dish_minutes} minutes."
    return None


def _nutritionist_answer(text: str, facts: ChatFacts, goals: Goals) -> str | None:
    if not re.search(r"how am i|protein|calorie|kcal|left|on track|today|doing|goal", text):
        return None
    protein_left = max(0, goals.daily_protein_g - facts.protein_g)
    calories_left = goals.daily_calories - facts.calories
    energy = f"{calories_left} kcal left" if calories_left >= 0 else f"{-calories_left} kcal over"
    return (
        f"Today you are at {facts.calories} of {goals.daily_calories} kcal and {facts.protein_g} of "
        f"{goals.daily_protein_g} g protein. That is {energy} and {protein_left} g of protein to go."
    )


def _shopper_answer(text: str, facts: ChatFacts, goals: Goals) -> str | None:
    asked = _PRICE_QUESTION.search(text)
    if asked:
        found = facts.price_of(asked.group(1).strip())
        if found:
            return found
    if re.search(r"budget|spend|cost|total|afford", text):
        if facts.plan_cost is None:
            return f"Your budget is ${goals.budget:.2f} a week. Nothing is planned yet, so nothing is spent."
        left = max(0.0, goals.budget - facts.plan_cost)
        return f"Your plan costs ${facts.plan_cost:.2f} of your ${goals.budget:.2f} budget. ${left:.2f} stays in reserve."
    if re.search(r"store|deal|where|shop", text):
        if facts.store:
            return f"Your best stop this week is {facts.store}. I priced your whole list there."
        return "Share your location on the Shop tab and I will compare the stores around you."
    return None


def offline_answer(agent: str, message: str, facts: ChatFacts, goals: Goals) -> str | None:
    """Answer a question from saved facts. The agent asked goes first, then the other two."""
    text = " ".join(message.lower().split())
    answers = {
        "chef": lambda: _chef_answer(text, facts),
        "nutritionist": lambda: _nutritionist_answer(text, facts, goals),
        "bargain_hunter": lambda: _shopper_answer(text, facts, goals),
    }
    for name in (agent, *(other for other in answers if other != agent)):
        answer = answers[name]()
        if answer:
            return answer
    return None


def offline_reply(changes: list[str], agent: str = "bargain_hunter") -> str:
    if not changes:
        return HELP_LINES[agent]
    return CONFIRM_LINES[agent].format(changes=". ".join(changes))


def _offline_outcome(agent: str, message: str, profile: Profile, facts: ChatFacts) -> ChatOutcome:
    draft = offline_draft(message)
    updated, changes = apply_draft(profile, draft)
    grocery = _foods(draft.add_to_grocery)
    ungrocery = _foods(draft.remove_from_grocery)
    water = max(0, min(MAX_WATER_PER_MESSAGE, draft.add_water))
    if changes:
        reply = offline_reply(changes, agent)
    elif grocery or ungrocery:
        reply = "On it."
    elif draft.swap_recipe:
        reply = "One more idea, coming up."
    elif water:
        reply = "Good. Water counts."
    else:
        reply = offline_answer(agent, message, facts, profile.goals) or HELP_LINES[agent]
    return ChatOutcome(
        reply=reply, profile=updated, changes=changes, grocery=grocery,
        ungrocery=ungrocery, swap_recipe=draft.swap_recipe, water=water,
    )


async def converse_full(
    llm: LLM | None, agent: str, message: str, profile: Profile, facts: ChatFacts | None = None
) -> ChatOutcome:
    """One turn of conversation, including any items the player asked to put on the grocery list."""
    facts = facts or ChatFacts()
    draft: ChatDraft | None = None
    if llm is not None:
        prompt = (
            f"The player's current preferences:\n{_profile_lines(profile)}\n\n"
            f"What you know right now: next planned dinner: {facts.next_dish or 'none'}; "
            f"food to use soon: {', '.join(facts.use_soon) or 'none'}; eaten today: {facts.calories} kcal and "
            f"{facts.protein_g} g protein; chosen store: {facts.store or 'none'}.\n\n"
            f"The player says:\n{message}"
        )
        try:
            draft = await llm.generate(
                system=f"{PERSONAS[agent]}\n\n{CHAT_RULES}", prompt=prompt, schema=ChatDraft, temperature=0.6
            )
        except LLMError:
            logger.warning("Chat fell back to the rule-based reader.")
    if draft is None:
        return _offline_outcome(agent, message, profile, facts)
    updated, changes = apply_draft(profile, draft)
    reply = " ".join(draft.reply.split())[:MAX_REPLY_CHARS] or offline_reply(changes, agent)
    return ChatOutcome(
        reply=reply, profile=updated, changes=changes, grocery=_foods(draft.add_to_grocery),
        ungrocery=_foods(draft.remove_from_grocery), swap_recipe=draft.swap_recipe,
        water=max(0, min(MAX_WATER_PER_MESSAGE, draft.add_water)),
    )


async def converse(llm: LLM | None, agent: str, message: str, profile: Profile) -> tuple[str, Profile, list[str]]:
    """One turn of conversation. Returns the reply, the updated profile, and the list of changes."""
    outcome = await converse_full(llm, agent, message, profile)
    return outcome.reply, outcome.profile, outcome.changes
