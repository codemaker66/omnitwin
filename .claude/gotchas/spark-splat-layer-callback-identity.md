**Read this when:** wiring splat-layer callbacks, progress updates or a scene
that appears loaded while refetching or staying blank.

# Loader callbacks participate in asset lifetime

The native migration on 18 September 2026 supersedes the Spark effect described
below. See [the native runtime note](../../docs/engineering/native-splats.md) for
the current integration. The historical filename remains for existing links.

`NativeSplatLayer`'s load effect depends on `host, anchor, url, invalidate`.
Callbacks and dynamic opacity/settings are read through its current-props ref;
changing an `onLoad`, `onRendered` or `onError` callback alone does not refetch the
source. URL or host changes end the previous lifetime, abort loading, unregister
the source and dispose its geometry. Keep the latest-callback and cancellation
behavior when changing this boundary; parent callbacks still need correct source
and renderer-generation ownership.

`onLoad` means decoded geometry is available. `onRendered` means a main-camera
draw completed on the GPU with the source's submitted opacity at least 0.98;
it does not mean the compositor has presented that frame. Avoid reporting a
resolved room from decode-only progress, or making reveal wait on rendered
readiness when opacity itself gates that readiness.

## Historical Spark callback-identity failure

The former `SparkSplatLayer` load effect depended on
`invalidate, lod, onError, onLoad, paged, url`. Changing a callback identity could
dispose the mesh and refetch the tile. A July 2026 parent-progress loop repeatedly
changed inline callbacks, causing reloads that fast local delivery concealed.

For effects that include callbacks in their dependency lists, keep callbacks
stable for the intended asset lifetime. Use correct `useCallback`
dependencies or a stable handler reading deliberately maintained refs for current
parent behavior. Do not mechanically use an empty dependency array and capture
stale values. A semantic source change may legitimately require a new lifetime.

Verify request counts, cleanup and state under delayed success, failure, unmount
and parent updates. State saying "settled" does not prove successful loads or a
rendered frame. Recheck the actual effect before relying on a historical
dependency list.
