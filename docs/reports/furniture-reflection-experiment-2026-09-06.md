# T-596 — optional furniture reflection comparison

This is a source-informed presentation hypothesis prepared on
`codex/furniture-reflections-ab`, based on `2e55e209`. It is not a reconstruction,
measured material, accepted visual improvement, performance result or deployment.
T-597's Blender files and the captured room geometry/registration are untouched.

## Comparison switch and boundary

Use the **development server** with `?furniture-reflections=panorama` (append with
`&` when a query already exists). Omit it for the baseline. Production builds,
unknown values, other rooms, Mesh/Hybrid, absent/failed captures, registered
packages and every frozen timeline state keep the baseline. Only the staged
captured Grand Hall in Splat mode uses this provisional served-frame derivative.
The separate `furniture-lighting` experiment is unchanged; keep its value identical
on both sides of a reflection comparison.

The existing brass proxy uses metalness 0.9 and roughness 0.38. Its high metalness
leaves little diffuse response, while the current lights provide no specular
environment. One panorama PMREM supplies **both image-based diffuse and specular**
to the existing standard/physical furniture materials, including instanced clones.
No material factory, furniture geometry, light rig, background, exposure, room
transform, camera or Spark callback is changed. Spark's custom shader does not
consume this environment; actual source-image parity still needs browser evidence.
No per-frame reflection capture or per-chair texture is introduced.

## Actual source and reproducibility

- Master: `D:/claude/founder-direction-20260906/sources/panoramas-8k/sweep_041jpg.jpg`,
  8192×4096, 6,691,673 bytes. SHA-256
  `d9d056e2453a223144514bdca224bbdfb7e76f4bd7130008a3d811afa67eb974`.
- Committed derivative: `packages/web/src/assets/experiments/grand-hall-reflections-1024.jpg`,
  1024×512 RGB JPEG, **178,608 bytes**. SHA-256
  `941723fe24b5e24ce2afffa5736102f330688227ee441bb42199837320d2f742`.
- Machine-readable source receipt:
  `packages/web/src/data/grand-hall-furniture-reflection-source.ts`.
- Reproduction: `python tools/furniture-lighting/prepare_reflection_panorama.py`
  followed by the master path, existing
  `packages/web/src/data/grand-hall-furniture-lighting-probe.ts`, derivative path
  and receipt path, in that order.

The existing candidate panorama-CV→E57→served rotation is baked into the pixels.
Output follows Three r180's equirectangular convention, with +Y at image top;
`scene.environmentRotation` is identity while enabled. The script downsamples with
BOX, applies wrapped bilinear resampling and writes quality-92 4:4:4 JPEG. It checks
the master hash before and after; two preparations produced identical hashes.
There is no exposure gain, inpainting or invented highlight. Native polar content
is retained. The JPEG is tone-mapped LDR with assumed sRGB and capture-time lighting;
its azimuth is provisional, not an accepted registration or HDR calibration.

## Runtime ownership and observed state

One renderer-local reference-counted cache deduplicates concurrent consumers and
React StrictMode replay. Loading retains the prior scene. The final release
disposes its PMREM target; temporary generator/input textures are disposed after
filtering. A cancelled decode never starts GPU filtering, and late resources
cannot install into a replacement scene. Cleanup restores the prior environment
and rotation only while this effect still owns them, before a frozen preview can
render. A newer external environment is preserved.

`scene.userData.furnitureReflectionExperiment` reports `loading`, `ready`, `error`,
`cancelled` or `superseded`, the actual source/derivative hashes and bytes, and on
ready the texture UUID, output dimensions and elapsed decode-plus-filter `buildMs`.
No visible loading interface is added: the usable baseline remains visible.

Three's documented 1024×512 input produces a 768×1024 RGBA16F PMREM: roughly 6 MiB
for the retained base target, plus input and temporary processing resources. This
is a format calculation, not a measured GPU allocation. The loader also restores
render target, cube face, mip, XR and autoClear in an outer `finally`, because r180
restores these internally only on successful filtering. Its public API does not
return a partially allocated output if filtering throws; disposal of that hidden
internal allocation cannot be guaranteed by this experiment. A caller-supplied
blank target skips required r180 initialization and is not used as a workaround.

## Verification and remaining comparison

Source checks: 34 targeted Vitest cases pass, including the actual PlannerScene
gate, all preview states, deferred failure/cancellation, cache ownership, external
environment replacement, input/working-resource disposal and renderer restoration.
Four Python cases pass for asset hash/dimensions, real ROI bearing round trips,
zenith orientation and master/output collision rejection. Independent read-only
review found no material blocker. Full web and E2E TypeScript, changed-file lint
and the test-mode web build pass. The build completed in 29.66 seconds. Initial
test-fixture lint/type failures and final receipts are retained in the worktree's
`reflections-*.log` files; the final fixture uses the established CPU renderer
prototype seam rather than an unsafe double cast.

Browser work is owned by the parent task and has not run for this slice. Compare
the same saved 162-object layout, camera, DPR and lighting mode, first unselected,
then chair front/back/three-quarter views and actual pan/drag. Assess brass
readability and clipping without treating brighter as automatically better. Verify
capture-only image parity, counts and draw calls, cold decode/filter time, frame
time percentiles on the declared device, and texture release after mode/room/preview
changes. Keep failed evidence. No furnished 60-fps or aesthetic-acceptance claim is
made here.
