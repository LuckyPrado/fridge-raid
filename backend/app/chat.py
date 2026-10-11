"""Talking to the party: the player says what they want and an agent updates their preferences.

The model only proposes changes through a fixed schema. Every value is clamped by apply_draft
before it is saved, so a strange reply cannot write a strange profile.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable, Literal, get_args

from app.catalog import normalize_name
from app.llm import LLM, LLMError
from app.schemas import MAX_AVOID, MAX_FAVORITES, ChatDraft, Diet, Goals, Profile

logger = logging.getLogger(__name__)

AgentName = Literal["chef", "nutritionist", "bargain_hunter"]

NO_CHANGE = -1
MAX_REPLY_CHARS = 400
MAX_FOOD_CHARS = 30
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
- "diet": one of none, vegetarian, vegan, pescatarian, or an empty string for no change.
- "name": the player's first name if they just told you it, otherwise an empty string.
- "add_favorites" and "add_avoid": short lowercase food names, singular, only ones the player named.
- "remove_favorites" and "remove_avoid": foods the player wants taken off those lists.
- A food the player dislikes, cannot eat, or is allergic to goes in "add_avoid".
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
        add_favorites=[], remove_favorites=[], add_avoid=[], remove_avoid=[],
    )


_FOOD_LIST = r"([a-z][a-z ,&]*?)(?:[.!?;]|$| and i | i | but | because | so | please)"
_AVOID = re.compile(r"(?:hate|dislike|allergic to|avoid|can(?:no|')t eat|don'?t (?:like|eat|want)|no more|\bno)\s+" + _FOOD_LIST)
_LIKE = re.compile(r"(?:love|like|favorite (?:food )?(?:is|are)|enjoy|crave|more)\s+" + _FOOD_LIST)
_NUMBER = r"\$?\s*(\d+(?:\.\d+)?)"


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
    for diet in ("vegetarian", "vegan", "pescatarian"):
        if diet in text:
            draft.diet = "none" if re.search(rf"(?:not|no longer|stop being) {diet}", text) else diet
    avoid_matches = list(_AVOID.finditer(text))
    draft.add_avoid = [food for match in avoid_matches for food in _split_foods(match.group(1))]
    liked_text = text
    for match in avoid_matches:
        liked_text = liked_text.replace(match.group(0), " ")
    draft.add_favorites = [food for match in _LIKE.finditer(liked_text) for food in _split_foods(match.group(1))]
    return draft


def offline_reply(changes: list[str]) -> str:
    if not changes:
        return (
            "I did not catch a change there. Try something like: my budget is $40, "
            "I do not eat mushrooms, or I love tacos."
        )
    return f"Done. {'. '.join(changes)}. Plan again and the whole party will use it."


async def converse(llm: LLM | None, agent: str, message: str, profile: Profile) -> tuple[str, Profile, list[str]]:
    """One turn of conversation. Returns the agent's reply, the updated profile, and the list of changes."""
    draft: ChatDraft | None = None
    if llm is not None:
        prompt = f"The player's current preferences:\n{_profile_lines(profile)}\n\nThe player says:\n{message}"
        try:
            draft = await llm.generate(
                system=f"{PERSONAS[agent]}\n\n{CHAT_RULES}", prompt=prompt, schema=ChatDraft, temperature=0.6
            )
        except LLMError:
            logger.warning("Chat fell back to the rule-based reader.")
    if draft is None:
        updated, changes = apply_draft(profile, offline_draft(message))
        return offline_reply(changes), updated, changes
    updated, changes = apply_draft(profile, draft)
    reply = " ".join(draft.reply.split())[:MAX_REPLY_CHARS] or offline_reply(changes)
    return reply, updated, changes
