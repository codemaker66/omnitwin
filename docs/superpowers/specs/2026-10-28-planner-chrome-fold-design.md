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
| `bottom` | The room timeline bar (`CockpitBottom`, when present), the command deck (Furniture … Present) and the view controls (Plan · Room · Walk · hour) | A short tab at the bottom edge on the deck's centre line, naming the view and hour ("Room · 22:00") |

- **The spine** is a `<button aria-expanded="false" aria-controls="…">` named "Show On the floor" and so on.
  - Hit target at least 36 px, 44 px on coarse pointers.
  - One 2 px focus ring. Hover changes colour only.
- **The fold mark.** Each open unit has a small mark at its outer top corner, pointing toward its own edge: `‹` for
  the left unit, `›` for the right, a chevron up for the top and down for the bottom.
  - It is a `<button aria-expanded="true">` named "Fold On the floor" and so on.
  - Under `(hover: hover) and (pointer: fine)` it shows only while the unit is hovered or contains focus. It stays
    in the tab order, and focus makes it visible.
  - Where there is no hover, it is always shown.
- **Focus.** After a fold, focus goes to the spine. After an unfold, focus goes to that unit's fold mark, so the
  same key reverses it.
- **Hidden means unreachable.** A folded unit, and every surface while cleared, becomes `visibility: hidden` when
  its exit transition ends, so it cannot be tabbed, clicked or read. It stays mounted, so its state survives.
- **Never folded.** The phase-preview lock (shown in place of Details during a phase preview) and every other
  safety notice stay visible whatever the folds.

### Clear-all and the crest

- **The crest.**
  - While the tools show, the crest in the room header is a `<button>`, split out of the home link (decision 5),
    with the label "Hide the tools · \". The name beside it stays the link home.
  - While cleared, a seal holding the same crest sits at exactly the crest's resting position. It sits there even
    if the left unit was folded. It is the one control on screen, labelled "Show the tools · \".
  - Both are at least 36 px (44 px on coarse pointers), with an accessible name and the one focus ring.
- **Toggles:**
  - `\`, a binding at `KEY_PRIORITY.planner`. It never fires while typing in a field or while a dialog holds the
    keyboard.
  - The crest.
  - A labelled "Hide the tools · \" item in the planner's existing overflow menu. That menu ("…") lives in
    `VerticalToolbox.tsx`, which is lane E's file, so the item goes to lane E as a one-line change request. The
    crest's own label already gives a named pointer path.
  - On phones, the More sheet: a change request to planner-qol.
- **Clearing first closes** the open popovers and panels: Escape layers of kind `popover` and `panel`, such as the
  "…" tools, the catalogue and the hour popover. Then it hides the chrome. An Esc on a bare screen never closes
  something invisible.
  - Operations (placing, measuring, drawing, Present) and the selection carry on. They are visible in the room, and
    Esc reaches them first.
- **What clear-all hides:**
  - the four units and their spines;
  - the When ribbon;
  - open floating tool panels;
  - the phone top bar, dock and sheets;
  - anything carrying `data-chrome-surface`;
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
- **Save truth.** While cleared, or while the left unit is folded, any not-saved, failed, offline or
  changed-elsewhere state appears as a status word beside the seal or on the left spine. It uses the header's own
  words and status ink. While saved, nothing extra shows.
- **Leaving the cockpit** (2D, another page) resets `cleared`. Folds stay.

### Motion

- **Pointer-initiated fold.** The unit leaves toward its own edge: 12 px, scale 0.96 from that edge, opacity to 0,
  over 180 ms. Its spine arrives in 240 ms.
- **Unfold** is the reverse: the unit in 240 ms, the spine out 180 ms.
- **Clear-all from the crest or a menu** uses the same pairs, with no stagger.
- **Keyboard-initiated** changes are instant: `\`, Esc, and Enter or Space on a spine, mark or crest.
- **Centred units** (the deck and view controls) are centred with `transform: translateX(-50%)`. The motion uses the
  individual `translate` and `scale` properties, so the centring is never overwritten.
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
