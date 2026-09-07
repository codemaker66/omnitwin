**Read this when:** wiring SparkSplatLayer callbacks, progress updates or a scene
that appears loaded while refetching or staying blank.

# Loader callbacks participate in asset lifetime

The current `SparkSplatLayer` load effect depends on
`invalidate, lod, onError, onLoad, paged, url`. Changing a callback identity can
dispose the mesh and refetch the tile. A July 2026 parent-progress loop repeatedly
changed inline callbacks, causing reloads that fast local delivery concealed.

Keep callbacks stable for the intended asset lifetime. Use correct `useCallback`
dependencies or a stable handler reading deliberately maintained refs for current
parent behavior. Do not mechanically use an empty dependency array and capture
stale values. A semantic source change may legitimately require a new lifetime.

Verify request counts, cleanup and state under delayed success, failure, unmount
and parent updates. State saying "settled" does not prove successful loads or a
rendered frame. Recheck the actual effect before relying on this dependency list.
