# PlayCanvas Toolchain Post-Training Spike

Status: Active planning note
Date: 2026-05-09
Source: PLAYCANVAS-TOOLCHAIN-001
Depends on: T-091 real `scene.ply`, SPLAT-XFORM-001, LICENSE-IP-001, VAR-001
Relates to: Spark runtime, SuperSplat, SuperSplat Viewer, Operational Geometry Compiler, Guest Flow Replay, Truth Mode

## Purpose

This note scopes where PlayCanvas tooling can help Venviewer after RunPod produces a real Trades Hall `scene.ply`.

The toolchain is a post-training bridge and diagnostic lane:

`scene.ply -> cleaned scene -> summary stats -> SOG/LOD diagnostics -> voxel/collision proxy -> Truth Mode labelled derived operational proxy`

It does not replace Spark as the current Venviewer splat runtime, does not change `/dev/trades-hall-visual`, does not add public copy, does not mark T-091 or T-091A done, and does not claim survey-grade, legal, fire, accessibility, or certified validity.

## Source Snapshot

Observed from official npm/GitHub package metadata on 2026-05-09:

| Tool | Observed version | Observed license | Primary role |
|---|---:|---|---|
| `@playcanvas/splat-transform` | 2.1.0 | MIT | Offline CLI/library for splat conversion, cleanup, summary, SOG/LOD, voxel, collision, CSV, and HTML viewer output. |
| `@playcanvas/supersplat-viewer` | 1.22.4 | MIT | Static diagnostic viewer that can load scene and collision artifacts by URL. |
| `playcanvas` engine | 2.18.1 | MIT | Underlying renderer used by PlayCanvas/SuperSplat tools; not a Venviewer runtime replacement. |
| `@playcanvas/react` | 0.11.3 | MIT | Optional React binding for future diagnostics only; not recommended for current Venviewer runtime adoption. |
| SuperSplat editor | 2.24.x tags observed | MIT license file in official repository | Optional manual QA/editor for splat inspection and camera/settings authoring. |

`@playcanvas/splat-transform` depends on `@adobe/spz` and `webgpu`, and declares `playcanvas` as a peer dependency. `@playcanvas/react` also declares React/React DOM and `sync-ammo` peers. Those transitive/runtime implications remain pending ledger review before production use.

Source links used:

- `@playcanvas/splat-transform`: https://www.npmjs.com/package/@playcanvas/splat-transform and https://github.com/playcanvas/splat-transform
- SuperSplat: https://github.com/playcanvas/supersplat
- SuperSplat Viewer: https://www.npmjs.com/package/@playcanvas/supersplat-viewer and https://github.com/playcanvas/supersplat-viewer
- PlayCanvas Engine: https://www.npmjs.com/package/playcanvas and https://github.com/playcanvas/engine
- PlayCanvas React: https://www.npmjs.com/package/@playcanvas/react and https://github.com/playcanvas/react

## Tool Roles

### Splat Transform

Recommended as the first PlayCanvas tool to test after `scene.ply` exists. Its README documents:

- input: `.ply`, `.compressed.ply`, `.sog`, `.spz`, `.splat`, `.ksplat`, `.lcc`
- output: `.ply`, `.compressed.ply`, `.sog`, `.spz`, `.glb` with KHR gaussian splatting, `.csv`, `.html`, `.voxel.json`, `lod-meta.json`
- filters: `--filter-nan`, `--filter-floaters`, `--filter-cluster`, `--filter-box`, `--filter-sphere`, `--filter-value`, `--filter-harmonics`, `--decimate`
- analysis: `--summary`
- voxel/collision output: `.voxel.json` plus `.voxel.bin`, and optional `.collision.glb` via `-K`
- URL read support through its library `UrlReadFileSystem`

Use it offline or in a post-training worker. Do not put it into the main web runtime.

### SuperSplat

Useful for manual inspection and settings/camera authoring once a real splat exists. It should not become the source of truth for venue geometry or evidence. If a human edits a splat in SuperSplat, that edit must be recorded as a human-authored derivative artifact with provenance, parameters, reviewer, and limitations.

### SuperSplat Viewer

Useful for internal diagnostics and QA packaging. The viewer README documents URL parameters including:

- `content`: `.ply`, `.sog`, `.compressed.ply`, `.meta.json`, or `.lod-meta.json`
- `collision`: `.glb` mesh or voxel data
- `settings`: viewer settings JSON
- diagnostic flags such as `ministats`, `budget`, `fullload`, and `heatmap`

This is a strong candidate for an internal static diagnostic viewer hosted against signed/internal R2 URLs. R2 CORS and access controls must be verified before exposing it outside local QA.

### PlayCanvas Engine

The engine is useful indirectly because SuperSplat Viewer uses the PlayCanvas rendering stack. Venviewer should not adopt PlayCanvas Engine as a second production runtime while Spark is the chosen splat runtime path.

### PlayCanvas React

Not recommended for T-091. It could be revisited for a separate internal diagnostic component, but installing it into the web app would add a second scene/runtime stack and more peer dependency surface. Keep it out of production dependencies unless a future task explicitly scopes that tradeoff.

## First Safe Commands

Run these only after T-091 produces a real RunPod `scene.ply`.

```bash
npx -y @playcanvas/splat-transform@2.1.0 --version
npx -y @playcanvas/splat-transform@2.1.0 scene.ply --summary null > scene.raw.summary.txt
npx -y @playcanvas/splat-transform@2.1.0 scene.ply scene.raw.csv
npx -y @playcanvas/splat-transform@2.1.0 -w scene.ply --filter-nan scene.cleaned.ply
npx -y @playcanvas/splat-transform@2.1.0 scene.cleaned.ply --summary null > scene.cleaned.summary.txt
npx -y @playcanvas/splat-transform@2.1.0 scene.cleaned.ply scene.cleaned.csv
```

If the cleaned PLY loads visually and the stats are plausible, generate diagnostic delivery outputs:

```bash
npx -y @playcanvas/splat-transform@2.1.0 -w scene.cleaned.ply scene.sog
npx -y @playcanvas/splat-transform@2.1.0 -w scene.cleaned.ply lod-meta.json
npx -y @playcanvas/splat-transform@2.1.0 -w scene.cleaned.ply diagnostic-viewer.html
```

Voxel/collision output must wait for a verified seed position in the scene's actual coordinate frame:

```bash
npx -y @playcanvas/splat-transform@2.1.0 \
  -w scene.cleaned.ply \
  --filter-cluster --seed-pos <x,y,z> \
  --voxel-external-fill --voxel-carve \
  -K scene.voxel.json
```

The generated `scene.voxel.json`, `scene.voxel.bin`, and `scene.collision.glb` are derived proxies. They are not authoritative room geometry.

## SuperSplat Viewer Diagnostic URL

After artifacts are staged to an internal bucket or local server, the diagnostic viewer can be exercised with:

```text
https://<internal-viewer-host>/?content=<encoded-scene-url>&collision=<encoded-collision-url>&settings=<encoded-settings-url>&ministats
```

Use signed/internal URLs first. Confirm CORS, access controls, artifact hashes, and no public indexing before sharing outside the dev team.

## Bundle vs Diagnostics

### Future Training Output Bundle

Store only artifacts that are part of the canonical training output or signed runtime path:

- raw `scene.ply`
- training `manifest.json`
- `hardware.json`
- `eval_holdout.json`
- checksums and RunPod/tool metadata
- optionally `scene.cleaned.ply` only after a fixture proves the cleanup step is deterministic, useful, and provenance-safe

### Post-Training Diagnostics

Store as separate derived diagnostics unless promoted by a later artifact policy:

- `scene.raw.summary.txt`
- `scene.cleaned.summary.txt`
- `scene.raw.csv`
- `scene.cleaned.csv`
- `scene.sog`
- `lod-meta.json` and associated chunks
- `diagnostic-viewer.html`
- `settings.json`
- `scene.voxel.json`
- `scene.voxel.bin`
- `scene.collision.glb`
- screenshots, QA notes, seed positions, parameters, and hashes

## Operational Proxy Posture

The voxel/collision artifacts may help the Operational Geometry Compiler or Guest Flow Replay as a derived diagnostic proxy:

- collision probing in an internal viewer
- rough occupancy/void checks
- floater detection and cleanup diagnostics
- comparison against deterministic E57/mesh room shell
- evidence for where the splat and operational geometry disagree

They must not replace measured venue geometry, signed operational geometry, fire checks, accessibility checks, or layout proof witnesses. Truth Mode should label them as derived from a visual splat, tool-generated, parameter-dependent, and unverified until compared against an authoritative source.

## Claims That Stay Prohibited

Do not claim:

- survey-grade geometry
- legal compliance
- fire approval
- accessibility approval
- evacuation safety
- certified capacity
- regulator approval
- production-ready evidence
- verified venue geometry
- T-091 or T-091A complete
- Spark replacement
- real Trades Hall runtime loaded before an actual captured asset loads

## Risks

- `--filter-cluster`, `--filter-floaters`, SOG compression, and voxelization may require working WebGPU/GPU drivers. CPU fallback is slower and not compatible with every GPU-only action.
- `--seed-pos` must be in the correct coordinate frame. A wrong seed can remove valid data or carve a bad proxy.
- Summary output is CLI text. Use the library `computeSummary` in a wrapper if Venviewer needs stable JSON summary records.
- CSV exports may be very large for multi-million-Gaussian scenes.
- SOG/LOD may be valuable for diagnostics but is not automatically Spark-compatible.
- SuperSplat manual edits can create human-edited derivative artifacts and must carry provenance.
- Licensing is MIT at the package/repo level from current official sources, but transitive dependencies, generated-output attribution, browser redistribution, and customer-data processing still need ledger review before production/evidence use.

## Non-Goals

- No dependency installation.
- No production runtime change.
- No Spark replacement.
- No `/dev/trades-hall-visual` behavior change.
- No public copy.
- No T-091/T-091A completion.
- No legal, fire, accessibility, certified, or survey-grade claim.
- No operational geometry authority promotion.
- No package rename.
