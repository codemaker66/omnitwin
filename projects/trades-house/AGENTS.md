# AGENTS.md — Trades House leaflet and Craft quiz

Read this before changing anything in this project. [README.md](README.md) has
the fuller map; this is the working contract.

This project sits inside the Venviewer monorepo but is independent of it. You
do **not** need to understand Three.js, Fastify, Postgres or the venue-planning
product to work here. Do not pull those in.

## Orientation in one minute

- **The leaflet is finished.** A two-sided A4 print piece at
  `packages/web/public/trades-house-media/leaflet.html`. Self-contained HTML.
  What remains is the venue's sign-off on facts and image rights, not code.
- **The quiz is in development.** Nine questions matching a visitor to one of
  the fourteen Incorporated Trades. Structure is settled; the wording and the
  scoring are still being tuned.
- **Quiz content is data.** All of it is in
  `packages/web/src/features/trades-house/craft-quiz.content.json`.

## The one rule that matters

**Content goes in the JSON. Structure goes in TypeScript.**

| Change | Where |
|---|---|
| Question or option wording | `craft-quiz.content.json` |
| A Craft's result copy — name, archetype, omen, motto, essence, reveal | `craft-quiz.content.json` |
| How many points an answer awards | `craft-quiz.content.json` |
| Which icon an option shows | `craft-quiz.content.json` (must already exist in `CraftOptionIcon.tsx`) |
| Adding a new icon drawing | `CraftOptionIcon.tsx` |
| Which Crafts exist, and their order | `CRAFT_ORDER` in `craft-quiz-model.ts` |
| How scores rank and ties break | `rankCrafts` in `craft-quiz-model.ts` |
| Screen layout, animation, styling | `TradesHouseCraftQuizPage.tsx` / `.css` |

The model reads the JSON at build time, so `tsc` checks its shape and there is
no second copy to keep in step. Do not reintroduce the questions as TypeScript
literals, and do not add a build step that generates one file from the other.

## Verify every change

From the repository root, with nothing installed:

```bash
node projects/trades-house/tools/check.mjs
```

It fails on: a missing or blank field, a weight naming a Craft that does not
exist, an off-scale weight, a duplicated prompt or option title, an icon the
renderer cannot draw, a missing crest image, a Craft that no run of answers can
reach, and a QR code that no longer points where it should. On success it
prints how the winning Crafts are distributed across every possible run — which
is the signal to watch when tuning weights.

If the monorepo is installed, also run:

```bash
pnpm --filter @omnitwin/web test --  src/features/trades-house
pnpm --filter @omnitwin/web typecheck
```

CI runs `check.mjs` as part of the test suite, so the two cannot drift.

## Seeing your change

```bash
python3 -m http.server 8000      # from the repository root
```

- Quiz preview — <http://localhost:8000/projects/trades-house/preview/quiz.html>
- Leaflet — <http://localhost:8000/packages/web/public/trades-house-media/leaflet.html>

The preview reads the same content, crests and icons as the shipped quiz, and
additionally shows live scores and each option's weights. Its layout is a
simplification; for the real UI run the dev server and open
`/trades-house/discover-your-craft`.

## Decided — do not undo without asking

- **The QR code stays pointed at `https://www.tradeshallglasgow.co.uk`.** It is
  verified correct on every check run. Aiming it at the quiz instead is a live
  option but a campaign decision for the venue, not a cleanup.
- **The supplied `support.js` is not shipped.** It evaluated component logic at
  runtime and fetched React from a third-party CDN. The leaflet is static HTML
  and the quiz is native TypeScript. Do not reinstate it.
- **There are fourteen Crafts.** That is history, not a configuration value.
- **The quiz has no wide-screen layout.** The source is a centred portrait
  frame capped at 520px at every width, and a Playwright test guards this. An
  earlier attempt to add a desktop grid was reverted.
- **The leaflet is `noindex,nofollow`** until the venue approves the copy.

## Open work

The quiz's scoring is **badly unbalanced** — Gardeners win about 21% of all
262,144 possible runs and Coopers about 0.1%. This is the main thing that needs
doing. It is a content change (rewriting weights in the JSON), and how the
Crafts ought to be represented is the venue's call, so agree the intent before
reweighting wholesale. Run `check.mjs` to watch the distribution move.

The leaflet's claims — the charitable giving figures, the Adam architecture
claim, the charity number, contact details and image rights — are the venue's
to confirm. Do not present them as verified, and do not quietly edit them.

## House rules

- TypeScript strict, no `any`, no skeletons or TODOs left behind.
- Add or update a test for any behaviour you change.
- If a request contradicts something under "Decided" above, say so and ask
  rather than silently reinterpreting it.
- Prices, dates, capacities and charitable figures are venue facts. If you
  cannot verify one, say you cannot — never invent a plausible number.
