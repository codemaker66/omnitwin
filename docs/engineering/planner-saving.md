# Planner saving: leaving the page, the layout and the device copy

What keeps a planner's work when they stop, switch or close. Read the code
named here before changing any of it; the tests named beside each rule are the
guarantee.

## The pieces

- **Autosave** (`components/editor/EditorBridge.tsx`): a scene change schedules
  a save 3 s later (`scheduleAutoSave`); a save in flight is waited for, never
  dropped; offline and a pending conflict spend no tick. `flushAutoSave` sends
  at once and reports `true` only when the server holds the latest document.
- **The device copy** (`lib/anonymous-planner-draft.ts`): every write of unsaved
  work is kept in localStorage under the person's own key (a guest's under the
  layout's), with the server revision and objects it was edited from. The
  store's `keptOnDevice` is true only when this device really holds the
  current work (not over 1,000 pieces, storage allowed, not mid-gesture).
- **The batch save** (`stores/editor-store.ts` `saveDocument`): a full sync
  with the revision's compare-and-swap; a save sent as the page goes travels as
  `keepalive` when its body is at most 60,000 bytes (`api/client.ts`;
  browsers refuse more than 64 KiB of pending keepalive bodies). A larger
  layout still goes, as an ordinary request, while the page stays.

## Leaving (QoL D-01, D-X2, D-X3)

| When | What happens | Tests |
| --- | --- | --- |
| The page is hidden | The device copy is written (mid-gesture too) and unsaved work is sent at once, keepalive, once. | `editor-bridge-leave.test.tsx`; e2e `planner-work-survives.spec.ts` |
| The page closes (`pagehide`) | The same, unless the hide already sent it. A closing tab may cancel the request: the device copy is the guarantee, not the request. | the same |
| `beforeunload` | The browser is asked to hold the page only for unsaved work this device does **not** keep. | `editor-bridge-leave.test.tsx` |
| The planner's route unmounts | The waiting autosave is flushed, not cancelled. | `editor-bridge-leave.test.tsx` |
| Another layout opens in this page | `loadConfiguration` runs `saveBeforeLayoutChange` beside its read: the outgoing work gets up to `LAYOUT_CHANGE_SAVE_MS` (2 s), a save already in flight first. What does not arrive stays on this device and `leftBehind` says so on the next layout. | `editor-store-leaving.test.ts` |
| The slate switches room or layout | The slate awaits the same call before navigating (its line says "Saving · N changes"). Work this device cannot keep holds the switch, with Try again and "Open … without them". The room switch names the layout it leaves in the navigation state (`lib/planner-room-switch.ts`) so `EditorPage` closes exactly that one and the bootstrap opens the room. | `slate-leaving.test.tsx`, `EditorPage.room-switch.test.tsx`, e2e |
| The layout opens with a device copy | The copy restores as one undo step ("Restore changes kept on this device") with `restoredFromDevice` for the receipt, unless the server already holds it (`lib/saved-layout-content.ts`, compared at the database's precision, new pieces paired by content) or it changes nothing; then it is forgotten and the layout opens clean, with no conflict. | `editor-store-leaving.test.ts` |

The receipt and the left-behind note stay until the person's next change to
the open layout (the undo timeline's newest step moves) or another load; the
words are in `lib/editor-save-status.ts` (`restoreReceipt`, `leftBehindWords`,
`heldLayoutChange`). The new chrome shows them under the slate's plane; today's
chrome docks them where its save-error toast docks.
