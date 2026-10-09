# `/platform` — the page an Anthropic reviewer reads

8 October 2026 · T-646 · approved by Blake the same day; revised after the
first review round (8 October), the second and the third (9 October)

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
   capture (scan 44 of the tour's 149 panoramas) is held dark for a moment;
   its own lamps come up first (the photograph's highlights alone, screened
   over the dark), then the whole exposure rises under them, and a sample
   wedding breakfast for 160 is drawn onto the floor in the camera's exact
   perspective, a ghost wherever the words and buttons sit (measured from the
   text's own lines on every screen). A switch in the band beneath the
   photograph redraws the same 160 as their ceremony. The lede is the promise
   (the layout a client approves is the one the hallkeepers set); the band
   says Claude, in testing, drafts each proposal's message.
2. **One wedding, from first enquiry to the morning of the day.** Elaine
   Crawford, 160 guests, the Grand Hall, Saturday 5 June 2027, with Catherine
   Tait as coordinator. Each step is captured on its own day of the sample
   timeline and names it: the enquiry in her own words (Monday 21 September
   2026), the first-option hold Catherine places with a second couple behind
   (24 September), her layout in the planner, tight against a comfortable
   capacity of 147 (28 September), Claude's first draft of the reply to her
   request for less per head, from version 2's quote and the diary's hold
   (8 October), her page with its capacity note and her acceptance, beside
   the message as sent, Claude's draft with the coordinator's edits marked
   (12 October), and the hallkeeper's sheet on a phone (5 June 2027). Step 7,
   "Where Elaine will sit", closes the story full width: the same plan drawn
   into a second photograph from the top table.
3. **The first venue.** The building's eight rooms between the two full-width
   photographs, the top table above and the Grand Hall's dome below (scan 39),
   with links to the tour, the planner and the venue's site.
4. **Claude drafts the message. A person sends it.** Five held-out cases, each
   its first run, unedited, with its time, cost and how many of its five runs
   passed every check; how it was measured (development and held-out sets,
   three models five runs each, the strict and graded counts, the grader and
   its limits, what reaches Anthropic, the go-live test); and a linked record
   of every case, draft and grade with both models' instructions verbatim
   (`/platform/evaluation/`).
5. **Engineering.** Measured counts and a weekly commit chart drawn from the
   repository, Claude co-authorship in gold.
6. **Where things stand**, a ledger (deployed, in testing, in progress, not
   yet, next), then **the founder**, with the family connection stated plainly,
   ending on what is next. The concept film is a link in the footer.

## Truth rules

- Every number is measured and dated; the commit counts and chart come from
  the same computation (`scripts/platform-pace.mjs`), and the evaluation
  counts on the page match the record the page links to. The page's guard
  test (`src/__tests__/platform-page.test.ts`) checks every Claude card (its
  run, time and tally) and the table's strict counts against the published
  JSON.
- Product images are captures of the current product, built for production as
  venviewer.com runs it, drawing one sample wedding through the end-to-end API
  emulators, cropped and never redrawn. The emulators answer as the routes do
  (the diary's decisions due within seven days; what a draft drew on). Room
  pictures inside the product are the venue's supplied images and are
  described as such.
- The step-4 draft is Claude's first draft through the product's own path
  (the sample proposal seeded in a throwaway database, the route's context
  builder with the composer's version-2 quote and the diary's hold, the
  Anthropic adapter), kept verbatim in `e2e/support/platform-sample.ts`, its
  request and answer published as `evaluation/data/crawford-draft.json`. The
  message on her page is that draft as the coordinator might edit it: our
  sample edit, shown in step 5 word by word against Claude's draft
  (`scripts/platform-edit.mjs`), never as Claude's. The guard test reads both
  texts back from the marked block.
- Captures come from the production build with its clock set to each step's
  day and its API answered by test fixtures, and the page says so.
- The hero and last-step photographs are from Venviewer's capture; the earlier
  hero (`images/venue/grand-hall-dark.jpg`, an edited image) is no longer used.
  The hero is shown as photographed, shaded only behind the words, and its
  caption says so.
- Claude drafting is described as connected and evaluated, not live for venue
  use. The planner is a scale 3D model of each room; the rooms' splat models
  are "in progress". Trades Hall is the first venue, not a customer or
  endorser. No person has graded the drafts yet, and the page says so.
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
with the mesh to within 15 cm. Floor circles map to exact conics. The desktop
frame's horizon sits at 55% of its height, so the vault is clear above the
words and the floor below them; the plan's strength rises with distance (a
sixth at the frame's foot, full from 8 m) so the far rows carry the gold. For
each hero frame the script also writes the lamps alone (each pixel kept in
proportion to how near it is to clipping, luminance 238 to 254, with a soft
halo): the chandeliers' bulbs, the dome's lamps, the picture lights and the
cornice strip, which the page screens over the dark hall before the exposure
comes up. The breakfast layout is
`e2e/support/crawford-layout.json` in the planner's frame (fifteen 6 ft rounds,
3.55 by 3.35 m between centres, and a top table of three trestles), turned a
half-turn into the tour's so the fireplace ends agree; the same file is the
saved draft the planner opens, the plan on her proposal page and the plan on
the hallkeeper's sheet.

## Craft

- House type: Newsreader and Inter. Palette from the desk style: ivory, forest,
  copper, gold, with a dark register for the hall. One container sets every
  left edge; the roman-and-italic heading is the hero's alone.
- Static HTML and CSS, progressive JavaScript under 10 KB, readable with
  JavaScript off (the breakfast layout stands drawn). Motion is kept to the
  hero's light and ink, the story frame, the scene switch and the last step's
  ink; `prefers-reduced-motion` gives still, complete content.
- Story frames are 4:5, sized to the window so each capture reads at about real
  size, and change when a step's heading crosses the middle of the window; the
  frame's note is the step's own. On wide screens the inline images are
  visually hidden, not removed, so screen readers keep their descriptions;
  every capture opens full size in a dialog.
- AVIF/WebP ladders with `srcset`, art-directed 3:4 crops for phones, blurred
  24-pixel placeholders while images load, the hero preloaded per orientation,
  everything else lazy.

## Regenerating

From `packages/web`. The captures run against a production build (where the
room captures stay out of the planner, as on venviewer.com), served by the
`startups-capture` preview entry or directly:

```
$env:VITE_ENABLE_E2E_AUTH_BYPASS="true"; pnpm exec vite build --mode capture --outDir dist-capture
pnpm exec vite preview --mode capture --outDir dist-capture --host 127.0.0.1 --port 4177 --strictPort
$env:CAPTURE_PLATFORM_DIR="D:/claude/claude-startups/captures-r4"; $env:E2E_START_SERVER="false"; $env:E2E_BASE_URL="http://127.0.0.1:4177"
pnpm exec playwright test platform-captures proposals-desk -g "platform captures"
node scripts/platform-hall.mjs D:/claude/claude-startups/captures
node scripts/platform-pace.mjs
node scripts/platform-edit.mjs
node scripts/platform-images.mjs D:/claude/claude-startups/captures D:/claude/claude-startups/captures-r4
node scripts/platform-evaluation.mjs D:/claude/claude-startups
```

Every crop sits wholly inside the sheet or panel it shows and is at least as
wide as the largest width the page asks of it (1120 for the 4:5 frames, 780
for the phone details), set on the desk's own colour where narrower; the diary
is captured 1000 px tall so its frame fits below the toolbar. The planner is
captured with its own section control lowered below the ceiling, so the
hanging chandeliers go with the ceiling; its enlargement stops at the
planner's toolbars.

`dist-capture/` is a local build output; delete it afterwards. The evaluation
runs themselves come from `packages/api/src/scripts/eval-proposal-drafts.ts`
(`--key-file`, `--out`, `--set dev|heldout`, `--samples`, `--model`,
`--grader`); run it with `npx tsx` from `packages/api`, as pnpm passes a
literal `--` that the script rejects.

## Review rounds

Round 1 (8 October): every reviewer scored 6 to 8. The common findings, all
addressed in the first revision: the eyebrow named a place, not the buyer; "3D
captures of the real rooms" contradicted the planner; the story showed four
events, not one; captures were illegible at half scale and on phones; the
hero photograph's provenance and the family connection were not stated;
Claude's claims were stronger than their evidence (no held-out set, a
same-family grader not disclosed, "cannot change the rules"); the bar ghosted
text; inline figures hid their descriptions from screen readers; the dot
field read as wallpaper; the founder section was thin. The planner header's
"Trade's Hall of Glasgow" is Blake's requested spelling (session note,
7 September 2026) and is cropped out of the planner image rather than changed.

Round 2 (9 October): scores 7 to 9, mostly 8. All eight found the same false
statement: the first Claude case showed run 3 under a note saying each case
showed its first run. Also found: "built every week" against two empty weeks;
a forbidden-phrase sentence wrong about one draft; the step-4 draft written
from the facts alone while the copy said "and Elaine's own words"; the
story's clock contradicting itself; crops that cut the evidence their copy
cited, a development-build toast, a phone frame at 45% scale; a uniform 40%
veil over the hero and gold running through its caption; the frame's
"working product" note under the photograph step; the dome and last step as
small cards; the results table cut on phones. The second revision addressed
each; what it could not do (a person's blind grade of the drafts, a line on
the founder's background and on how the venue's team works today) needs the
founder and is stated as not done. Sending only the client's first name was
considered and declined: contact names hold titles and organisations.

Round 3 (9 October): scores 7 to 9, mostly 8. All eight found a hard seam
across the hero floor (the copy's backing gradient was cut off by its own box)
and asked to see the message as sent beside Claude's draft; most asked that
"Why Opus" read all three models' flags alike, and five asked for a person's
blind grade. Two showed that the step-4 draft exposed a design limit (no price
and no hold sent, so it asked for a figure already set and called a held date
unconfirmed). The fourth revision gives Claude the quote and the diary's holds
(instructions unchanged; a held-out set on prices and holds; a figure check
returned to the composer), regenerates the draft, marks the coordinator's
edits in step 5, reads the models alike (Opus 58 of 59 needing no correction
of fact, Sonnet 55 of 60, Haiku 53 of 60), corrects the medians, adds the
answered-the-client column, lights the hero lamps-first, keeps the plan off
the buttons on every screen, fixes the phone chart, kicker, room names and
crops, and moves the venue's words between the two photographs. A blind
grading page for the founder is published privately; his grade, a line on his
work before 2026 and one on how the venue's team works today wait on him.
