# AI Diet Assistant Pro


Premium AI Diet Assistant with a HealthyfyMe-style feature set:
- Premium responsive UI/UX dashboard
- Auth (signup/login/logout) with profile sync
- Personalized calorie + protein target engine
- Meal logger with built-in food database
- Nutrition search (USDA FDC when key is provided)
- Barcode lookup flow (USDA FDC + OpenFoodFacts fallback)
- Water, steps, fasting timer, weight trend, streak tracking
- AI Coach powered by Groq (`llama-3.1-8b-instant`) via backend proxy

## Setup
1. Copy `.env.example` to `.env`.
2. Keep your Groq key in `GROQ_API_KEY`.
3. (Optional) Add `USDA_API_KEY` for full USDA nutrition search/barcode coverage.
4. Set `TOKEN_SECRET` to a strong random secret.

## Run
```bash
node server.js
```
Then open: `http://localhost:3000`

## Security
- Groq key is now used server-side and no longer exposed in frontend JavaScript.
- Do not commit `.env`.
