# Planner chrome fold (T-680) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every v1 planner panel folds to a spine and back. One clear-all (`\`, the crest, Esc) leaves only the
crest over the hall.

**Architecture:** A small Zustand store holds the folds (in `localStorage`) and the page-only cleared flag. A hook
mirrors that state onto `<html>` as data attributes and owns the `\` binding and the `chrome` Escape rung, through
`lib/planner-keys.ts`. One CSS file folds the existing v1 containers by those attributes, so no unit component
changes.

New buttons (spines, fold marks, a hint, a save word, a phone seal) live in one new component file, mounted by
`PlannerCockpit`. The crest moves out of the home link into its own button.

**Tech Stack:** React 18, TypeScript strict, Zustand, Vitest + Testing Library (happy-dom), plain CSS.

**Spec:** `docs/superpowers/specs/2026-10-28-planner-chrome-fold-design.md`

## Global Constraints

- **Storage.** The key is `venviewer.planner-chrome-folds`, holding `{ "v": 1, "folded": {left,right,top,bottom}, "hints": n }`.
  Every storage access sits inside try/catch, and anything malformed means everything is open.
- **Clear-all is never persisted.** Leaving the cockpit resets it.
- **Keys.**
  - `\` is `{ key: "\\" }` at `KEY_PRIORITY.planner`, with `inFields` false and `duringModal` false. After the
    review round it is also `{ key: "\\", mod: true, alt: true }` (AltGr) and `{ key: "\\", alt: true }` (Option).
  - The new kind `chrome` goes last in `ESCAPE_ORDER`.
  - No other file may quote `"Escape"` or add a `keydown` listener (`planner-keyboard-owner.test.ts`).
- **Motion.**
  - Pointer fold: out 180 ms, in 240 ms, with `--house-ease-out`.
  - Translate 12 px toward the unit's own edge, scale 0.96 from that edge, opacity to 0.
  - Use the individual `translate` and `scale` properties, never `transform`.
  - Keyboard actions are instant. Reduced motion uses 120 ms opacity only.
- **Effects.** No blur, `filter` or `backdrop-filter` in new CSS.
- **Silent:** no sound calls.
- **Copy, verbatim:**
  - "Hide the tools · \\" and "Show the tools · \\" (the crest, while shown and while cleared);
  - "Fold On the floor", "Show On the floor", "Fold Details", "Show Details" (the right unit takes the open lens's
    name, such as "Fold Guests"), "Fold the tool bar", "Show the tool bar", "Fold the bottom bar", "Show the bottom
    bar". These were renamed while building: "the tools" belongs to the crest alone, and the bottom bar holds more
    than furniture and views. The folded tool bar's spine adds the tool in hand: "Show the tool bar · Measure";
  - "The tools are hidden · press \\ or the crest to bring them back".
- **Review round (28 Oct).** An adversarial review confirmed 26 findings (17 once merged), all fixed before
  shipping. The spec records each decision where it applies: mark placement, a fold closing nothing, the phase
  preview's exit, focus, the crest's label, the live regions, AltGr, and what only fades. The findings are in
  `D:/claude/planner-chrome-fold-20261028/review-findings.md`.
- **Hint and target sizes.** The hint shows while fewer than 3 have been shown on the device, for about 4 s. Hit
  targets are at least 36 px, 44 px on coarse pointers.
- **Files.** Do not edit `AssemblyReplay.tsx`, `GrandAssembly.tsx`, `FloatingWidgetFrame*`, `PlannerCockpit.css`,
  `MobilePlanner*`, `VerticalToolbox.tsx` or `PlannerCommandDeck.tsx`.

## Review Focus

1. **`\` typed in "Find a table or piece".** It must type, not clear.
   *Test: Task 3, `ignores backslash typed in a field`.*
2. **Esc on a cleared screen with a selection.** The first press clears the selection, the second restores.
   *Test: Task 1, `chrome steps back only after selection`.*
3. **A folded left unit while a save fails or the browser is offline.** The left spine shows "Retry save" or
   "Offline · not saved yet".
   *Test: Task 4, `folded left spine names save trouble`.*
4. **A reload after clearing.** The page comes back shown, with folds intact.
   *Test: Task 2, `never remembers cleared`.*
5. **Clearing while the "…" tools or the catalogue is open.** They close first, so the next Esc restores.
   *Test: Task 1, `closeOpenLayers closes popovers and panels only`.*

---

### Task 1: The `chrome` Escape rung and closing open layers

**Files:**
- Modify: `packages/web/src/lib/planner-keys.ts:34-36` (kind and order); add `closeOpenLayers` after `stepBack`
- Test: `packages/web/src/lib/__tests__/planner-keys.test.ts`

**Interfaces:**
- Produces: `EscapeLayerKind` includes `"chrome"`; `ESCAPE_ORDER` ends with `"chrome"`;
  `closeOpenLayers(kinds: readonly EscapeLayerKind[]): number`. It escapes each open layer of those kinds once, in
  ladder order, returns how many it closed, and returns no focus.

- [ ] **Step 1:** Write the failing tests.
  - `chrome steps back only after selection`: register selection and chrome layers, both open. The first Esc keydown
    calls the selection's `escape` only; the second calls the chrome's.
  - `closeOpenLayers closes popovers and panels only`: register one open layer of each of modal, operation,
    popover, panel, selection and chrome. `closeOpenLayers(["popover","panel"])` returns 2 and calls only those two
    `escape`s.
- [ ] **Step 2:** `pnpm --filter @omnitwin/web exec vitest run src/lib/__tests__/planner-keys.test.ts` should FAIL
  (`"chrome"` is not assignable; `closeOpenLayers` is not exported).
- [ ] **Step 3:** Implement. Append `"chrome"` to the union and to `ESCAPE_ORDER`. `closeOpenLayers` snapshots
  `openLayers()`, filters it by kind, and calls each `escape()`.
- [ ] **Step 4:** Run the file again; it should PASS.
- [ ] **Step 5:** Commit: `feat(planner): a chrome rung at the foot of the Escape ladder (T-680)`.

### Task 2: The chrome presence store

**Files:**
- Create: `packages/web/src/stores/chrome-presence-store.ts`
- Test: `packages/web/src/stores/__tests__/chrome-presence-store.test.ts`

**Interfaces:**
- Consumes: `closeOpenLayers`, `lastInputWasKeys` (`lib/planner-keys.ts`).
- Produces:

```ts
export type ChromeFoldUnit = "left" | "right" | "top" | "bottom";
export type ChromeFolds = Readonly<Record<ChromeFoldUnit, boolean>>;
export const CHROME_FOLD_UNITS: readonly ChromeFoldUnit[];
export const CHROME_FOLDS_STORAGE_KEY = "venviewer.planner-chrome-folds";
export const CLEAR_HINT_LIMIT = 3;
export function readRememberedFolds(storage: Pick<Storage, "getItem"> | null): { folds: ChromeFolds; hints: number };
export interface ChromePresenceState {
  readonly folded: ChromeFolds;
  readonly cleared: boolean;
  readonly instant: boolean;        // the last change came from the keyboard
  readonly hintPending: boolean;    // the clear-all note is due now
  readonly hintsShown: number;
  readonly fold: (unit: ChromeFoldUnit) => void;
  readonly unfold: (unit: ChromeFoldUnit) => void;
  readonly toggleFold: (unit: ChromeFoldUnit) => void;
  readonly clearAll: () => void;
  readonly restoreAll: () => void;
  readonly toggleCleared: () => void;
  readonly dismissHint: () => void;
  readonly resetCleared: () => void; // the cockpit unmounted
}
export const useChromePresenceStore: UseBoundStore<StoreApi<ChromePresenceState>>;
```

- [ ] **Step 1:** Write the failing tests.
  - `starts open with nothing stored`.
  - `remembers a fold`: after `fold("left")`, storage holds `{"v":1,"folded":{"left":true,"right":false,"top":false,"bottom":false},"hints":0}`.
  - `reads malformed storage as everything open`: try `"{"`, `{"v":2}` and `{"v":1,"folded":{"left":"yes"}}`.
  - `survives storage that throws`: `getItem` and `setItem` throw, and nothing escapes.
  - `clearAll keeps the folds and restoreAll returns them`.
  - `never remembers cleared`: no stored key mentions `cleared`.
  - `counts the hint to three`: four `clearAll`/`restoreAll` cycles leave `hintPending` true on cycles 1-3, false on
    cycle 4, and `hintsShown` at 3.
  - `fold and clearAll close open popovers and panels`: spy on `closeOpenLayers` and expect `["popover","panel"]`.
  - `resetCleared clears without touching folds`.
- [ ] **Step 2:** Run it; it should FAIL (the module does not exist).
- [ ] **Step 3:** Implement with `create` (no middleware, the same style as `planner-chrome-store.ts`).
  - `instant` is set from `lastInputWasKeys()` on every action.
  - Storage is `window.localStorage`, read once at module load inside try/catch.
- [ ] **Step 4:** Run it; it should PASS.
- [ ] **Step 5:** Commit: `feat(planner): a store for folded and cleared chrome (T-680)`.

### Task 3: The mirror and keys hook

**Files:**
- Create: `packages/web/src/components/editor/cockpit/ChromeFold.tsx` (hook part)
- Test: `packages/web/src/components/editor/cockpit/__tests__/ChromeFold.test.tsx`

**Interfaces:**
- Consumes: the Task 2 store; `usePlannerKeyBindings`, `useEscapeLayer`, `KEY_PRIORITY`.
- Produces: `useChromePresence(): void`.
  - It mirrors to `document.documentElement` the attributes `data-planner-fold-{unit}` (`"folded"`, or
    `"unfolding"` for 240 ms after an animated unfold), `data-planner-chrome` (`"cleared"`, or `"restoring"` for
    240 ms) and `data-planner-chrome-motion="instant"` when `instant`.
  - It removes every attribute, and calls `resetCleared()`, on unmount.
  - It binds `\` to `toggleCleared` and holds a `chrome` Escape layer, open while `cleared`, whose escape is
    `restoreAll`.

- [ ] **Step 1:** Write the failing tests.
  - `mirrors folds and clearing onto the document`.
  - `removes its attributes on unmount`.
  - `backslash clears and restores`.
  - `ignores backslash typed in a field`: focus an `<input type="search">`; the key leaves the store untouched.
  - `Esc restores a cleared screen`.
  - `keyboard changes are instant`.
- [ ] **Step 2:** Run; it should FAIL.
- [ ] **Step 3:** Implement. `useEffect` over a store subscription writes the attributes. Each unit's `unfolding` and
  `restoring` timer is cleared on change and on unmount.
- [ ] **Step 4:** Run; it should PASS. Also run `src/__tests__/planner-keyboard-owner.test.ts` and expect PASS.
- [ ] **Step 5:** Commit: `feat(planner): mirror folds onto the page and bind \ and Esc (T-680)`.

### Task 4: Spines, fold marks, the hint, the save word, the phone seal

**Files:**
- Modify: `packages/web/src/components/editor/cockpit/ChromeFold.tsx` (components)
- Test: `packages/web/src/components/editor/cockpit/__tests__/ChromeFold.test.tsx`

**Interfaces:**
- Consumes: the Task 2 store; `headerSaveLabel` (`ReferenceRoomHeader.tsx`); `useEditorStore`, `useOnlineStatus`,
  `usePlacementStore`, `useSelectionStore`, `usePlannerVenueIdentity`.
- Produces:
  - `ChromeSpines(): ReactElement`: four `<button class="chrome-spine chrome-spine--{unit}" aria-expanded="false"
    aria-controls>` elements, always rendered and hidden by CSS until folded. The left spine reads "On the floor"
    with the piece count; the right reads "Details", with "· {name}" when one piece is selected.
  - `ChromeFoldMarks(): ReactElement`: four `<button class="chrome-fold-mark chrome-fold-mark--{unit}"
    aria-expanded="true">`. The left mark renders inside the left dock (`PlannerCockpit` passes it as a child); the
    others are siblings.
  - `ChromeClearHint(): ReactElement | null`: `role="status"` while `hintPending`, calling `dismissHint` after
    4000 ms.
  - `ChromeSaveWord(): ReactElement | null`: shows the header's word only for save trouble ("Reload layout",
    "Offline · not saved yet", "Retry save"), on the left spine and beside the crest while cleared.
  - `PhoneChromeSeal(): ReactElement | null`: a 44 px button with the venue logo, named "Show the tools", rendered
    while cleared on the mobile cockpit.
  - Focus after a fold goes to that unit's spine; after an unfold it goes to that unit's mark (via `requestAnimationFrame`).

- [ ] **Step 1:** Write the failing tests.
  - `names every spine and mark`: the exact names from Global Constraints, with `aria-expanded` values.
  - `a mark folds its unit and focus moves to the spine`.
  - `a spine unfolds and focus returns to the mark`.
  - `folded left spine names save trouble`: with `saveError` set, it contains "Retry save"; with `online` false and
    `isDirty`, it contains "Offline · not saved yet".
  - `the hint shows three times then never`.
  - `the phone seal restores`.
- [ ] **Step 2:** Run; it should FAIL.
- [ ] **Step 3:** Implement. Glyphs are inline SVG chevrons (no icon font); the count uses the outliner's own count.
- [ ] **Step 4:** Run; it should PASS.
- [ ] **Step 5:** Commit: `feat(planner): spines, fold marks and the clear-all note (T-680)`.

### Task 5: The crest becomes the switch; the name stays the way home

**Files:**
- Modify: `packages/web/src/components/editor/cockpit/ReferenceRoomHeader.tsx:58-66`
- Test: `packages/web/src/components/editor/cockpit/__tests__/ReferenceRoomHeader.test.tsx` (logo assertions move
  from the link to the crest button)

**Interfaces:**
- Produces:
  - `.reference-identity` wraps `<button type="button" class="reference-crest" data-planner-crest
    aria-keyshortcuts="\" aria-label={cleared ? "Show the tools" : "Hide the tools"} data-label={…" · \\"}
    onClick={toggleCleared}>` (the img or `Building2`).
  - It also wraps the existing `<Link class="reference-wordmark">`, which keeps the venue copy and its aria-label.

- [ ] **Step 1:** Update the tests.
  - Logo `img` and `svg` checks query `getByRole("button", { name: "Hide the tools" })`. The link still carries the
    name and the `[data-activity-indicator]`.
  - New test: `the crest hides and shows the tools`.
- [ ] **Step 2:** Run the header test; it should FAIL.
- [ ] **Step 3:** Implement the split. Nothing else in the file changes.
- [ ] **Step 4:** Run the header test and `PlannerCockpit.test.tsx`; both should PASS.
- [ ] **Step 5:** Commit: `feat(planner): the crest folds the tools away; the name still goes home (T-680)`.

### Task 6: The fold CSS

**Files:**
- Create: `packages/web/src/components/editor/cockpit/ChromeFold.css` (imported by `ChromeFold.tsx`)
- Modify: `packages/web/src/floor/assembly/assembly.css` (one rule, after line 33)
- Test: `packages/web/src/components/editor/cockpit/__tests__/chrome-fold-css.test.ts` (reads the file text)

**Interfaces:**
- Consumes: the Task 3 attributes; the selectors in `ReferenceViewer.css`:
  - left: `.reference-left-dock`;
  - right: `.reference-viewer > :is(.reference-inspector-dock, .cockpit-panel:not(.cockpit-preview-lock), .lens-panel, .cockpit-truth)`
    and `.reference-view-switch`, `.reference-handoff-action`, `.reference-event-details`;
  - top: `.reference-viewer .planner-tool-pill`, `.reference-more-tools`;
  - bottom: `.reference-viewer > .cockpit-bottom`, `.reference-viewer .planner-command-deck.is-reference-compact`,
    `.reference-layer-controls`;
  - cleared also: `.reference-when-ribbon`, `[data-chrome-surface]`; on phones, the top bar, `.mobile-planner-dock`,
    `.mobile-planner-utilities`, `.cockpit-shell.is-mobile > .cockpit-bottom` and `.lens-sheet-layer`.
- Rules:
  - Transitions exist only in the `folded`, `unfolding`, `cleared` and `restoring` states; the rest state keeps each
    unit's own CSS.
  - Hiding uses `visibility: hidden` delayed by the out duration.
  - While cleared, the left dock stays in place, its plate and contents fade, and `.reference-crest` keeps
    `visibility: visible`.
  - The `instant` attribute sets `transition: none`.
  - Reduced motion uses 120 ms opacity with no translate or scale.
  - Spines and marks copy the dock plate: `rgba(18,17,15,.91)`, `1px var(--cockpit-hairline)`, radius 7px.
  - Marks show under `(hover:hover) and (pointer:fine)` only while their unit or the mark is hovered, or the mark is
    focused. They always show under `(hover:none)`.
  - The assembly rule:
    `html[data-planner-chrome="cleared"] .assembly-replay[data-playing="false"] { opacity: 0; visibility: hidden; pointer-events: none; }`.

- [ ] **Step 1:** Write the failing tests: `no blur or filter`, `has a reduced-motion block`, `moves with translate
  and scale, never transform`, `hides opted-in surfaces`, `keeps the crest visible while cleared`.
- [ ] **Step 2:** Run; it should FAIL.
- [ ] **Step 3:** Write the CSS.
- [ ] **Step 4:** Run; it should PASS.
- [ ] **Step 5:** Commit: `feat(planner): fold and clear the v1 chrome in CSS (T-680)`.

### Task 7: Wire it into the cockpit

**Files:**
- Modify: `packages/web/src/components/editor/cockpit/PlannerCockpit.tsx`:
  - call `useChromePresence()`;
  - put the left mark in `.reference-left-dock`;
  - add spines, marks, hint and save word on desktop;
  - add the phone seal and hint on mobile.
- Test: `packages/web/src/components/editor/cockpit/__tests__/PlannerCockpit.test.tsx`

- [ ] **Step 1:** Write the failing tests.
  - `desktop gets spines and marks`.
  - `mobile gets no spines or marks, only the seal when cleared`.
- [ ] **Step 2:** Run; it should FAIL.
- [ ] **Step 3:** Wire it, in a few lines.
- [ ] **Step 4:** Run the cockpit, ChromeFold, header and keyboard-owner tests, one file per run, with
  `TZ=UTC --maxWorkers=1`. All should PASS.
- [ ] **Step 5:** Commit: `feat(planner): fold the planner's panels and clear them all (T-680)`.

### Task 8: Verify, record, ship

- [ ] **Static checks, under `heavy-hold.sh`.** First `rm -f packages/web/tsconfig.tsbuildinfo`. Then
  `pnpm --filter @omnitwin/web typecheck`, `pnpm --filter @omnitwin/web lint` and the cockpit/editor test folders.
  All should be clean.
- [ ] **Browser evidence, under `browser-hold.sh`.** Use the product host `local.venviewer.com` with real WebGPU,
  and assert `isSecureContext` and `__venPerf.gl.backend.isWebGPUBackend`.
  - frames at 1600 × 1000 (night and day) at rest, each unit folded, all folded, and cleared;
  - frames at 1366 × 768, and at 393 × 852 cleared;
  - chrome share for each frame;
  - a keyboard-only walk (`\`, Esc, Tab to the marks);
  - an axe run.
  - Show Blake the frames as AskUserQuestion previews.
- [ ] **Record and merge.**
  - Add the T-680 rows to `docs/state/tasks.md` and today's section to `docs/sessions/2026-10-28.md`, after a rebase
    on master.
  - Open the PR; send orchestration-2 its number and tested head; after the merge, check the live
    `venviewer.com/plan`.
  - Send change requests: v2 (`ChromeShell` reads the store) to L3; "Hide the tools" in the phone More sheet to
    planner-qol; "Hide the tools · \" in the desktop "…" menu (`VerticalToolbox.tsx`) to lane E.
