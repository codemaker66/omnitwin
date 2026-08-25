# Grand Hall room-9 source-boundary evidence generation

This procedure reproduces the source-derived portion of
`grand-hall-room9-source-boundary-evidence-v1.json`. It is read-only and emits
a non-authoritative receipt to standard output. It does not create geometry,
modify a capture, define portal closures, or produce a runtime package.

## Stable source locators

Committed evidence uses aliases, never an operator's mount path:

- `E57_SOURCE_ROOT/cloud_0.e57`
- `MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj`
- `MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.mtl`
- `MATTERPAK_SOURCE_ROOT/colorplan_001.jpg`
- `MATTERPAK_SOURCE_ROOT/readme.pdf`

The source receipt generator accepts absolute paths only as invocation inputs.
It does not serialize them, and its fatal CLI message is path-value-free.

## Provenance-safe E57 inventory

Do not extract poses directly from a mutable historical E57 folder. First use
the existing staged-source guard and extractor documented in
`tools/twin-forge/README.md#verified-stage-reconstruction-inputs`:

```text
python -B tools/twin-forge/e57-scripts/extract_e57_poses.py
  --stage <VERIFIED_CAPTURE_STAGE_ROOT>
  --out <NEW_DISJOINT_E57_POSE_EVIDENCE_ROOT>
  --verify-source-hash
  --compare-manifest <UNTRUSTED_COMPARISON_MANIFEST>
```

The extractor uses `e57_stage_guard.py`, re-hashes the staged E57, and emits
`poses.json` plus `pose-evidence.json`. The room-9 generator requires:

- schema `venviewer.e57-poses.v1`;
- `sourceHashVerifiedThisRun=true`;
- extractor `pye57` and its recorded version;
- contiguous, finite scan indices starting at zero;
- normalized quaternions;
- a recomputed Python-compatible sorted compact canonical JSON SHA-256 of the
  parsed pose values to equal the declared `poseSha256`;
- the exact staged-manifest byte digest, its manifest-derived plan digest, and
  the E57 identity to agree across the stage, pose evidence, and image probe.

The recorded extractor run also compared an existing Twin manifest through
`--compare-manifest`. That comparison is explicitly untrusted in the pose
evidence and is not used by the room classifier; its machine-specific path is
not projected into the receipt.

The embedded-image inventory comes from the existing bounded probe:

```text
python -B tools/twin-forge/e57-scripts/probe_images2d.py
  --stage <VERIFIED_CAPTURE_STAGE_ROOT>
  --out <NEW_DISJOINT_IMAGE_PROBE_ROOT>
  --image-index 0
```

The generator retains only the safe projection of that probe: schema, matching
stage-plan/E57 digests, pinhole representation, and image count.

## Deterministic source receipt and artifact check

Set these operator-local environment variables; their values are never placed
on the command line or serialized into the receipt:

```text
GRAND_HALL_ROOM9_CAPTURE_STAGE_ROOT=<VERIFIED_CAPTURE_STAGE_ROOT>
GRAND_HALL_ROOM9_POSE_EVIDENCE_ROOT=<E57_POSE_EVIDENCE_ROOT>
GRAND_HALL_ROOM9_IMAGE_PROBE_EVIDENCE=<IMAGE_PROBE_EVIDENCE_JSON>
```

Then, from `tools/reconstruction-foundry`, run:

```text
pnpm --filter @omnitwin/reconstruction-foundry-cli exec tsx
  src/grand-hall-room9-source-receipt-entry.mts
  --check-artifact
```

The generator performs these deterministic steps:

1. It binds the capture-stage manifest used by `extract_e57_poses.py`.
2. It resolves and re-hashes the staged OBJ, MTL, colour plan, and README.
3. In the same generator run, it opens the staged E57 once, hashes every byte
   through that descriptor, and requires equality with the verified stage
   manifest. It checks descriptor and resolved-path identity before and after
   hashing and XML inspection, then requires the E57 root GUID to equal the
   MatterPak OBJ filename stem exactly. Same-size drift is therefore rejected.
4. It parses only triangular MatterPak OBJ faces, selects the exact suffix
   `_group001_sub009`, and reports source topology and bounds.
5. It casts `[0,0,-1]` from all provenance-safe E57 translations, using the
   checked-in epsilon and source-face tie-break policy.
6. It reports the Grand Hall/non-Grand-Hall/no-hit sets, contiguous hit ranges,
   five boundary checks, and shared-vertex interfaces with rooms 13 and 14.
7. It computes a domain-separated canonical source-receipt digest, validates
   the policy-bearing artifact's independent canonical self-digest, and then
   compares every persisted source-derived projection against that artifact.

The exact receipt digest for the bound sources is recorded in the evidence
artifact. The receipt has no clock, mount path, username, or generated content,
so identical verified inputs produce the same digest.

## Coordinate crosswalk limit

The E57 root GUID and MatterPak OBJ stem both equal
`424ff41f6e5d41969c635fcd61be9b3f`. The classifier therefore uses an identity
overlay for this diagnostic. That GUID match establishes common Matterport
model lineage; it is not a reviewed `TransformArtifact`, surveyed registration,
or runtime overlay authority. Those remain explicitly absent.

## What is not byte-for-byte generated

The checked-in JSON also contains reviewed prose: colour-plan interpretation,
README interpretation, uncertainties, and authority/human-review policy. The
source receipt verifies the facts underneath that prose, while the artifact's
self-digest covers both generated facts and human-authored policy. Full
byte-for-byte generation of the policy-bearing artifact is not claimed.

Earlier exploration used one-off local Python/NumPy geometry inspection and
inline `tsx`/`node` checks. Those commands are not retained as authority. The
PCA-plane diagnostics discovered there were removed; every retained numeric
source fact is superseded by the checked-in TypeScript receipt generator and
the staged E57 tools named above.
