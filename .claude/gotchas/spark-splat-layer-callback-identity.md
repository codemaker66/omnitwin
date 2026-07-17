**Read this when:** passing `onLoad`/`onError` to `SparkSplatLayer`, wiring
any splat scene to React state (progress bars, load counters), or debugging a
splat scene that reaches its "loaded" state but renders nothing.

# SparkSplatLayer callbacks must be identity-stable

`SparkSplatLayer`'s load effect is keyed on `[invalidate, onError, onLoad,
url]` (components/scene/SparkSplatLayer.tsx). A new callback identity
**disposes the SplatMesh and refetches the whole tile**.

If those callbacks are inline arrows — or `useCallback`s whose deps change on
progress renders — every tile completion re-renders the parent, changes the
identities, and dispose/refetches **all** mounted layers. Consequences:

- Tiles are fetched N times instead of once (63MB rooms become hundreds of MB
  on slow networks; easy to misread as StrictMode double-fetching in dev).
- On slow connections the churn never converges: the scene can reach its
  "live"/"loaded" state (the last `initialized` promise resolves) while Spark
  never presents a frame — **state says live, canvas stays blank**. Fast
  localhost loads hide the bug completely.

**The contract:** handlers passed to `SparkSplatLayer` are `useCallback`
with `[]` deps for the life of the scene. If they must call parent props,
keep the latest props in refs (`useEffect` updates the ref; the stable
handler reads `ref.current`). FreshWalk.tsx and LivingHallScene.tsx are the
reference implementations.

Found 2026-07-17: the homepage "Walk the room" embed painted on localhost
and stayed blank on venviewer.com until the handlers were stabilised
(regression-proved with a 12 Mbps CDP throttle — one fetch per tile, painted).
