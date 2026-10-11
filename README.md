# Fridge Raid

Snap your fridge. Three AI agents turn what is inside into dinners, keep your nutrition goals on track, and find the cheapest nearby shop for the gaps.

Built solo at HackRU Fall 2026. It is a phone-first web app in a pixel-art style, and it installs to the home screen.

## The problem

People throw food away because they forget what they have, ingredients expire, and planning meals around goals and a budget is tedious. Fridge Raid does the planning from a single photo, and it starts from the food that will spoil first.

## The party

| Agent | Job |
|---|---|
| **Chef** | Proposes recipes from what you have and your favorite foods, expiring food first |
| **Nutritionist** | Checks every recipe against your goals and can veto it. Tracks your daily energy, protein, sodium, and water |
| **Shopper** | Compares nearby stores and their deals, then picks the one stop that completes the most meals for the least money |

## How it works

1. **Scan.** Take a fridge photo. Gemini vision returns a structured ingredient list with estimated days left.
2. **Review.** Fix any amount. Food to use soon is listed first.
3. **Huddle.** The agents plan live on screen. The Chef pitches, the Nutritionist approves or vetoes, the Chef revises, for up to three rounds. The Shopper then settles the plan.
4. **Cook.** Each recipe shows what you have, what to use first, what to buy, and the steps. Cooking it logs the meal, updates the fridge, and earns XP.
5. **Track.** The Goals tab shows today against your targets, with a coaching line from the Nutritionist.
6. **Shop.** Share your location and the Shop tab maps real grocery stores near you, from OpenStreetMap. The Shopper prices your list at each one and gives you a checklist under your weekly budget.
7. **Talk.** Tell any agent what you want in plain words: "I hate mushrooms", "make my budget $40". It answers in character and updates your saved preferences.

## What is technically interesting

- **Vision to validated data.** Gemini returns JSON against a schema. Every item is validated, clamped, and matched to a grocery catalog before the app uses it.
- **A real negotiation loop.** Agents exchange structured proposals and verdicts, and vetoes feed back into the Chef's next prompt. Events stream to the phone over Server-Sent Events. See `backend/app/negotiation.py`.
- **An exact optimizer, not a prompt.** One pack can unlock several dishes, so dishes cannot be costed one at a time. The optimizer checks every subset of candidate dishes at every store, and ranks by food rescued, then meals, then cost, then distance. See `backend/app/optimizer.py` and `backend/app/deals.py`.
- **Graceful failure.** If a Gemini call fails mid-plan, a rule-based agent takes over that single move and the screen says so. With no key the whole app runs on those agents.
- **Pixel art without an asset pack.** Characters and icons are hand-authored grids drawn as SVG. Food icons are emoji redrawn on a 16 pixel canvas and scaled up with hard edges. See `frontend/src/pixel/`.

## Stack

| Layer | Tools |
|---|---|
| Agents | Google Gemini through the `google-genai` SDK, structured output |
| Backend | Python, FastAPI, Pydantic, Server-Sent Events |
| Data | Tiger Data (Postgres, with hypertables for the food log and cooking history), SQLite fallback |
| Frontend | React, TypeScript, Vite, installable web app |
| Tests | pytest, Vitest, a Playwright phone walkthrough |

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

### Open it on a phone

The dev server listens on your local network. With the phone on the same Wi-Fi, open the `Network` address that `npm run dev` prints, for example `http://192.168.1.20:5173`. The shutter opens the phone camera. Use the browser's "Add to Home Screen" to install it.

For HTTPS, run `npm run dev:https` instead and open `https://<laptop-ip>:5443`. The certificate is self-signed, so the phone shows a warning once. Choose to continue.

iPhones drop the connection unless the certificate names the laptop's own address. Make one for your address before starting, replacing the IP:

```bash
cd frontend && mkdir -p .cert
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 -keyout .cert/key.pem -out .cert/cert.pem \n  -subj "/CN=Fridge Raid Dev" -addext "subjectAltName=IP:192.168.1.20,IP:127.0.0.1,DNS:localhost" \n  -addext "extendedKeyUsage=serverAuth"
```

Some venue networks block device-to-device traffic. In that case connect the laptop to the phone's hotspot, or use the deployed site.

### Configuration

All settings live in `backend/.env`. See `backend/.env.example`.

| Variable | Purpose | If empty |
|---|---|---|
| `GEMINI_API_KEY` | Live agents and photo scanning | Rule-based agents, and the camera scans a sample fridge |
| `GEMINI_MODEL` | Gemini model ID | `gemini-3.8-flash` |
| `DATABASE_URL` | Tiger Data connection string | Local SQLite file |

## Demo script

1. Home. Tap **Scan my fridge**.
2. Pick **Dorm Fridge** and press the shutter. Eight ingredients need using soon, worth $12.48.
3. Tap **Confirm stash · find recipes**. The Chef pitches a Bacon Ramen Bomb, the Nutritionist vetoes it on sodium, and the Chef swaps it out.
4. Open the first recipe and tap **Cook and log it**. XP pops, the fridge updates, and the meal lands in Goals.
5. Goals shows today's energy and protein. Shop shows the chosen store, three deals, and a $13.45 list under a $25 budget.

This runs identically with no network.

## Tests

```bash
cd backend && pytest --cov=app          # 115 tests
cd frontend && npm test                 # 63 tests: plan logic, sprites, stream parser, formatting
cd frontend && node e2e/demo.mjs        # phone walkthrough; needs both servers running and Chrome
```

## Project layout

```
backend/app/
  agents/          Chef, Nutritionist, Shopper (Gemini and rule-based versions)
  negotiation.py   propose, critique, revise loop that emits events
  optimizer.py     exact search for the best dishes and cart
  deals.py         stores, deals, and the best one-stop shop
  tracker.py       profile, saved plan, food log, water, cooking, XP
  scout.py         fridge photo to inventory
  repository.py    storage (Postgres or SQLite)
  api.py, api_day.py   HTTP routes and the event stream
backend/data/      grocery prices, sample stores, recipe book, sample fridges
frontend/src/
  screens/         Home, Scan, Fridge, Huddle, Chef, Recipe, Goals, Shop, Plan
  pixel/           sprite renderer, characters, icons, emoji pixelator, town map
  ui/              buttons, bubbles, chips, bars, sheets
  hooks/, lib/     server state, event playback, plan and food helpers
```

## Known limits

- With a shared location, store names and distances are real (OpenStreetMap). Prices and deals are always sample data from `backend/data`, because no free live grocery price source exists.
- A shared location is rounded to about 100 m before it is saved, and is sent to the public Overpass map service to find stores.
- Nutrition numbers are estimates and not medical advice.
- Single user, no accounts.
- Quantities assume the catalog's unit for each item. There is no unit conversion.
