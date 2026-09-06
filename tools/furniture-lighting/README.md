# Local furniture lighting comparison

This is a development-only experiment branched from `255cece2`. It changes
furniture illumination, with an optional self-shadow map. It does not change
Spark, global exposure, source colors, model materials, the original panoramas,
T597, or floor geometry. It is not a chosen product lighting rig.

With the same actual saved Grand Hall plan, camera, native framebuffer and
fully resolved capture, compare these query parameters on the local Vite app:

| Arm | Query parameter | Behavior |
| --- | --- | --- |
| A | omitted | Existing room light rig; shadows disabled |
| B | `furniture-lighting=panorama` | Measured diffuse probe plus approximate upper key, no shadows |
| C | `furniture-lighting=panorama-shadow` | Identical B illumination with one ordinary PCF shadow map |

Only an editable, captured Grand Hall in Splat mode can select B/C. Model,
Combined, other rooms, missing/failed capture, historical timeline previews,
production builds and unknown parameter values keep the baseline. No viewport
or motion quality tier is introduced. The query is read when the planner renders;
reload for a reproducible paired comparison.

## Source and frame evidence

The input is the recovered 8192×4096 `sweep_041jpg.jpg`, SHA-256
`d9d056e2453a223144514bdca224bbdfb7e76f4bd7130008a3d811afa67eb974`.
Visual inspection shows blue evening window sky and illuminated chandeliers/
ceiling wash. The window-sky ROI has mean inverse-sRGB luminance 0.0738323;
the near-chandelier ROI is 0.259740. These are declared image-region measurements,
not illuminance or proof of physical light output. Both rectangles, all nine RGB
SH coefficients, normalizing gain, directions and source-report hashes are in
`packages/web/src/data/grand-hall-furniture-lighting-probe.ts`.

Pixel-centre bearings use normalized `u,v`: `lon=2πu`, `lat=π/2−πv`, and panorama
camera ray `[cos(lat)sin(lon), −sin(lat), cos(lat)cos(lon)]` in right/down/forward
axes. The recorded composition is:

```
served_from_panorama = target_zup_to_served_yup
                    * candidate_target_from_e57
                    * candidate_e57_from_panorama
```

`target_zup_to_served_yup` is the served GH2 −90° X rotation. The other two matrices
come from the explicit sweep041→scan040 orientation diagnostic and unreviewed
Matterport→GH2 mesh-fit candidate0. The regression checks proper determinants,
orthogonality, multiplication order, coefficients through Three's actual SH
implementation and panorama zenith→served +Y. Translation does not transform
light directions. **These are candidate frame relationships, not accepted
registration, calibrated azimuth or surveyed lighting.** The approximate window
ROI direction `[-0.77035, 0.63466, -0.06135]` must be checked visually against the
rendered −X window wall before judging illumination. Current hero imagery shows
that wall to the left; this is a plausibility check, not registration acceptance.

The source is analyzed at 1024×512 with exact spherical row weights, excluding
its previously diagnosed blurred polar bands. Upper-region excess above its
90th luminance percentile is removed before SH projection and approximated by
one key. Its direction is `[0.21954, 0.97560, -0.00168]`, mostly upward. The key
also summarizes lit surfaces; it is not a recovered individual luminaire.
Gain **2.1506974765348366** matches the original polygon rig's upward-facing
diffuse luminance. It never writes renderer exposure. B and C share that gain
and all light coefficients, so their only difference is self-shadowing.

The inverse-sRGB assumption cannot recover unknown JPEG tone mapping, white
balance, clipped HDR emitters or capture-time differences from GH2. The diffuse
probe does not supply glossy environment reflections. All optical interpretation
and visual acceptance remain provisional.

## Shadow scope and runtime cost

One fixed **2048×2048 PCF** map is fitted to the current furniture bounds, with
rotation, scale, elevation and a 0.25 m dressing allowance. The map resolution is
the same on every device; its metres per texel follow the fitted extent. No
contact-shadow plane, opaque receiver or room-shadow source is added. Existing
generated furniture casts/receives shadows; meshes without those flags retain
their existing behavior, so this does not yet promise contact shadows for every
piece of tableware or linen. Demand-loop shadow updates are left intact. C costs
an additional furniture depth pass; B/C are not a 60 fps qualification.
Furniture edits refresh the existing shadow camera's projection after R3F
assigns its fitted bounds. A CPU regression exercises real R3F prop updates on
one existing Three directional light/map and verifies moved, rotated, scaled
and elevated table geometry remains inside that projection.

Pinned-source inspection: Three0.180's `WebGLShadowMap` invokes `onBeforeShadow`,
not `onBeforeRender`, saves/restores its render target, and PCF draws casters only.
Spark2.1 implements `onBeforeRender` and retains inherited `castShadow=false`/
`receiveShadow=false`. It is therefore excluded from this ordinary shadow pass.
No callback suppression, delays, renderer rewrite or dependency change is used.
This is source reasoning; actual GPU integration still needs paired validation.

## Reproduce the derivation

From the worktree root, with the already installed Python/Pillow/NumPy:

```powershell
python -B tools/furniture-lighting/test_measure_panorama.py
python -B tools/furniture-lighting/measure_panorama.py --panorama D:/claude/founder-direction-20260906/sources/panoramas-8k/sweep_041jpg.jpg --rig-report D:/claude/reference-viewer-20260906/panorama-rig-probe/rig-diagnostic.json --mesh-fit D:/claude/grand-hall-source-comparison-20260905/matterport/registration/candidates.json --output D:/claude/reference-viewer-20260906/furniture-lighting-ab-probe/measurement.json --typescript-output packages/web/src/data/grand-hall-furniture-lighting-probe.ts
```

The script hashes the original before and after analysis. It writes only the
named derived outputs. No source photograph or raw geometry is modified.

For the pending real-GPU comparison, retain A/B/C source-background differences,
chair/table close views, the actual frame time distribution and framebuffer size,
plus settled/moving cameras, furniture drag and 3D→2D→3D teardown. Reject source
corruption, new unhandled errors, clipped shadows or an unhelpful visual result.
Do not infer all-device quality/performance from one RTX4090 run. Parent owns
browser coordination; this worktree starts no browser or service itself.
