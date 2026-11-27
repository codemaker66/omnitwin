# The planner's new screen: one picture, one shelf (13 November 2026)

**Status:** built on `claude/planner-hud-tft` behind `?chrome=hud`; not merged. The ground (dark, bone or white)
is Blake's to choose. An earlier version of this note described five skins of one layout (gilt, lacquer, glass and
others); Blake rejected them the same day and they are gone.

## Why

Blake, 13 Nov 2026: "our UI design of the room planner is still terrible -- boring and looks like AI slop, hard to
navigate, boring to navigate, my mind is daunted completely when I try navigate it, i told you to completely resign
it in like with league of legends teamfight tactics ui/ux mixed with the philosophical aesthetic of the sublime and
beauty ... every single design choice, colour, animation, the way tabs open and closes, how responsive everything
is, how thingse are layed out and in what position on the screen, everything must have the strongest underlying
principle that we must not daunt or bore the user, we must inspire them with how inviting and satisyfing everything
is, that everything is so well polished that the user feels and ego boost by using such an amazing platform".

And of the first five looks: "These design choices look like ai slop. It's meant to look like it's made by the best
engineering and design team in the world with immaculate high style taste you would expected from the best fashion
houses in Paris. ... We want to blow people away by how the aesthetic just 'clicks' in the viewer's brain as being
'right'".

What is live at `/plan` today is the v1 cockpit: a layers tree, an inspector of X/Z coordinates, five small
toolbars and a lens rail. It asks an events person to think like a 3D artist.

## The idea

The hall is the sublime and takes the whole screen. The interface is the beautiful: small, exact, silent, made of
one rule, with nothing on it that could be removed. The first five looks failed because they did the reverse: they
shrank the hall to a model in a void and gave the interface the weight and the gilt.

Three tests for any control: a first-time visitor can tell in two seconds what it is and what touching it will do;
touching it answers at once and in proportion; and it could not be taken away without loss.

## The picture: the hall as a stage

`components/grand-hall/hall-stage.ts`, `HallStage.tsx`, `lib/lens-shift.ts`.

- The camera stands outside the door wall, **level**, square on to the window wall, and looks through a lens
  shifted down across it, as an architectural photographer's is. So the window wall is drawn in true elevation,
  every upright in the room is upright on the screen, and the room's lines run with the screen's own edges.
- The floor's near corners stand on the picture's foot corners: the whole floor is in view, the screen's sides
  cut the end walls, and the door wall is the missing fourth wall (lowered under the floor on this screen).
- The picture is 2.39:1 wherever the canvas has the height for it, and a taller canvas keeps the rest as night
  above the walls. That puts the camera about 11 m up, which keeps the chandeliers in the picture.
- A flatter canvas is filled, and the camera comes closer and lower to do it, as far as 2.7:1: a maximised
  full-HD browser window is 2.55:1, and 2.67:1 under a bookmarks bar. No further. Past that the lens is over a
  hundred degrees across, the end walls balloon and the far wall shrinks, and at 3.1:1 the camera would stand
  below the walls' tops. So on a canvas flatter still (a 768-line laptop, full HD at 125 %, a 21:9 monitor) the
  camera stays where 2.7:1 puts it, and the hall stands whole in the middle of the canvas with its end walls' cut
  stone ends and the night beside it. Only a picture under 240 px high gets no stage (a phone on its side).
- The shift lives where the camera builds its projection, because temporal anti-aliasing sets and clears a view
  offset on every frame.
- A wheel, a drag or an arrow-key pan lets go in one frame, to an ordinary orbit that shows the same picture (the
  camera tilts at the middle of the floor through the lens that keeps the picture's top and bottom). Room glides
  back and the camera squares itself up over a third of a second. Plan fills the same picture from above through
  a long lens. Walk is seen through the planner's plain lens.
- A canvas that is not wide (a phone or a tablet held upright) gets no stage yet: the ordinary orbit. A canvas
  that stops being wide while the stage is held hands the camera to the planner's own opening view, which is made
  for any canvas; when it can hold a stage again the stage is taken back, unless a hand has moved the camera.

A screen asks for the stage through `hall-view-store` (`setStage({ skyPx })`); nothing changes for one that does
not. `skyPx` is how much of the canvas's top stays dark for the screen's words. The HUD's bar measures itself and
says so (`HudFrame.tsx`), so its height is written in one place, the stylesheet.

## The interface: words on the night, and one shelf

`components/planner-hud/`.

- **No top bar.** The event's name (the one serif line), the day and room, the four steps (Your event, Lay out,
  Finishing touches, Send) and the view words (Plan, Room, Walk, the light, one "more" glyph) stand on the night
  above the hall's walls, in light ink on every ground. Away from the stage, where the hall may pass behind them,
  they take one flat scrim.
- **The shelf is the only surface,** and the canvas ends at its top edge. Its top edge is the seat line, a
  hairline that fills as guests are seated. Then: what needs saying about the room (seats, and a door or a narrow
  aisle only when there is one to look at); the quiet words (Lay out for me, Undo, Redo); eight cards as
  photographs with a two-line caption and a count once placed; "More"; and **one primary key whose label is the
  next move** ("Say how many guests", "Seat 40 more guests", "Send to the events team").
- A chosen piece's verbs (seats, cloth, Turn, Copy, Put back) take the cards' place in the same shelf.
- A step's sheet and the first screen ("What are you planning?") are the shelf grown upward, at most 60 % of the
  height, so the hall stays in sight above them. A short window has not that to spare (in a 768-line laptop's
  641 px it left a sheet 233 px, its own act under a scroll), so there the shelf rises as far as the tallest
  sheet that is not a list needs (Lay out, `--hud-sheet-need`), never over the top bar. Under 620 px of height
  sheets are set closer and Lay out goes without its opening lines; no other sheet does, because elsewhere those
  lines can be all the sheet has to say. Lay out alone may rise as far as the top bar: once a count is typed its
  prompt says what pressing will do, and its act comes last. Where a window cannot show all of that, the sheet is
  slid to its end, so the count, the consequences and the act are in sight together.
- **A sheet is sized from where the shelf really stands.** The shelf grows with what it holds (a status line that
  wraps, a phone's safe area, a piece's keys on a second line) and a sheet hangs from its real top. So the screen
  measures the shelf as it measures the bar and says so (`--hud-shelf-real`, `HudFrame.tsx`), and the stylesheet
  takes every sheet's height from that (`--hud-shelf-now`). Sized from the fixed measure, a sheet rose over the top
  bar by as much as the shelf had grown.
- Each fact is said once. There is no seals column and no side panel.

Keyboard and focus (`HudSheets.tsx`, `keyboard-hand-off.ts`, `radio-keys.ts`, the head of `hud.css`):

- **A sheet takes focus to its title as it opens, and gives it back as it shuts**: to what opened it; where that
  has gone or cannot be seen (the first screen's answer; a step a phone's bar has folded away), to the sheet's own
  step; failing that, to the one primary key. Never to the bare page.
- **Every part that leaves with the keyboard in it hands the keyboard on** (`keyboard-hand-off.ts`), however it
  leaves: its own key, Escape, or a planner key. Each names its places, best first, and the keyboard goes to the
  first that takes it: the browser is asked, place by place, since a key can look able and still refuse. The chosen
  piece's verbs: the card in hand, then the card that counted the piece (where
  a piece put back has gone), then More, then the primary key. The first screen, put aside: the hand's first card,
  for someone who chose to begin with their own hands, then the current step, then the primary key. A receipt whose
  Undo is pressed: the shelf's own Undo, then Redo, which takes the press back. Where two parts leave before the
  first one's turn has come, the later one decides.
- **The ring is the app's one ring, told what to be.** The app draws it from three tokens, and on a key that is a
  stop in the Tab order its rule outranks any ring a screen draws for itself. So the screen sets the tokens, on
  the bar and on the shelf each for itself (the bar's ink is the night's): the ink of the ground, 2 px, 2 px clear
  of the key; inside the key on the bar, whose keys reach the screen's edges.
- **A key's own outline is the keyboard's alone.** Chosen is marked by something else: a 2 px frame drawn by a
  part of the key (a kind of day, a lay-out style, a pressed key), a ring round a cloth's sample, a line under a
  view's word. A chosen key that has the keyboard shows both.
- **The rules for every key reach the bar and the shelf, and not the room between them.** A key the scene draws in
  the room (a tape's ×) keeps the planner's own look and ring.
- **A group that says it is a radio group works as one**: one stop in the Tab order, and the arrow keys go to the
  next choice and choose it (the event's kind, the lay-out style, a table's cloth, Plan / Room / Walk). A choice
  that cannot be taken now is still stopped at, so its reason can be read; and the reason is at full strength:
  such a choice does not fade as other keys do, only its name stands back. The first screen's three answers are
  plain keys: an answer is an act that moves on, not a setting that stays chosen.
- **The primary key stands aside only for a sheet that can do its move.** Two moves are carried out by the press
  itself (a piece moved clear of a door, the narrowest gap shown), so their key stays whatever sheet is open.

Send (`HudSheets.tsx`, `stores/planner-hud-store.ts`):

- **The guest's form is the whole planner's, and stands outside this screen's element** (a portal to the page).
  Inside it, the form took the screen's page-wide rules: a focus ring in the screen's ink on the form's dark glass,
  and its working state faded with the screen's disabled keys. Put away, sent or not, the form hands the keyboard
  back to the key that opened it, where it would otherwise fall to the bare page.
- **A key that is at work is not faded**, and why a key is off is said in the sheet's own words, not on the key.
- **A plan is called sent only when the enquiry has arrived**, never because the form was put away; and the device
  remembers which layouts it has sent (their ids, the newest two dozen), so a page opened again does not invite a
  second enquiry for a plan that has gone. Another device does not know; only the server could say.

Widths (the media rules at the foot of `hud.css`). Two things never give: a card's column is never narrower than
its caption (84 px), and the shelf's side columns are never narrower than their words (192 px). What gives is the
arrangement:

- **1280 px and wider:** the shelf is one row, the hand between the status and the primary key; the bar is one
  line with the steps at its centre.
- **768 to 1279 px:** nine columns will not fit between the side columns, so the shelf stands in two rows (the
  status, the quiet words and the primary key above; the hand below, across the whole width) where the window is
  at least 600 px high. In a shorter window it stays one row and the hand slides. The upper row is one key high
  and grows if the status line wraps past that, the shelf growing upward with it.
- **Under 1024 px:** the name, the four steps and the view will not stand in one line, so the steps take a line of
  their own under the other two.
- **Under 768 px:** a phone's two bars: the name, the step you are on and the "more" glyph above; the status, a
  sliding hand and a full-width primary key below.
- The plaque's line (the day, the room, the save state) gives way a whole item at a time, never part of a word.

Measures (tokens at the top of `hud.css`): a 4 px grid; one sans in two weights at 11, 13, 16 and 20 px; square
corners, circles only for round glyph keys; 1 px lines and a 2 px chosen frame; no shadow, glow, blur or
gradient; one accent on under a hundredth of the screen, meaning chosen, the one primary key, or something to look
at; motion only in answer to a press, 160 to 240 ms, no bounce.

## Grounds

`hud-skins.css`, `?skin=bone|blanc|noir`, remembered on the device.

- `noir`: warm black, a shade above the night. The photographs are prints on the ink's pale. The lead's pick.
- `bone`: warm bone and warm black with the hall's mahogany as the one accent. The photographs dissolve into it.
- `blanc`: the studio's own pale ground and near-black, no accent hue.

The repo bans gold-family colour literals and type under 11 px (`__tests__/house-tokens.test.ts`); none is used.

## What already exists and is reused (do not rebuild)

- Cards and their engine: `lib/setup-cards.ts`, `stores/catalogue-store.ts` (`toggleCard`, `armCard`,
  `startCardDrag`, `stepArmedCard`), the truthful ghost (`components/GhostSet.tsx`), the commit
  (`lib/place-in-hand.ts`). Card pictures: the rule of `setupCardPreviewUrl` (as the screen's own copy while it
  is behind its flag: see "Behind its flag, and nothing more") and each piece's `thumbnailUrl`.
- Drag from a DOM card to the floor is a pointer protocol, not HTML drag and drop: on the first 7 px call
  `startCardDrag(id)`, show a preview with `pointer-events: none`, and let `PlacementGhost` place on release. Any
  element under the pointer blocks placing there, because the floor hit checks `elementFromPoint === canvas`.
- Figures: `lib/slate-facts.ts` `planeFacts`; doors `lib/keep-doors-clear.ts`; gaps `lib/circulation-scene.ts`.
- Lay out: `components/editor/cockpit/AutoFillPrompt.tsx`, `placement-store.autoArrangeBanquet/Theatre`.
- Save state and its notices: `components/planner-chrome/Slate.tsx`, reused whole and dressed from outside
  (`hud-plaque.css`). Saving is automatic. From that chrome's folder the screen takes the slate, its audience and
  the tooltips' host, and no more (`bundle-splitting.test.ts` holds the list). The room's frame is the screen's own
  (`HudRoom.tsx`): the other chrome's frame carries that chrome's caption over a chosen piece (#357), and this
  screen says a piece's verbs once, on the shelf. The slate's crest, which is that chrome's switch for hiding its
  own tools, is put away with its seat and its note.
- Send: `components/editor/send-layout-flow.ts`, `GuestEnquiryModal`.
- Keys and Escape: only through `lib/planner-keys.ts`. Motion: `lib/springs.ts`. Working states:
  `components/shared/Activity.tsx`.

## Behind its flag, and nothing more

Until this screen is the default, a planner that does not ask for it downloads none of it. The screen is one lazy
import from `pages/EditorPage.tsx`. Its parts of the room's scene (`HallStage` with its measurements and lens, and
`ChosenMarks`) are one module, `components/planner-hud/hud-scene.ts`, which `PlannerScene` fetches only where a
screen has asked for the stage or the mark. `HallStage` says where its camera stands through `hall-view-store`
(`stagePoses`), so the views' director needs none of the stage's code, and the two heights the hall's model needs
are a module of their own (`hall-stage-cuts.ts`). `src/__tests__/bundle-splitting.test.ts` fails on a static import
of any of the screen's modules from anywhere else.

That keeps the screen's own code out. It does not keep out what the screen reads from shared code. The bundler
leaves out of a shared module whatever nothing in production reads (an export, or one entry of a table), and the
first production reader puts it back, into the file that module is built into, for every page that fetches that
file. A reader fetched on demand does this as surely as any other. So the rule has a second half: **the screen may
not be the only production reader of anything in a shared module.** Five things were, and the screen keeps its own
copy of each, held to the original by a test so the two cannot part:

| What the screen needs | The original | The screen's copy | Held by |
| --- | --- | --- | --- |
| A setup card's picture | `setupCardPreviewUrl`, `lib/setup-card-previews.ts` (in `lib/crafted-furniture.ts` until #357) | `handCardPictureUrl`, `lib/hud/card-pictures.ts` | `lib/hud/__tests__/flag-only-copies.test.ts`, for every card, colourway and chair |
| The seat line's spring | `SPRING_PRESETS.dialGlide`, `lib/springs.ts` | `SEAT_LINE_SPRING`, `lib/hud/hud-motion.ts` | the same file |
| The stage squaring up | `SHEET_SETTLE`, `planner-chrome/sheet-motion.ts` (`SPRING_PRESETS.sheetSettle` until #357) | `STAGE_SQUARING_SPRING`, `grand-hall/hall-stage.ts` | `grand-hall/__tests__/hall-stage.test.ts` |
| The next light | `HALL_MOOD_NAMES`, `grand-hall/hall-mood.ts` | `NEXT_MOOD`, `planner-hud/ViewStation.tsx` | `planner-hud/__tests__/view-station.test.tsx`, by pressing the key |
| The spacing Lay out keeps behind every chair | `BANQUET_CHAIR_CLEARANCE_M`, `lib/auto-fill.ts` | `LAID_CLEARANCE_M`, `lib/hud/room-seals.ts` | `lib/hud/__tests__/hud-logic.test.ts`, with the rule that reads it |

The two springs are settings handed to the one shared spring (`stepSpring`, `useSpringCssVariable`); there is no
second spring. On 16 November the other new chrome (#357) moved two of the originals out of the shared modules
into modules only it loads, for the same reason, so reading those two from this screen would no longer cost a
planner without a flag anything. The copies stay while both chromes are behind flags, each still held to its
original where that now is. **When one of the two chromes is the planner, delete the copies and read the
originals.**

Three checks hold the rule, each as far as it can see:

- **From the sources** (`src/__tests__/bundle-splitting.test.ts`). It walks the imports from the app's entry and
  fails if: anything outside the screen imports one of its modules, other than the two imports on demand that
  fetch it; the screen is the only production importer of a name from a module the default planner already holds,
  or of a package path, unless that name is on the test's short list of seams (two today, each with its reason and its cost: the chrome's own switches, about 70 bytes of the shared runtime file; and the planner's own review of a layout's gangways, which the screen asks before it excuses a tight gap so that the rule about ways to a door has no second copy, 68 bytes of the planner page's file; a
  name that stops being a seam fails the test until it is taken off the list, as the seat line's spring hook did
  when #357's chrome began to import it too); or the screen imports a shared table whose entries the bundler
  keeps one by one (the spring table). It tells a name the rest of production builds anyway from one that only a
  dropped part of its module uses. It sees imports, not what the bundler makes of them, and it is general for
  imported names only. Four things it would not see: the screen alone reading an entry of some other shared
  table the bundler keeps entry by entry (it knows the spring table); a name that a production module imports
  and the bundler then drops as unused; and a member read through a module imported whole (`import * as`), which
  the test counts as reading every name; and a name the rest of production does import, but only inside the
  one file it is built into: the screen importing it too adds no code, only that name to the list the file hands
  to other files, which is a few bytes for everyone who fetches it (found on 22 November by the two builds: nine
  bytes, from the screen reading the record's own reading of `?event=`, which it no longer reads). None exists today. The comparison of two builds, below, is the proof
  for all four.
- **From the build** (`src/__tests__/hud-chunk-isolation.test.ts`, in CI's Build job). It walks the build twice
  from the page's own scripts: through every import except a flag's own three imports on demand, which is what a
  visitor with no flag can be sent; and through every import there is. What only the second walk reaches goes to
  a flag alone, whatever the bundler has named it. A visitor with no flag is sent none of the three, none of the
  screen's own words, not the other new chrome's frame for the room, and neither of the two things the screen
  once made everyone fetch. It sees one build, so it cannot compare with master.
- **Two builds from one tree, compared** (by hand; the scripts are outside the repository). This branch, and the
  same tree with the branch's modified files read as on master: every file's bytes, and every module's rendered
  code. No module the branch did not edit may render differently in a file sent without a flag, but for a named seam's own (the gangway review's wrapper: one function). Files of one length that still differ are read name by name: every name is resolved to what it stands for in both builds, and one build's file with its renames applied must be the other's byte for byte. This is the
  proof; the 13 November log has its reading.

Which chrome is on screen is asked of the page that mounted it (`mountedPlannerChrome`, `planner-chrome-flag.ts`),
never of the address or the device's memory at the moment of a click: another tab's flag can change that memory
after this page chose, and this page keeps the chrome it opened with.

## Honest numbers

The status line states measurements and counts, never verdicts: "80 of 120 seated", "Narrowest aisle 0.6 m", a
door with something standing in its space. See `docs/engineering/planner-honest-numbers.md`.

## Not built yet

- The stage on an upright phone or tablet (down the hall's length, facing the fireplace). Today an upright canvas
  opens on the planner's ordinary upright view, inside the hall. The hall's model is still cut as for the stage
  there (the wall the camera stands behind is lowered to under the floor, doors included, and the chandeliers show
  to 12.5 m), because the cuts follow the screen's asking for a stage, not a stage being held: the view is an
  ordinary orbit, but the walls are not the default planner's.
- A short wide window (a phone on its side): it keeps the one-row shelf with a sliding hand under a two-line bar,
  and has not been designed.
- Where the doors are: the door wall is the missing one, so the door spaces should show on the floor while a card
  is in hand.
- The card photographs as one matching set in 2:3 (today's are the square studio renders).
- Send for signed-in plans (`SubmitForReviewPanel`), and venue staff's tools behind the "more" glyph.
- Sound: a card lifting, a set landing, and the setting in More tools (Quiet unless chosen). The controls of the
  planner's sound engine live in `lib/sound-registry.ts`, which every planner and the landing page download, so
  wiring them to a screen behind a flag would grow that download for everyone. It follows once the engine's
  controls can be fetched on their own.
- `/plan?chrome=hud` checked against a running API.

## Delivery

1. Desktop screen complete at `/dev/planner-lab?chrome=hud` and `/plan?chrome=hud` on a local stack.
2. The items above, the repo's guards, typecheck, lint, build.
3. A pull request through the release lead; live at `venviewer.com/plan?chrome=hud` for Blake first.
4. On his word, the default flips to `hud`.
