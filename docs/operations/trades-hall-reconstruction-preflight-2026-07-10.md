# Trades Hall reconstruction preflight — 2026-07-10

Status: internal candidate evidence only. Nothing in this record promotes,
signs, certifies, publishes, or grants runtime geometry authority.

## Verified source and pose evidence

- Immutable stage: `F:\VenviewerCaptureStaging\trades-hall-2026-07-10`.
- Stage plan SHA-256:
  `d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729`.
- Stage manifest SHA-256:
  `c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff`.
- Primary E57: 20,518,437,888 bytes; SHA-256
  `975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd`.
  The complete staged file was re-read and the digest matched before pose
  extraction.
- Pose evidence directory:
  `F:\VenviewerReconstructionWork\trades-hall-2026-07-10\staged-e57-poses`.
- Extractor: pye57 0.4.19, header-only; 149 data3D poses in E57 Z-up metres.
- Canonical pose payload SHA-256:
  `fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3`.
- The ignored existing Twin manifest has the same 149 identities and exact
  quaternion/translation values: maximum quaternion delta `0`, maximum
  translation delta `0 m`. This proves pose equality only. The existing
  bundle remains untrusted because its imagery and mesh came from excluded
  derived workspace files.

## Bounded MatterPak reference candidate

The staged vendor OBJ is a safe bounded reference conversion input: 237,561
vertices, 474,049 faces, 159 groups, 144 staged diffuse textures, and bounds
`[-6.166, -12.362, -4.151]` to `[21.365002, 13.696001, 9.05]` metres.

Blender 5.1.2 produced an internal GLB twice from the same loaded scene. The
two exports were byte-identical, every OBJ/MTL/texture digest matched the stage,
all 144 diffuse textures were bound, and source/import/GLB-roundtrip bounds
agreed within `4.654e-7 m` (gate `1e-5 m`).

- Candidate directory:
  `F:\VenviewerReconstructionWork\trades-hall-2026-07-10\matterpak-glb-reference`.
- GLB size: 141,636,656 bytes.
- GLB SHA-256:
  `dd7fcbd3800a6c1af18bd9121433d31ec89f9efd477acfe3a00ce31652d082f2`.
- Authority: `matterpak_original` vendor-control candidate/fallback only.
- Open gates: no E57 point-to-mesh residual, no reviewed ARF→CVF transform,
  no TransformArtifactV0 registration, no visual QA sign-off, no signature,
  no Twin Forge publication, and no public exposure.

Blender reports unsupported duplicate `map_Ka` ambient-map declarations from
the MatterPak MTL. The matching `map_Kd` declarations loaded all 144 staged
diffuse images; ambient-map semantics are not claimed or required by this
reference conversion.

## Local deterministic-meshing toolchain

| Component | Local evidence | T-118 posture |
| --- | --- | --- |
| pye57 | 0.4.19 | Available for E57 metadata and bounded extraction. |
| CloudCompare | 2.14.beta (2026-02-20), explicit install path; E57 and PoissonRecon plugins detected | Available but not on `PATH`; version must be pinned by an operator recipe. |
| Blender | 5.1.2 | Available; bounded reference conversion passed. |
| PDAL | Not detected | Blocking the accepted D-024 baseline toolchain. |
| Open3D | Python module not detected | Blocking Poisson/BPA/dual comparison code. |

The machine has about 656 GiB free on `F:`. Capacity is sufficient for bounded
working artifacts, but capacity alone is not authority to launch the roughly
965.52-million-point full reconstruction.

## Fail-closed changes

- `extract_e57_poses.py` derives its E57 from the stage manifest, rejects
  source/output overlap, optionally verifies the full source hash, emits
  provenance and comparison evidence, and atomically publishes only to a new
  working directory.
- `extract_equirect_v2.py` no longer defaults to `F:\E57`. It requires a
  verified stage, a disjoint output, and regenerated lidar truth panos whose
  strict manifest cites the exact staged E57 digest. Old derived panos and
  old basis reports fail provenance checks.
- Stage and truth paths reject traversal, symbolic links, and Windows reparse
  points. Unit coverage pins valid evidence, overlap rejection, traversal,
  provenance mismatch, digest drift, and link/reparse rejection.
- `build_matterpak_glb_candidate.py` hashes every used stage file, refuses an
  existing output, double-exports, performs a GLB roundtrip, and keeps authority
  and exposure gates explicit.

## Exact next gate

T-118 is not complete. Its formal dependency T-001 remains blocked on the
RunPod smoke gate, and the accepted D-024 deterministic baseline requires PDAL
and Open3D in addition to the detected CloudCompare and Blender installs.

Before a full E57 room-shell job:

1. Close or explicitly rescope the T-001 dependency; do not silently bypass it.
2. Install and version-pin PDAL and Open3D, then record executable/module
   versions and a tiny fixture pass.
3. Freeze a room-shell crop/segmentation policy and metric control set. The
   149 sweeps cannot be globally meshed without deciding which storey/region,
   dynamic clutter, ceilings, and hero fixtures are in scope.
4. Run one bounded, hash-addressed room-shell zone through Poisson, BPA, and
   dual meshing. Record point sampling, normals, transforms, triangle counts,
   watertightness, cleanup burden, point-to-mesh residuals, and GLB runtime
   budget results against the MatterPak reference.
5. Only after those results pass review may a wider reconstruction be queued.
   Signing, AssetVersion promotion, Truth Mode claims, and public exposure stay
   separate gates.

For future equirect work, first implement a deterministic staged-E57 lidar
truth-pano generator that emits `venviewer.lidar-truth-panos.v1`; the old
`F:\E57\panoramas` directory is not accepted as evidence.
