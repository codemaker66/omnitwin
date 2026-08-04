# Trades House of Glasgow — leaflet and Craft quiz

Two pieces of visitor collateral for the Trades Hall of Glasgow:

| | What it is | State |
|---|---|---|
| **Leaflet** | A two-sided A4 landscape print leaflet, six panels, folded in three | Complete. Awaiting venue sign-off on facts and image rights. |
| **Quiz** | *Discover Your Craft* — nine questions that match a visitor to one of the fourteen Incorporated Trades | In development. Structure is finished; the questions and scoring are still being tuned. |

Both were supplied by the venue and rebuilt natively. They live inside the
Venviewer monorepo but need almost none of it: the quiz content is plain JSON,
and everything here can be previewed and checked with nothing but Node.

**Working on this as an agent? Read [AGENTS.md](AGENTS.md) first** — it is the
short version, with the rules and the commands.

## Where everything lives

```
projects/trades-house/                 ← you are here: docs, preview, checker
  AGENTS.md                            the working contract
  preview/quiz.html                    zero-install quiz preview
  tools/check.mjs                      zero-install content checker

packages/web/src/features/trades-house/
  craft-quiz.content.json              ← the quiz's words and scoring. Edit this.
  craft-quiz.content.schema.json       what the JSON is allowed to contain
  craft-quiz-model.ts                  the fourteen Crafts, scoring, ranking
  CraftOptionIcon.tsx                  the 32 line-drawn option icons

packages/web/src/pages/
  TradesHouseCraftQuizPage.tsx         the quiz UI
  TradesHouseCraftQuizPage.css         its styling
  TradesHouseLeafletPage.tsx           the wrapper that frames the leaflet

packages/web/public/trades-house-media/
  leaflet.html                         the print leaflet — self-contained
  assets/                              crests, photography, the QR code
```

Live routes, once the dev server is running: `/trades-house/leaflet` and
`/trades-house/discover-your-craft`.

## Running it

**No install needed.** From the repository root:

```bash
node projects/trades-house/tools/check.mjs     # validate the quiz content
python3 -m http.server 8000                    # then open, in a browser:
#   http://localhost:8000/projects/trades-house/preview/quiz.html
#   http://localhost:8000/packages/web/public/trades-house-media/leaflet.html
```

The preview reads the real content file, the real crest images and the real
icon definitions, so wording, scoring and icons are exactly what ships. Only
the layout and animation are simplified. It also shows live scores and the
weights behind each option, which the shipped quiz deliberately hides.

**With the monorepo installed**, for the real thing:

```bash
pnpm install
pnpm --filter @omnitwin/web dev            # then open /trades-house/discover-your-craft
pnpm --filter @omnitwin/web test           # includes the quiz content suite
pnpm --filter @omnitwin/web typecheck
```

## Changing the quiz

Almost every change is a change to **`craft-quiz.content.json`** — the wording
of questions and options, the result copy for each Craft, and the points each
answer awards. Nothing needs rebuilding; reload the preview.

The JSON declares its own schema, so an editor that understands JSON Schema
will flag mistakes as you type. `check.mjs` catches the rest, including the
things a schema cannot express: an icon the renderer cannot draw, a weight
naming a Craft that does not exist, a Craft no answer can reach.

What is **not** content, and lives in TypeScript instead: which fourteen Crafts
exist and their order (`CRAFT_ORDER`), how scores are ranked and tied
(`rankCrafts`), and the icon set (`CraftOptionIcon.tsx`). There are fourteen
Incorporated Trades as a matter of history, so adding a fifteenth is a change
to the domain, not to copy.

## Known open work

**The quiz is badly unbalanced.** Walking all 262,144 ways through it, the
spread of winning Crafts is roughly 200 to 1:

```
gardeners 21.1%   hammermen 14.0%   tailors 10.0%   bakers 9.2%   wrights 9.0%
maltmen 8.5%      masons 6.9%       fleshers 5.4%   barbers 4.6%  cordiners 3.4%
dyers 3.4%        weavers 3.2%      skinners 1.2%   coopers 0.1%
```

A visitor is effectively never told they are a Cooper. Two questions award
`gardeners: 3` outright, while the Coopers are never more than a secondary
weight on any answer. Fixing this means rewriting weights — a content change,
and the venue's call on how the Crafts should be represented. Run the checker
after any change to see the distribution move.

*(Snapshot taken 4 August 2026. `check.mjs` prints the current figures.)*

**The leaflet needs venue sign-off**, not engineering. The figures on it —
£926,319 given to good causes, 810 individuals, 81 organisations, 235 families,
"Glasgow's only surviving major Adam work", the charity number and contact
details — came with the supplied artwork and have not been independently
verified. Image rights are likewise unconfirmed. The leaflet is marked
`noindex,nofollow` and the route carries a review notice until that clears.

The QR code is **correct and verified** — it encodes
`https://www.tradeshallglasgow.co.uk` (checked on every run of `check.mjs`).
It deliberately points at the venue's main site rather than at the quiz,
because that is where the printed campaign was aimed. Retargeting it to the
quiz is a live option, but it is a campaign decision, not a bug.

**The leaflet is print-faithful, not press-ready.** It renders correctly to two
A4 landscape pages from a browser, but the supplied design carries no bleed, no
crop marks, no CMYK profile and no fold compensation, and no commercial
prepress check has been done.

## Provenance

The venue supplied the artwork on 10 July 2026; source archive hashes and the
import boundary are recorded in
[`docs/operations/trades-house-leaflet-source-2026-07-10.md`](../../docs/operations/trades-house-leaflet-source-2026-07-10.md).
The supplied bundle's `support.js` runtime was deliberately not shipped: it
evaluated component logic at runtime and pulled React from a third-party CDN.
The leaflet is static HTML and the quiz is native TypeScript instead.
