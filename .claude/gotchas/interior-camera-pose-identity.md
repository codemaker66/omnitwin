**Read this when:** passing `spawn` or `bounds` (or any pose object) to `InteriorCamera`, adding state or a poller to `RoomSplatScene`, `RoomWalkPage` or the planner's walk toggle, or reading a report that the walk "rubberbands", "snaps back" or "returns to the start" after a drag, a wheel step or a key.

# The walk camera re-seats on its spawn's identity, and a poller re-renders the page

**What happened (2026-09-04, live Grand Hall).** Every input was undone within 300 ms: a drag returned to the spawn yaw, W/A/S/D and the wheel were pulled back to the spawn position. `InteriorCamera` builds its start pose in a `useMemo` keyed on the `spawn` and `bounds` props and runs a "re-seat on room change" effect on that memo. Since ec53768b the scene computed the walk pose per render (`walkPoseForBundle`) and spread it into fresh literals, so every re-render of the scene was a "new room". The scene re-rendered 2.5 times a second: its 400 ms progress poller called the page's `setProgress` with a new object each tick and never stopped after the room completed.

**The fix (b10dc065, f16d4398).** The camera keys its start on the spawn's and bounds' values (`useKeyed` in `InteriorCamera.tsx`), so equal values are the same place and only a genuinely different spawn re-seats the view; the scene memoises the pose on the bundle; the poller clears itself on the tick that reports completion. Tests: `InteriorCamera.test.tsx` "keeps the viewer's place", `RoomSplatScene.test.tsx` "same spawn and bounds objects across re-renders" and "stops reporting progress once every tile has settled".

**Rules.**
- A component that resets state on a prop's identity must key on the prop's values, or its callers must guarantee identity. Do both here.
- Anything that re-renders `RoomWalkPage` re-renders the scene and everything inside the R3F canvas. A timer that sets state must end.
- The drag-budget harness sums yaw travel per frame, so a snap-back counts as "moved"; to see a rubberband, sample the pose after release (`window.__roomCamera`), as `D:\claude\fused-twin-2026-09-04\verify-rubberband.mjs` does.
- Sibling trap of the same family: `.claude/gotchas/spark-splat-layer-callback-identity.md` (callback identity re-running the load effect).
