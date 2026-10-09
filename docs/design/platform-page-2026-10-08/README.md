# `/platform` — the page an Anthropic reviewer reads

8 October 2026 · T-646 · approved by Blake the same day; revised after the
first review round

## Purpose

`venviewer.com/platform` is the website named in the Claude Startups
application. In one to two minutes a reviewer should see who Venviewer is for
and what it does, that the product is real and deep, that Claude is used
carefully and measured, and that the founder is candid and has taste. Blake's
bar: a panel of three startup-programme heads, three aesthetics scholars
(Burke, Kant, Schopenhauer) and two design leads (Apple, Pixar), each scoring
every topic 9/10 or above before the application is submitted. The panel is
simulated by AI reviewers; their scores find weaknesses, they do not predict a
decision.

## Narrative

1. **The room.** A real photograph of the Grand Hall from Venviewer's own
   capture (scan 44 of the tour's 149 panoramas) is held dark for a moment,
   its lights come up, and a wedding breakfast for 160 is inked onto the floor
   in the camera's exact perspective. A switch redraws the same 160 as their
   ceremony. The eyebrow and lede name the buyer and the job; Claude is "now in
   testing".
2. **One wedding, from first enquiry to the night.** Elaine Crawford, 160
   guests, the Grand Hall, Saturday 5 June 2027; one coordinator (Catherine
   Tait) and one day (Thursday 8 October 2026) in every screen: the enquiry,
   the first-option hold with a second couple behind it, her layout in the
   planner, version 2 of the proposal with Claude's draft, her page with its
   decision, the hallkeeper's sheet on a phone, and the same plan drawn into a
   second photograph taken from the top table.
3. **Claude drafts the reply. A person sends it.** Five held-out cases, the
   client's words beside Claude's unedited draft with time and cost; how it was
   measured (development and held-out sets, three models, the grader and its
   limits, the claim guard, what reaches Anthropic, what comes next); and a
   linked record of every case, draft and grade (`/platform/evaluation/`).
4. **Engineering.** Measured counts and a weekly commit chart drawn from the
   repository, Claude co-authorship in gold.
5. **The first venue.** The dome of the Grand Hall from scan 43, the building's
   eight rooms, links to the tour, the planner and the venue's site.
6. **The founder**, with the family connection stated plainly, and a ledger of
   where things stand: deployed, in testing, in progress, not yet. The concept
   film is a link in the footer.

## Truth rules

- Every number is measured and dated; the commit counts and chart come from
  the same computation (`scripts/platform-pace.mjs`), and the evaluation
  counts on the page match the record the page links to.
- Product images are captures of the current product drawing one sample
  wedding through the end-to-end API emulators, cropped and never redrawn.
  Room pictures inside the product are the venue's supplied images and are
  described as such.
- The hero and last-step photographs are from Venviewer's capture; the earlier
  hero (`images/venue/grand-hall-dark.jpg`, an edited image) is no longer used.
- Claude drafting is described as connected and evaluated, not live for venue
  use. The planner is a scale 3D model of each room; the rooms' splat models are
  "in progress". Trades Hall is the first venue, not a customer or endorser.
- Sample people use `example.com`/`example.org` addresses and Ofcom drama
  numbers.

## The photographs and their geometry

`scripts/platform-hall.mjs` resamples panoramas from the live tour (each
SHA-256 checked against the tour's manifest) into level pinhole views with
shifted principal points. The tour stores equirects mirrored; the window wall,
the scan mesh and the venue's photographs agree on which side the windows are.
Sections of the tour's dollhouse mesh measure the hall at 21.15 × 10.60 m with
its floor at z = 0.04; each view's yaw and tilt are fitted from the vanishing
point of the side walls' feet, after which the mesh's floor rectangle lands on
the wainscot bases and the walls' distances read from the photograph agree
with the mesh to within 15 cm. Floor circles map to exact conics. The
breakfast layout is `e2e/support/crawford-layout.json` in the planner's frame,
turned a half-turn into the tour's so the fireplace ends agree; the same file
is the saved draft the planner capture opens and the plan on the hallkeeper's
sheet.

## Craft

- House type: Newsreader and Inter. Palette from the desk style: ivory, forest,
  copper, gold, with a dark register for the hall. One container sets every
  left edge; the roman-and-italic heading is the hero's alone.
- Static HTML and CSS, progressive JavaScript under 10 KB, readable with
  JavaScript off (the breakfast layout stands drawn). Motion is kept to the
  hero's light and ink, the story frame and the scene switch;
  `prefers-reduced-motion` gives still, complete content.
- Story frames change when a step's heading crosses the middle of the window.
  On wide screens the inline images are visually hidden, not removed, so screen
  readers keep their descriptions; every capture opens full size in a dialog.
- AVIF/WebP ladders with `srcset`, art-directed crops for phones, the hero
  preloaded per orientation, everything else lazy.

## Regenerating

From `packages/web`, with the dev server on a known port:

```
$env:CAPTURE_PLATFORM_DIR="D:/claude/claude-startups/captures"; $env:E2E_START_SERVER="false"; $env:E2E_BASE_URL="http://localhost:5205"
npx playwright test platform-captures proposals-desk -g "platform captures"
node scripts/platform-hall.mjs D:/claude/claude-startups/captures
node scripts/platform-images.mjs D:/claude/claude-startups/captures
node scripts/platform-pace.mjs origin/master
node scripts/platform-evaluation.mjs D:/claude/claude-startups
```

The evaluation runs themselves come from
`packages/api/src/scripts/eval-proposal-drafts.ts` (`--set dev|heldout`,
`--samples`, `--model`, `--grader`); run it with `npx tsx` from
`packages/api`, as pnpm passes a literal `--` that the script rejects.

## Review rounds

Round 1 (8 October): every reviewer scored 6 to 8. The common findings, all
addressed in the revision: the eyebrow named a place, not the buyer; "3D
captures of the real rooms" contradicted the planner; the story showed four
events, not one; captures were illegible at half scale and on phones; the
hero photograph's provenance and the family connection were not stated;
Claude's claims were stronger than their evidence (no held-out set, a
same-family grader not disclosed, "cannot change the rules"); the bar ghosted
text; inline figures hid their descriptions from screen readers; the dot
field read as wallpaper; the founder section was thin. The planner header's
"Trade's Hall of Glasgow" is Blake's requested spelling (session note,
7 September 2026) and is cropped out of the planner image rather than changed.
