# Fridge Raid

Your fridge is the dungeon. Your agents are the party. The enemy is food waste.

Built solo at HackRU Fall 2026.

## The problem

People throw food away because they forget what they have, ingredients expire, and planning meals around a budget is tedious. Fridge Raid turns that chore into a boss fight. The boss is "The Rot", and its health bar is the dollar value of the food in your fridge that expires within three days.

## How it works

1. **Scout** reads a fridge photo with Gemini vision and returns a structured inventory. You can correct it before the raid.
2. You drag ingredients into the arena to force the party to use them.
3. **Chef** proposes dishes built around what expires first.
4. **Nutritionist** scores each dish against your goals and vetoes clear violations. The Chef must revise, for up to three rounds.
5. **Bargain Hunter** runs an optimizer over the approved dishes and picks the set that saves the most expiring food, then the most meals, then the lowest cost, inside your budget.
6. Each chosen dish strikes the boss. You accept the plan, and the fridge inventory updates and persists for next week.

The whole debate streams to the browser live over Server-Sent Events.

## What is technically interesting

- **Vision to validated data.** Gemini returns JSON against a schema. Every item is then validated, clamped, and matched to a grocery catalog before it reaches the game.
- **A real negotiation loop.** Agents exchange structured proposals, verdicts, and objections. Vetoes feed back into the Chef's next prompt. See `backend/app/negotiation.py`.
- **An exact optimizer, not a prompt.** Buying one pack can unlock several dishes, so dishes cannot be costed one at a time. The optimizer checks every subset of candidates with shared pack purchases. See `backend/app/optimizer.py`.
- **Graceful failure.** If a Gemini call fails mid-raid, a rule-based agent takes over that single move and the UI says so. The app also runs fully offline with no key.

## Stack

| Layer | Tools |
|---|---|
| Agents | Google Gemini through the `google-genai` SDK, structured output |
| Backend | Python, FastAPI, Pydantic, Server-Sent Events |
| Data | Tiger Data (Postgres, with a hypertable for raid history), SQLite fallback |
| Frontend | React, TypeScript, Vite, dnd-kit, Framer Motion |
| Tests | pytest, Vitest, a Playwright browser walkthrough |

## Run it

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then add GEMINI_API_KEY
uvicorn app.main:app --reload
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Configuration

All settings live in `backend/.env`. See `backend/.env.example`.

| Variable | Purpose | If empty |
|---|---|---|
| `GEMINI_API_KEY` | Live agents and photo scanning | Offline mode with rule-based agents and demo fridges |
| `GEMINI_MODEL` | Gemini model ID | `gemini-2.5-flash` |
| `DATABASE_URL` | Tiger Data connection string | Local SQLite file |

## Demo script

1. Pick **The Dorm Fridge**. Eight items pulse red and the boss bar fills.
2. Drag spinach and eggs into the arena.
3. Press **Start the raid**. The Chef pitches a Bacon Ramen Bomb, the Nutritionist vetoes it on sodium, and the Chef swaps it out.
4. The Bargain Hunter locks the cart. The boss bar drops to zero for $13.45.
5. Accept the plan. The fridge updates and the raid history counter ticks up.

The offline agents make this run identically with no network.

## Tests

```bash
cd backend && pytest --cov=app          # 70 tests
cd frontend && npm test                 # reducer, stream parser, formatting
cd frontend && node e2e/demo.mjs        # browser walkthrough; needs both servers running and Chrome
```

## Project layout

```
backend/app/
  agents/          Chef, Nutritionist, Bargain Hunter (Gemini and offline versions)
  negotiation.py   propose, critique, revise loop that emits events
  optimizer.py     exact search for the best dishes and cart
  scout.py         fridge photo to inventory
  repository.py    inventory and raid history (Postgres or SQLite)
  api.py           HTTP routes and the event stream
backend/data/      mocked grocery prices, offline recipe book, demo fridges
frontend/src/
  components/      fridge, arena, HUD, panels
  hooks/           useRaid (event playback), useKitchen (server state)
  lib/             raid reducer, stream parser, sprites
```

## Known limits

- Grocery prices are mocked in `backend/data/prices.json`.
- Single user, no accounts.
- Quantities assume the catalog's unit for each item. There is no unit conversion.
