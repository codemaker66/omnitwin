# Gaussian PLY Source Facts V3 research

Date: 2026-07-17  
Task: T-508  
Status: implemented and verified; structural evidence only

## Direct outcome

The next immutable local Foundry profile should inspect classic, uncompressed
Gaussian PLY without widening Universal Source Facts V1 or V2. The first V3
profile is deliberately narrower than legal PLY and narrower than every
Gaussian dialect:

- PLY 1.0 `binary_little_endian`;
- exactly one fixed-width `vertex` element;
- required float32 `x/y/z`, `f_dc_0..2`, `opacity`, `scale_0..2` and
  `rot_0..3` properties;
- optional all-or-none float32 `nx/ny/nz` placeholders;
- a complete numeric `f_rest_0..N-1` set for `N = 0, 9, 24, 45, 72`, giving
  nominal SH degree 0–4;
- order-independent name lookup with exact byte offsets derived from the
  declared property order;
- bounded unique fixed-width scalar extras; and
- exact `header bytes + vertex count × record stride = source bytes`.

ASCII, big-endian, list-bearing, multi-element and PlayCanvas packed PLY remain
legal or recognizable PLY variants, but are not established by this first
profile. They receive stable unsupported outcomes rather than being described
as corrupt.

## Primary-source findings

### PLY container

The original Stanford PLY materials define an ASCII header, ordered element and
property declarations, ASCII/binary-little-endian/binary-big-endian encodings,
eight fixed scalar widths, variable-length list properties, comments and
extensible user-defined elements/properties. Therefore `.ply`, the `ply` magic,
or one familiar property name is not sufficient evidence of a Gaussian scene.

Primary source:

- <https://graphics.stanford.edu/pub/zippack/ply-1.1.tar.Z>

### Graphdeco reference layout

Pinned Graphdeco source `54c035f7834b564019656c3e3fcc3646292f727d`
serializes one float32 vertex record containing XYZ, zero normal placeholders,
DC SH, channel-major non-DC SH, opacity, three scale parameters and four
rotation parameters. Its loader looks up names and numerically sorts indexed
families. SH evaluation supports nominal degrees 0–4. Its `plyfile` writer uses
native-endian binary by default, so the implementation should not falsely say
Graphdeco itself promises little-endian on every platform.

Primary sources:

- <https://github.com/graphdeco-inria/gaussian-splatting/blob/54c035f7834b564019656c3e3fcc3646292f727d/scene/gaussian_model.py>
- <https://github.com/graphdeco-inria/gaussian-splatting/blob/54c035f7834b564019656c3e3fcc3646292f727d/utils/sh_utils.py>

The Graphdeco repository licence is research/evaluation and non-commercial; it
is format evidence, not a dependency to copy into the commercial product.

### gsplat layout

Pinned gsplat source `77ab983ffe43420b2131669cb35776b883ca4c3c`
explicitly writes binary-little-endian classic Gaussian PLY and omits the three
normal placeholders. Its import is name/order tolerant. The project is
Apache-2.0, but that licence does not establish the rights of any inspected
asset.

Primary source:

- <https://github.com/nerfstudio-project/gsplat/blob/77ab983ffe43420b2131669cb35776b883ca4c3c/gsplat/exporter.py>

### PlayCanvas compatibility and packed PLY

SplatTransform v3.1.1 at
`defe73928c50c9f33b5faffd103097b6244a6bbc` is MIT-licensed. Its current
ordinary PLY reader is name/offset based, but current runtime compatibility is
limited to SH degrees 0–3. Degree 4 remains a valid structural result with a
separate renderer-compatibility unknown.

PlayCanvas packed PLY is not an ordinary float32 Gaussian row. The legacy
dialect has 12 float chunk bounds and four packed uint32 words per splat. The
current dialect has 18 float chunk bounds, the four packed words and optional
byte SH data. This is lossy quantization within a PLY envelope, not a compressed
stream with frames or CRC. V3 detects and reports it as a deferred profile
rather than blessing a `packed_position` marker as complete evidence.

Primary sources:

- <https://github.com/playcanvas/splat-transform/blob/defe73928c50c9f33b5faffd103097b6244a6bbc/src/lib/readers/read-ply.ts>
- <https://github.com/playcanvas/splat-transform/blob/defe73928c50c9f33b5faffd103097b6244a6bbc/src/lib/readers/decompress-ply.ts>
- <https://github.com/playcanvas/splat-transform/blob/defe73928c50c9f33b5faffd103097b6244a6bbc/src/lib/writers/write-compressed-ply.ts>
- <https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/ply/>

## Verified local inventory

Read-only bounded inventory found materially different PLY families:

| Source | Structural family | Exact evidence |
| --- | --- | --- |
| Reception LCC master `point_cloud.ply` | classic SH3, normals present | 496,504,970 bytes = 2,026-byte header + 2,002,028 × 248; SHA-256 `da8efa94895ef7aa2c6024336278d855fdb13026bf10028901c3ac46d1e91a3d` |
| Reception LCC SH0 `point_cloud.ply` | classic SH0, normals present | 134,589,707 bytes = 911-byte header + 1,979,247 × 68; SHA-256 `8f6894aab409bbd413f379bb64b527d170e066d918cc6099c07fae175f0b94b8` |
| Brush `export_60k_th_1.ply` | classic SH3, no normals, lexicographic property order | 1,069,445,228 bytes = 1,552-byte header + 4,531,541 × 236; SHA-256 `2cb72768daec9a44523954a7d394aac5f103091d88e6a1eb969a8967a639fcc5` |
| `THSPARSEPOINTCLOUD.ply` | ordinary ASCII XYZ/RGB point cloud | 164,584,095 bytes; SHA-256 `496d8c94a6ae3abcedfbaa3281827d0db27038dfca18db8e18d07950e66b9c6c` |
| Reception mesh PLY | binary vertex/face mesh with list indices | 379,462 bytes; not a Gaussian candidate |

The Brush declaration order is `f_dc_*`, lexicographically sorted `f_rest_*`,
opacity, rotation, scale and XYZ. Rejecting it because it differs from one
writer's canonical order would be a false negative. The header comments
`Exported from Brush`, `Vertical axis: y` and `SH degree: 3` are unauthenticated
claims; V3 counts comments but does not retain them verbatim or turn them into
producer/frame authority.

## Evidence and non-claims

V3 may establish:

- bounded header syntax, encoding and version;
- complete unique scalar declarations and exact offsets;
- required Gaussian property-set presence;
- declared Gaussian count and record stride;
- property-derived nominal SH degree;
- optional-normal presence as layout only;
- exact fixed-width payload arithmetic and end of file; and
- same-source size/SHA binding through the existing already-open handle.

V3 does not decode or validate scalar values. It does not establish finite
values, position bounds, scale/opacity transforms, quaternion order or norm,
SH channel/order semantics, physical units, coordinate frame, handedness,
accuracy, registration, renderer success, visual fidelity, capture/training
lineage or usage rights. Those remain frozen state-neutral unknowns on both
successful and unsuccessful structural inspection.

## Deferred profiles and decisive tests

1. **Decoded-value profile:** stream the exact receipted rows with explicit
   value/count/allocation/cancellation limits; report finite values, nonzero
   rotations and numeric bounds without granting unit/frame authority.
2. **Packed PlayCanvas profile:** implement the exact 12/18-bound chunk schemas,
   four packed words, optional SH element and count equations separately.
3. **Renderer compatibility:** run pinned offline loaders against the exact
   digest and record consumer/version/SH limitations rather than conflating one
   renderer with format truth.
4. **Frame and accuracy:** bind the exact decoded source to a reviewed transform
   and independent surveyed control; header comments are insufficient.
5. **Provenance and rights:** obtain purpose-scoped authoritative records bound
   to the exact source SHA-256.

No cybersecurity, cloud, deployment, paid compute, publication, reconstruction
or source mutation is required for this profile.

## Implemented checkpoint

Universal Source Facts V3 now implements this bounded profile without changing
V1 or V2. Three local sources reproduced complete same-handle artifact chains:

- Reception LCC master: 496,504,970 bytes, 2,002,028 rows, 248-byte stride,
  SH3, normal placeholders present;
- Reception LCC SH0: 134,589,707 bytes, 1,979,247 rows, 68-byte stride, SH0,
  normal placeholders present; and
- Brush `export_05000.ply`: 11,859,606 bytes, 50,246 rows, 236-byte stride,
  SH3, no normal placeholders, and lexicographic `f_rest` declaration order.

The exact receipt, Source Facts V3, Source Readiness V3 and Operator Evidence
Checklist V3 fingerprints, UI captures, download checks, limits and non-claims
are retained in
`docs/reports/reception-room-gaussian-ply-source-facts-v3-evidence-2026-07-17.json`.
The evidence remains authority-none local self-consistency, not decoded-value,
accuracy, registration, renderer, provenance or rights attestation.
