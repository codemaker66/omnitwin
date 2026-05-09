# Splat Transform Post-Training Bridge

Status: Active planning note
Date: 2026-05-09
Source: SPLAT-XFORM-001
Relates to: T-091, T-384, T-385, T-386, T-344, T-345, T-346, T-347, LICENSE-IP-001, VAR-001, OGC-001, TRUTH-DR-2026-04-30

## Purpose

This note evaluates `@playcanvas/splat-transform` as an offline post-training bridge after a real RunPod `scene.ply` exists.

The intended bridge is:

```text
scene.ply
-> cleaned scene
-> summary stats
-> voxel/collision proxy
-> optional diagnostic viewer/export
-> Truth Mode labelled derived operational proxy
```

This is not a production runtime integration. It does not change the Spark visual route, install a dependency, generate a real asset, publish public copy, mark T-091/T-091A complete, or claim legal, fire, accessibility, survey-grade, or venue-certification validity.

## Source Snapshot

Primary sources checked on 2026-05-09:

- npm package: `@playcanvas/splat-transform`
- latest npm version: `2.1.0`
- npm license field: `MIT`
- official repository: `https://github.com/playcanvas/splat-transform`
- official license file: `https://github.com/playcanvas/splat-transform/blob/main/LICENSE`
- official collision guide: `https://github.com/playcanvas/splat-transform/blob/main/guides/COLLISION.md`
- official Docker/backend guide: `https://github.com/playcanvas/splat-transform/blob/main/guides/DOCKER.md`

Observed package details for `2.1.0`:

```text
license: MIT
bin: splat-transform -> bin/cli.mjs
engines: node >=18.0.0
dependencies: @adobe/spz 0.2.1, webgpu 0.4.0
peerDependencies: playcanvas ^2.0.0
dist integrity: sha512-qA7lAftH542cAqC8bMx48/sHNVxFPCNSk4zoV7XHxLB0cstYyNduGw/7XxLz75m6oHQw0dL5mblZvtu3f5cZEA==
```

License posture: MIT is favorable for a spike, but Venviewer should keep production/evidence use as `pending_review` until the exact version, generated artifact rights, attribution path, and output exposure tier are recorded in the License & IP Compliance Ledger.

## Capability Findings

### Input and Output Formats

The package is a credible candidate for future RunPod output because it reads standard `.ply` files and several compressed splat formats. It also writes `.ply`, compressed PLY, `.spz`, PlayCanvas SOG, KHR gaussian-splatting `.glb`, CSV, HTML viewer, LOD, and voxel outputs.

For Venviewer, the relevant output split is:

- `scene.cleaned.ply` for direct Spark compatibility testing.
- `scene.cleaned.spz` only after Spark/SPZ compatibility and coordinate tests pass.
- `scene.sog` or `lod-meta.json` as PlayCanvas/SuperSplat diagnostic exports, not as the default Spark runtime package.
- `scene.voxel.json` plus `scene.voxel.bin` as a derived sparse voxel octree.
- `scene.collision.glb` as a voxel-derived collision/proxy mesh.

### Cleanup and Floater Removal

The package supports:

- `--filter-nan` to remove NaN and most Inf values.
- `--filter-floaters [size,op,min]` to remove Gaussians that do not contribute to solid voxels.
- `--filter-cluster [res,op,min]` to keep the connected cluster containing `--seed-pos`.
- `--filter-box`, `--filter-sphere`, `--filter-value`, harmonic filtering, decimation, and Morton ordering.

`--filter-floaters`, `--filter-cluster`, voxel output, and collision mesh generation rely on GPU/WebGPU paths. The Docker/backend guide says GPU-only paths require a host GPU stack with Vulkan/WebGPU support. This should run in a controlled worker/container, not as a browser runtime dependency.

The cleanup capability is useful, but it must be treated as destructive. Filtered Gaussians could include legitimate chandelier/crystal/window/fireplace details, especially in ornate regions. Every cleanup run must preserve raw input, before/after summary stats, visual diagnostics, and a fallback to raw `scene.ply`.

### Voxel and Collision Proxy

The official collision guide describes an indoor-room flow:

```text
input splat -> filter-cluster -> voxelize -> fill -> carve -> collision mesh
```

For Venviewer, the candidate one-room command shape is:

```bash
npx -y @playcanvas/splat-transform@2.1.0 \
  -w scene.cleaned.ply \
  --filter-cluster --seed-pos <x,y,z> \
  --voxel-external-fill --voxel-carve \
  -K scene.voxel.json
```

Expected outputs are:

- `scene.voxel.json`
- `scene.voxel.bin`
- `scene.collision.glb`

This proxy must be labelled as a derived operational proxy. It is not the authoritative room geometry, not a measured survey, and not a legal/fire/accessibility approval surface. It may be useful for rough raycasts, occlusion diagnostics, walkable-space exploration, or comparison against deterministic E57/mesh outputs.

### Summary and QA Data

The CLI supports `--summary`, and the library exposes `computeSummary`. The summary includes per-column min, max, median, mean, standard deviation, NaN count, and Inf count.

For evidence/manifest records, prefer a small internal wrapper around the library API so Venviewer can emit stable JSON:

```json
{
  "tool": "@playcanvas/splat-transform",
  "version": "2.1.0",
  "inputHash": "sha256:...",
  "outputHash": "sha256:...",
  "actions": ["filterNaN", "filterCluster", "voxelExternalFill", "voxelCarve"],
  "parameters": {
    "seedPos": [0, 0, 0],
    "voxelParams": [0.05, 0.1]
  },
  "beforeSummary": {},
  "afterSummary": {},
  "knownLimitations": []
}
```

The raw CLI output can be used for first smoke inspection, but it should not become the long-term manifest contract until parsed and pinned.

### HTTP Input Support

The library exposes `UrlReadFileSystem` for reading from HTTP(S) URLs in browser or Node. That is useful for experiments, but Venviewer should avoid processing mutable remote URLs directly in evidence paths. The safer production-shaped flow is:

1. download the signed/source object from R2 to a temporary workspace,
2. verify size and SHA-256,
3. run `splat-transform` against the local file,
4. hash every output,
5. upload derived artifacts with provenance.

## Feasibility Answers

1. Can it process future RunPod `scene.ply` output?

Yes, likely. `.ply` is a supported input. The caveat is that the first real gsplat `scene.ply` must be tested for column names, SH bands, scale, coordinate frame, and file size.

2. Can it generate useful `collision.glb` or voxel artifacts for one room?

Yes, likely. It explicitly supports `.voxel.json` / `.voxel.bin` and optional `.collision.glb` output. One-room indoor scans are a documented target, but Venviewer must tune `--seed-pos`, voxel resolution, fill, and carve parameters against Trades Hall.

3. Can it help remove floaters before runtime display?

Yes, with caution. `--filter-nan`, `--filter-floaters`, and `--filter-cluster` are directly relevant. These filters can also remove legitimate sparse details, so cleaned visual assets must be compared against raw renders and held-out images before promotion.

4. Can it produce QA summary data suitable for manifests/evidence records?

Yes, but a wrapper is recommended. CLI `--summary` is useful immediately; the library `computeSummary` should be used for stable JSON records with hashes, parameters, and before/after statistics.

5. Does it support Spark-useful outputs, or only PlayCanvas/SOG diagnostics?

It supports outputs that may be useful to Spark indirectly: cleaned `.ply` and `.spz`. Its SOG and LOD outputs are PlayCanvas/SuperSplat-oriented diagnostics unless Spark later supports them. KHR gaussian-splatting `.glb` is useful as an interchange experiment, not as Venviewer's canonical runtime path yet.

6. What exact files should Venviewer generate after training?

For the first fixture:

- `scene.raw.ply` or source reference to the original RunPod `scene.ply`
- `scene.raw.summary.json`
- `scene.cleaned.ply`
- `scene.cleaned.summary.json`
- `scene.voxel.json`
- `scene.voxel.bin`
- `scene.collision.glb`
- `scene.sog` or `lod-meta.json` plus chunks, optional diagnostic only
- `scene.cleaned.spz`, optional only after Spark/SPZ compatibility testing
- `splat-transform-report.json`
- `diagnostic-viewer.html`, optional internal artifact only

7. What should be blocked from public/verified claims?

Block all claims that the proxy is:

- survey-grade geometry
- fire, legal, accessibility, or occupancy approval
- verified venue geometry
- a substitute for E57/deterministic mesh authority
- safe for autonomous route/egress decisions
- proof that T-091/T-091A is complete
- a customer-facing production artifact before manifest, license, bridge, and Truth Mode records exist

8. What task IDs should be added or updated?

- Add T-385 for this feasibility note.
- Add T-386 for the first real `scene.ply` bridge fixture once T-091 produces a real asset.
- Update T-346 later with the verified installed version and fixture result.
- Update T-347 later with a formal bridge verification record for `scene.ply -> cleaned.ply -> voxel/collision`.
- Cross-reference T-345 if SPZ or coordinate-precision conversion becomes part of the output path.

## Safe First Command Once `scene.ply` Exists

Use this first because it is non-destructive and does not require GPU voxelization:

```bash
npx -y @playcanvas/splat-transform@2.1.0 --version
npx -y @playcanvas/splat-transform@2.1.0 scene.ply --summary null > scene.raw.summary.txt
npx -y @playcanvas/splat-transform@2.1.0 -w scene.ply --filter-nan scene.cleaned.ply
npx -y @playcanvas/splat-transform@2.1.0 scene.cleaned.ply --summary null > scene.cleaned.summary.txt
```

Then, only after a known walkable `--seed-pos` is chosen in the same coordinate frame:

```bash
npx -y @playcanvas/splat-transform@2.1.0 \
  -w scene.cleaned.ply \
  --filter-cluster --seed-pos <x,y,z> \
  --voxel-external-fill --voxel-carve \
  -K scene.voxel.json
```

Do not use `0,1,0` blindly. It is a placeholder from examples, not a verified Trades Hall coordinate.

## Recommendation

Verdict: GREEN for a post-training spike.

`@playcanvas/splat-transform` is a strong candidate for an offline post-training bridge because it can process PLY, clean obvious bad data, emit summaries, generate voxel/collision proxies, and produce diagnostic exports. It should remain an offline candidate until fixture testing proves:

- real RunPod `scene.ply` compatibility,
- correct coordinate alignment with Venviewer room frames,
- acceptable cleanup behavior on ornate regions,
- stable output hashes and summaries,
- usable collision proxy quality,
- no false public or verified claims.

## Non-Goals

- No package installation.
- No production runtime change.
- No Spark visual route change.
- No public copy change.
- No T-091/T-091A completion.
- No legal, fire, accessibility, occupancy, or survey-grade claims.
- No replacement for deterministic E57/mesh authority.
