# Planner chrome that folds away (T-680): design

Date: 28 Oct 2026. Branch `claude/planner-chrome-fold` (worktree `E:/claude/planner-chrome-fold`).
T-679 belongs to lane E's door rule, so this is T-680 (checked against master, open and closed PRs, branches
and the programme ledgers).

## Intent

Blake, 28 Oct 2026, with a screenshot of the live planner (`venviewer.com/plan/…`, Grand Hall, empty layout, night):
"The UI elements, I want to be able to minimise them for cleaner design. make it as aesthetic as possible, the
philosophy of the sublime as we have discussed throughout the project should be employed."

The v1 chrome covers 29.2 % of a 1600 × 1000 frame at rest, and 35.8 % at 1366 × 768
(`D:/claude/planner-qol-20261026/baseline/tasks.md:16`). The hall should be able to fill the screen.

The project's sublime is Burke's: scale, mass and luminous intensity met from a secure position, with clear,
dependable agency (`.claude/conventions/product-experience.md`). Folding gives the room back. The one mark that
stays, the venue's crest, is the way back to the tools, so nobody is ever stranded.

## Blake's decisions (28 Oct 2026, buttons in session "UI minimization and sublime aesthetics")

1. **Fold any panel, plus clear all.**
   - Each panel folds to a slim spine at its edge and stays folded on that device.
   - One key, or a click on the crest, clears every panel so the hall fills the screen.
   - The same key or the crest brings them all back.
2. **First open is as today; folds are remembered** per device.
3. **The fold control shows when you reach for it.** It is invisible at rest. It appears while the pointer is over
   that panel or focus is inside it, and is always shown where there is no hover.
4. **The playback was approved:** "Yes, write it up and build".
5. **"Crest hides; name goes home".** The crest becomes the switch that hides and shows the tools. The venue and
   room name beside it stays the link home. People who click the crest from habit get a one-line note saying how to
   bring the tools back.

The planner lead (L3) added these rules on 28 Oct:

- The Grand Assembly's Skip stays visible while the Assembly plays. Its resting "Replay the assembly" folds away
  under clear-all.
- Entering or leaving Present or the Assembly never overwrites the remembered folds.
- v2 follows later as one line in `ChromeShell`, routed through L3.

## Goals

- Four fold units in the desktop v1 planner, each folding on its own to a spine and back.
- One clear-all that hides every chrome surface and leaves only the crest seal.
  - It is reached by `\`, the crest, or a labelled menu item.
  - `\`, the crest or Esc restores exactly the previous folds.
- Phones and tablets: clear-all only (see Phones and tablets).
- The save truth is never hidden. Dialogs, notices, safety notices, the Assembly's Skip and errors still appear.
- Folding is silent, keyboard-accessible, reduced-motion aware, and remembered per device.

## Non-goals

- Wiring the v2 chrome (`?chrome=v2`) in this change.
- Moving the camera, or the view offset, when a panel folds. The v1 panels overlay the full-bleed canvas, so
  folding reveals more of the room.
- The orbit dimming of floating panels (planner-qol's PQ-1, #303). This feature never goes through
  `FloatingWidgetFrame`'s minimise.
- The duplicate empty states (A-15), Present itself, and any grade, vignette or render change.

## Anti-goals (a failure even if it "works")

- Chrome that hides itself (on orbit, idle or load). Only the person folds.
- Chrome that reopens itself. Only the person unfolds.
- A stranded person: any hidden state without a visible way back on screen.
- A hidden save failure, offline state or conflict.
- A new always-on button. Blake: "a mute button always on screen is not aesthetically pleasing".
- Remaining controls jumping when another unit folds. Controls never move; they fold into their own home.
- Motion on keyboard toggles; bounce; anything ambient or pulsing.

## Constraints

- **Keys.** `packages/web/src/lib/planner-keys.ts` owns every planner key and every Escape. New bindings go through
  `usePlannerKeyBindings`, and Escape steps go through `useEscapeLayer`.
  - A new kind, `chrome`, is added to `ESCAPE_ORDER` last, after `selection`. Modal, operation, popover, panel and
    selection all close first; the chair question (#290) holds a `modal` layer.
  - The guard test refuses any other keydown listener or Escape reading.
- **The approved chrome spec reserves the key** (`D:/claude/planner-polish-20261018/ui/final/spec.md` §4.3 and the
  keys table): "`\` hides them and `\` or Esc brings them back"; "`\` | Hide or show the chrome". v1 uses the same
  key. Tab is not used, because it is the browser's focus key.
- **Material and motion law** (spec §8):
  - No blur, `backdrop-filter` or CSS `filter`.
  - Transform and opacity only, with `--house-ease-out`.
  - Panels move 12 px from their own edge, from scale 0.96 with opacity: 240 ms in, 180 ms out.
  - Keyboard-initiated changes are instant.
  - Transitions, not keyframes.
  - Reduced motion uses 120 ms opacity fades.
  - Spines copy the v1 panel material they replace (`ReferenceViewer.css`), so a spine reads as its own panel
    folded.
- **Sound.** Panels are "silent by design" (spec §9). No new cue.
- **Ownership** (agreed 28 Oct with planner-qol, L3 and lane E):
  - Keep edits to `PlannerCockpit.tsx` and `ReferenceRoomHeader.tsx` to a few lines. #253 (planner-qol) also
    touches both, and whoever merges second rebases.
  - Do not edit `AssemblyReplay.tsx`, `GrandAssembly.tsx`, `FloatingWidgetFrame`, `PlannerCockpit.css`,
    `MobilePlannerTopBar.tsx`, `MobilePlannerChrome.css` or `MobilePlannerChrome.tsx`.
  - Phone menu entries go to planner-qol as a change request.
  - One rule may be added to `floor/assembly/assembly.css` (L3).
- **Programme.**
  - The release-candidate cut is Thu 29 Oct 18:00.
  - Merges go through orchestration-2's queue.
  - Heavy checks go through `heavy-hold.sh`, browser runs through `browser-hold.sh`.
  - Not GPU scope.

## The design

### State

```ts
type ChromeFoldUnit = "left" | "right" | "top" | "bottom";

interface ChromePresence {
  folded: Record<ChromeFoldUnit, boolean>; // remembered per device
  cleared: boolean;                        // this page only; reset when the cockpit unmounts
  clearHintsShown: number;                 // remembered; the note shows while < 3
}
```

- **The store** is a small Zustand store in a new file. Its actions are `fold(unit)`, `unfold(unit)`,
  `toggleFold(unit)`, `clearAll()`, `restoreAll()` and `toggleCleared()`.
  - Present, the Assembly and selection never write to it. Only the person's actions do.
- **Persistence.** `localStorage["venviewer.planner-chrome-folds"]` holds `{ "v": 1, "folded": {…}, "hints": n }`.
  - Reads are defensive. Any parse or shape failure, or storage that throws, gives everything open.
  - Writes sit inside try/catch, and the page renders correctly without storage.
- **The DOM mirror.** While the cockpit is mounted, the state is mirrored as attributes on the document root,
  `<html>`: `data-planner-fold-left="folded"`, …, and `data-planner-chrome="cleared"`. The cockpit removes them on
  unmount.
  - The root is used because part of the chrome sits outside `.cockpit-shell`: `EditorPage`'s right-hand buttons
    and the phone sheets that portal to `<body>`.
  - CSS reads the attributes, so units rendered deep inside `App` (the command deck) fold without edits to their
    components.
- **The opt-in contract.** Any element carrying the attribute `data-chrome-surface` hides under clear-all. Lane E's
  door notice uses it. Other lanes can use it without touching this feature's files.

### The four fold units (desktop v1 cockpit)

| Unit | What folds (all of it, together) | Spine |
|---|---|---|
| `left` | `.reference-left-dock`: the lens rail, the room header (crest, venue, "Layout saved") and On the floor | A vertical spine at the left edge, top-aligned with the dock: "On the floor" set vertically in 11 px capitals, with the count |
| `right` | `CockpitRightDock` (Details) and the right-hand column under it: the 3D/2D switch, Event details and Send | A vertical spine at the right edge, top-aligned with the dock: "Details", plus the selected piece's name when there is a selection |
| `top` | `ToolPill`, and the round "…" if it belongs to the same cluster | A short tab at the top edge on the pill's centre line, naming the current tool |
| `bottom` | The room timeline bar (`CockpitBottom`, when present), the command deck (Furniture … Present) and the view controls (Plan · Room · Walk · hour) | A short tab at the bottom edge on the deck's centre line. Builder's call (review round, 28 Oct): it names nothing. The view controls differ by room and are absent from most rooms for visitors, and the hour exists only under the Grand Hall's sky, so there is no one current state to name |

- **The spine** is a `<button aria-expanded="false" aria-controls="…">` named "Show On the floor" and so on.
  - Hit target at least 36 px, 44 px on coarse pointers.
  - One 2 px focus ring. Hover changes colour only.
- **The fold mark.** Each open unit has a small mark pointing toward its own edge: `‹` for the left unit, `›` for
  the right, a chevron up for the top and down for the bottom.
  - It sits on the unit's edge, half on the unit and half off it, where the unit has only its own padding (review
    round, 28 Oct). The first placing, at the outer top corner, put the right mark over the Details panel's
    "Clear furniture selection" x and the left one over the lowest lens buttons, and left a gap the hand fell
    through above the bottom bar. So:
    - the side docks' marks straddle their inner edges, level with their headings (24 × 40 px; 24 × 48 on coarse
      pointers), and co-editing presence begins where the right one ends. Under 750 px the tool bar's row runs
      under the docks, so there they sit below it (70 px down);
    - the tool bar's mark hangs from the top of the screen onto the bar's upper edge;
    - the bottom bar's hangs under the deck, 4 px onto its lower edge. It is drawn above the stage, as the side
      marks are, so the room timeline's bar never buries its lower edge.
  - A mark takes a press for 280 ms after its unit is left, so a hand that leaves the unit at an angle still
    reaches it.
  - It is a `<button aria-expanded="true">` named "Fold On the floor" and so on.
  - Under `(hover: hover) and (pointer: fine)` it shows only while the unit is hovered or contains keyboard focus.
    It stays in the tab order, and focus makes it visible.
  - Where there is no hover, it is always shown.
- **Focus.** After a fold, focus goes to the spine. After an unfold, focus goes to that unit's fold mark, so the
  same key reverses it. Focus never stays on chrome that has just gone (WCAG 2.4.3):
  - clearing moves it to the crest (a phone's seal);
  - bringing the tools back while the left unit is folded moves it to the left spine (a phone's top bar, its
    first button that takes focus);
  - after a pointer's change, a browser that leaves focus on what has then faded away has it moved too;
  - a phase preview ending inside a folded unit (its timeline or the right-hand column) moves it to that unit's
    spine;
  - focus the chrome moves to the crest arrives without the crest's name, so the next Esc restores at once.
- **A fold closes nothing.** A menu inside the unit goes and comes back with it. The catalogue beside the left dock
  and a note in the room are not the unit's to close (review round: folding Details used to close the catalogue
  and drop the tool to Select). Only clear-all closes popovers and panels first.
  - Esc never closes something nobody can see. An Escape layer may name its element (`planner-keys.ts`), and
    while that is hidden the ladder passes it by. The hour popover in the bottom bar does, so after a keyboard
    fold it neither takes the next Esc nor goes; it comes back with the bar.
- **What a spine says.** Its name is short ("Show On the floor"). The tool bar's spine also names the tool in hand,
  in its name and on its face ("Show the tool bar · Measure"). What else a spine shows (the count, save trouble,
  the selected piece) is its description, so a screen reader hears it too.
- **Hidden means unreachable.** A folded unit, and every surface while cleared, becomes `visibility: hidden` when
  its exit transition ends, so it cannot be tabbed, clicked or read. It stays mounted, so its state survives.
- **Never folded.** The phase-preview lock (shown in place of Details during a phase preview) and every other
  safety notice stay visible whatever the folds.
  - During a phase preview, its one exit (the room timeline's "Exit preview") and the right-hand column stay
    visible too. They come back under the folds when the preview ends (review round: a folded bottom bar hid the
    only way out of a preview).

### Clear-all and the crest

- **The crest.**
  - While the tools show, the crest in the room header is a `<button>`, split out of the home link (decision 5),
    with the label "Hide the tools · \". The name beside it stays the link home.
  - While cleared, a seal holding the same crest sits at exactly the crest's resting position. It sits there even
    if the left unit was folded. It is the one control on screen, labelled "Show the tools · \".
  - Both are at least 36 px (44 px on coarse pointers), with an accessible name and the one focus ring.
  - Its label shows under it when a mouse rests on it for 400 ms or keyboard focus reaches it. The label is a real
    element inside the crest, so the hand can move onto it without it going, and it sits on the Escape ladder's
    tooltip rung, so Esc puts it away without moving either (WCAG 1.4.13; review round).
    - It hangs from the foot of the crest's row, not the crest's, so it lies only over the line about saving,
      never over the link home however the venue's name wraps. The way down to it is no wider than the crest.
    - Pressing the crest answers it: the label stays away until the hand and the keyboard have both left, so the
      next Esc brings the tools back.
      - It is answered as the tools go or come, from where the events say the hand and the keyboard are. A press
        or a key can land before React has drawn the hand's arrival (an arrival is a continuous update, a press
        a discrete one): deciding from the drawn state brought the label back 400 ms after a quick press (4 Nov,
        frame 09). Answering on pointerdown instead took the label's hit area away mid-press, so a press on its
        words lost its click (4 Nov review). A press that toggles nothing, such as the context menu's, leaves it.
      - Known limit: the way down to the label is the crest's own column. A hand that cuts across the venue's
        name towards the label's far end leaves the crest and loses the label; a pointer grace area would keep
        it.
- **Toggles:**
  - `\`, a binding at `KEY_PRIORITY.planner`. It never fires while typing in a field or while a dialog holds the
    keyboard. It also answers `\` typed with AltGr (German, French, Spanish and Nordic keyboards, which the
    browser reports as Ctrl and Alt) and with a Mac's Option.
  - The crest.
  - A labelled "Hide the tools · \" item in the planner's existing overflow menu. That menu ("…") lives in
    `VerticalToolbox.tsx`, which is lane E's file, so the item goes to lane E as a one-line change request. The
    crest's own label already gives a named pointer path.
  - On phones, the More sheet: a change request to planner-qol.
- **Clearing first closes** the open popovers and panels: Escape layers of kind `popover` and `panel`, such as the
  catalogue and the hour popover. Then it hides the chrome. An Esc on a bare screen never closes something
  invisible.
  - The desktop "…" tools are not an Escape layer yet (`VerticalToolbox.tsx`'s own state). Until lane E registers
    them as a `panel`, they fold with the tool bar and hide with the rest, and come back open.
  - Operations (placing, measuring, drawing, Present) and the selection carry on. They are visible in the room, and
    Esc reaches them first.
- **What clear-all hides:**
  - the four units and their spines;
  - the When ribbon;
  - open floating tool panels;
  - the Submit for review pill;
  - the phone top bar, dock and sheets;
  - anything carrying `data-chrome-surface`;
  - The units move as the Motion section says. The rest (floating panels, the ribbon, the review pill, opted-in
    surfaces) only fade, because a floating panel's place is its own inline transform, which a scale would
    pull toward the corner (review round).
  - the Assembly's resting "Replay the assembly", via one rule in `assembly.css` keyed on
    `.assembly-replay[data-playing="false"]`.
- **What clear-all never hides:**
  - dialogs and modals;
  - receipts, notices, errors and `Activity` states;
  - the Assembly's Skip while it plays;
  - the phase-preview lock;
  - in-scene overlays: nameplates, guides, live co-editing presence and the door's floor glow.
- **Esc** restores the chrome as the last rung of the ladder.
- **Restore** returns exactly the per-unit folds that were in place. Menus closed by clearing stay closed.
- **Teaching.** The first three times on a device, a one-line note by the seal reads "The tools are hidden · press \
  or the crest to bring them back". It uses `role="status"` and fades after about 4 s.
  - It sits just right of the crest, on its centre line, measured, because the crest moves with the venue's name
    and the rail's width. The crest's own name waits while the note speaks, so the two never overlap.
  - Its `role="status"` region is in the accessibility tree before its words arrive, with only the ink fading, so
    the words are spoken. A region that appears already holding its text often is not. The spoken line says
    "backslash": at its usual punctuation level a screen reader says nothing for a bare "\".
- **Save truth.** While cleared, or while the left unit is folded, any not-saved, failed, offline or
  changed-elsewhere state appears as a status word beside the seal or on the left spine. It uses the header's own
  words and status ink. While saved, nothing extra shows.
  - The header's live region goes with a folded or cleared dock. So a second, always-present status region speaks
    for the header while it is away: every change to its save line from the moment it went (recovery too), and
    nothing it had already said, so nothing is heard twice. On a phone the top bar keeps its own voice, so this
    one speaks only while the chrome is cleared. The left spine carries the trouble as its description (review
    rounds, 28 and 29 Oct).
- **Leaving the cockpit** (2D, another page) resets `cleared`. Folds stay.

### Motion

- **Pointer-initiated fold.** The unit leaves toward its own edge: 12 px, scale 0.96 from that edge, opacity to 0,
  over 180 ms. Its spine arrives in 240 ms.
- **Unfold** is the reverse: the unit in 240 ms, the spine out 180 ms.
- **Clear-all from the crest or a menu** uses the same pairs, with no stagger.
- **Keyboard-initiated** changes are instant: `\`, Esc, and Enter or Space on a spine, mark or crest.
- **Arriving.** The cockpit's first frame shows remembered folds as they are, without motion. Motion returns on the
  next frame unless the person has changed something since. It never waits on what a cockpit that went before
  left behind (a probe on 29 Oct found motion stuck off after the cockpit came back, taking the marks' fade and
  grace with it).
- **Centred units** (the deck and view controls) are centred with `transform: translateX(-50%)`. The motion uses the
  individual `translate` and `scale` properties, so the centring is never overwritten. Coming back, from an unfold
  or a restore, each unit keeps the corner it left from, so the centred ones never slide sideways as they grow.
- **Reduced motion:** 120 ms opacity only.
- **Silent.**

### Phones and tablets (the v1 mobile cockpit)

The code sends phones and touch tablets to the mobile cockpit: `mobile = isNarrow || isTouch`,
`EditorPage.tsx:581`.

- That cockpit uses sheets, not side docks. So there is no per-unit folding: clear-all only.
- Clear-all hides the top bar, the dock and any sheet.
- "Hide the tools" goes into the More sheet as a one-line change request to planner-qol.
- The crest seal (44 px, top-left, inside the safe area) restores.
- `\` works on tablets with a keyboard.

### v2

The store, the `\` and Esc bindings, and the `data-chrome-surface` contract are chrome-agnostic. v2 (behind
`?chrome=v2`) gets the same behaviour later, when `ChromeShell` reads the store. That is a change request to lane C,
routed through L3, and it is not in this change.

## Left to the builder

- Exact spine sizes, the reading direction of vertical labels, glyphs, positions and the precise selectors.
- Whether the fold marks render inside each unit or as siblings positioned with `:has()`. Choose whichever touches
  the contested files least.
- Test structure.

## Verification

- **Unit tests (vitest):**
  - the store, including corrupt and absent storage;
  - `\` toggles, and is ignored in text fields and under a dialog;
  - Esc restores only when no other layer is open;
  - clearing closes popover and panel layers;
  - ARIA and focus on spines, fold marks, the crest and the seal;
  - the save-truth word.
  - The keyboard-owner guard test stays green.
- **Browser evidence** on the product host (`local.venviewer.com`, real WebGPU, production showcase asset):
  - frames at 1600 × 1000 (night and day) at rest, with each unit folded, with all folded, and cleared;
  - frames at 1366 × 768, and at 393 × 852 cleared;
  - chrome share measured for each frame;
  - a keyboard-only run and an axe run.
- **After deploy:** check the live flow on `venviewer.com/plan`.
- Blake judges the look.
