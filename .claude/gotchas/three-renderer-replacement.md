**Read this when:** disposing, replacing or recovering a three r186 `WebGPURenderer`
(device or context loss, a canvas remount), or keeping GPU-derived state (a baked
environment, a texture filled by GPU copies, a compiled draw) across renderers.

# A renderer can be replaced under a live scene; some state cannot follow

`NativeCanvas` recovers a lost device by putting a fresh renderer on the same canvas
and handing it to R3F's store ([the renderer note](../../docs/engineering/native-splats.md#losing-and-restoring-the-graphics-device-l3c-25-october-2026)).
That works because three keeps GPU state per renderer and re-uploads from CPU data,
and because consumers read `useThree((s) => s.gl)` with `gl` in their effect deps.
What breaks it:

- **State only the GPU holds.** A texture filled by `copyTextureToTexture` whose source
  bytes were recycled, a render target baked once, a PMREM result (cached per source
  texture, not per renderer). Key such state on the renderer so it is rebuilt.
- **Caching the renderer outside `useThree`** (a ref filled in `onCreated`, a module
  map keyed by the first renderer). `onCreated` does not fire on a swap.
- **`device.lost` with reason `"destroyed"`** is ignored by `WebGPUBackend`: watch the
  device yourself if anything else may destroy it.
- **`WebGLBackend.dispose()` calls `WEBGL_lose_context.loseContext()`.** Never dispose a
  WebGL renderer whose canvas another renderer uses, except through
  `releaseLostWebGLRenderer` while its context is lost.
- **A second renderer attaching to a per-scene host** (`NativeSplatScene.attach()`)
  arrives in the same React commit that detached the first, before deferred teardown.

Check a change with `packages/web/scripts/graphics-reset.mjs` (real Chromium, real
losses, before/after pixels at the same pose).
