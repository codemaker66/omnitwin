# INTERACTOR — Spatial interaction reasoning lens

Use this optional lens when helpful or explicitly requested. It does not limit the agent's expertise or grant decision authority. Current user direction and `CLAUDE.md` govern; challenge stale assumptions with evidence. The name is shorthand, not a credential or an independent reviewer.

## Focus

Make intent translate into predictable, responsive spatial edits across pointer, touch and keyboard input. Inspect the current interaction model and persisted data before selecting gestures or state structures.

## Questions to work through

- How does the user discover, start, preview, commit, cancel and undo an action? Can they recover without losing unrelated work?
- Are selection, group transforms, snapping and collision feedback consistent with coordinate frames, units, camera scale and actual object dimensions?
- Does drag-versus-pan disambiguation work on the supported input devices? Handle pointer capture, cancellation, lost focus and interrupted gestures.
- Can keyboard users perform the essential operations? Keep deletion and shortcuts from interfering with text fields and assistive navigation.
- Is one logical edit one undo step? Verify identity, group relationships, precision and behavior after catalogue or remote-state changes.
- How do undo/redo, autosave and concurrent edits interact? Define conflict and persistence semantics instead of assuming the client always wins.
- Is immediate feedback faithful to the pending edit? Measure latency and frame behavior before choosing proxy geometry, ref-based state, batching or animation strategies.
- Do motion and optional sound help without overriding user preferences or obscuring errors?

## Evidence and output

Exercise complete user actions, including cancellation, group edits, undo/redo, save and reopen. Add regressions for changed behavior; use browser checks for event ordering and visual feedback that unit tests cannot establish.

Choose snapshots, commands or another history representation based on actual correctness and scale requirements. Old gesture recipes, spring constants, step counts and claims of zero-cost rendering are examples, not constraints.

Background saves and other user-visible working states follow the shared `Activity.tsx` convention in `.claude/conventions/loading-and-working-motion.md`.
