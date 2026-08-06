# OmniTwin intake admission and verified local staging v0

**Schema IDs:**

- `omnitwin.foundry.universal-intake-receipt.v0`
- `omnitwin.foundry.intake-admission-review.v0`
- `omnitwin.foundry.intake-admission-result.v0`
- `omnitwin.foundry.intake-staging-index.v0`

**Runtime validators and compilers:**

- `packages/reconstruction-foundry/src/intake-receipt.ts`
- `packages/types/src/omnitwin-foundry-intake-admission.ts`
- `packages/reconstruction-foundry/src/intake-admission.ts`
- `packages/reconstruction-foundry/src/intake-staging.ts`

## Purpose

This contract turns a local file or directory drop into four progressively
stronger, digest-bound artifacts:

1. a read-only universal intake receipt;
2. an all-path operator admission review;
3. a deterministic draft `FoundryIngestManifestV0` and exclusion ledger; and
4. a verified local stage containing only admitted source bytes and the exact
   evidence that authorized their admission.

These artifacts establish observed byte identity, explicit human decisions,
and local custody. They do not establish reconstruction fitness, legal
approval, execution approval, model-training approval, release authority, or
public truth.

Every review, result, and staging index has literal authority `none`. Receipt
policy has cloud dispatch, reconstruction, and manifest promotion set to
`none`. The admission and staging capabilities do not authorize job planning,
execution, model training, signing, publication, or promotion. No stage in this
contract creates a cloud request, mutates object storage, starts a process or
provider worker, or publishes an artifact.

## Universal intake receipt

`inspectUniversalIntake` accepts one regular local file or one local directory.
For a directory, it recursively inventories regular files in sorted relative
POSIX-path order. The implementation:

- rejects source and descendant symbolic links, non-regular entries, unsafe
  relative paths, and case-insensitive path collisions;
- rejects direct Windows UNC and device paths;
- bounds one intake to 100,000 files, 100,000 directories including the root,
  and 256 directory levels;
- streams every complete file through SHA-256 while retaining at most 64 KiB of
  header bytes and at most 64,000 decoded header characters for classification;
- records exact path, byte length, modification time, full SHA-256, bounded
  signature evidence, candidate format classifications, and exact-content
  duplicate groups; and
- re-discovers the entire source after hashing and issues no receipt if file
  identity or the source tree changed during inspection.

The format detector is a bounded classifier, not a decoder or suitability
test. It may return `detected`, `ambiguous`, or `unknown` candidates with
confidence, evidence, and caveats. Every received file remains
`quarantined` and `manifestEligible: false`. At minimum, rights and provenance
remain unreviewed; unknown, ambiguous, low-confidence, or opaque/proprietary
formats add their corresponding quarantine reasons and canonical next actions.

The receipt policy is fixed to read-only source access, no network clients, no
cloud dispatch, no reconstruction, no manifest promotion, and unreviewed
rights. It neither copies nor rewrites source bytes. In particular, XGRIDS
XBIN, MatterPak, LCC/LCC2, FBX, CAD/BIM, and other proprietary or opaque
payloads are not decoded or decrypted. The contract directs operators to a
documented vendor SDK or official export where one is required.

Receipt identity is the bare lowercase SHA-256 emitted as `receiptSha256` over
domain-separated canonical JSON using
`VENVIEWER_FOUNDRY_INTAKE_RECEIPT_V0`. Sorted paths, derived duplicate groups,
the derived summary, canonical quarantine actions, and the digest are all
revalidated on parse.

## Admission review

`FoundryIntakeAdmissionReviewV0` binds the exact receipt digest and requires a
single sorted decision for every receipt path. A decision is either:

- `admit`, with a complete `FoundryInputAsset`, a classification decision, and
  an asset relative path identical to the reviewed receipt path; or
- `exclude`, with one enumerated exclusion reason and a non-empty rationale.

At least one asset must be admitted. Admit decisions bind the review source
root and the receipt's exact byte length and SHA-256. An
`accepted_detector_candidate` classification must select a candidate actually
recorded by the receipt. An `operator_override` is permitted only with a
non-empty rationale and at least one unique evidence reference; the override
is explicit evidence, not a silent relabel.

The review also carries declared frames, transforms, provenance edges, and
generated regions needed by the draft ingest manifest. It fixes
`sourceMutationPermitted` to `false`, authority to `none`, and legal review to
only `requires_review` or `blocked`. It cannot state `approved`.

Opaque-input rules fail closed:

- `xgrids_xbin` can be admitted only with a non-processing access state:
  `metadata_only`, `blocked_technical`, or `blocked_legal`;
- MatterPak, XBIN, LCC, and LCC2 require a non-unknown rights basis, a review
  time, and a terms reference unless their access state is non-processing; and
- admission never authorizes proprietary payload decoding. A later byte-for-
  byte custody copy does not change the payload's access or rights state.

The review carries `localStaging: not_performed`; job planning, execution,
model training, signing, publication, and promotion are all
`not_authorized`. `reviewSha256` is a prefixed, domain-separated digest of the
canonical review payload using
`omnitwin.foundry.intake-admission-review.v0`.

## Deterministic admission result

`admitUniversalIntakeReceipt` recompiles the receipt and review rather than
trusting caller-supplied derived fields. It requires the review to bind the
supplied receipt and to account for the receipt's exact sorted path set. It
then verifies every admitted file's path, source root, size, digest,
classification method, proprietary access state, and applicable opaque-format
rights gate.

The result contains:

- the exact receipt and review digests;
- a deterministic `FoundryIngestManifestV0` containing admitted assets;
- the exact manifest digest returned by
  `computeFoundryIngestManifestSha256`;
- the sorted exclusion ledger; and
- a self-digest over the canonical result payload.

Coordinate frames, transforms, provenance edges, and generated regions are
sorted by ID before manifest construction. The manifest remains
`requires_review` or `blocked`, has one read-only source root, and cannot be
legally approved by intake admission. The result again has authority `none`,
`localStaging: not_performed`, and no planning, execution, training, signing,
publication, or promotion capability.

`resultSha256` uses domain-separated canonical JSON under
`omnitwin.foundry.intake-admission-result.v0`. Schema validation recomputes
both this digest and the embedded manifest digest.

## Verified local staging

`stageUniversalIntakeDraft` performs local custody only. Before copying, it:

1. validates the receipt and self-digested review;
2. deterministically recompiles the admission result;
3. rejects an existing output path;
4. rejects a staging output that contains or is contained by a directory
   source; and
5. re-runs the complete intake inspection and requires the exact reviewed
   receipt digest.

Only admitted source files are copied. Each source is reopened as a regular
non-symlink file and streamed through a file handle into an exclusive-create
destination while its SHA-256 is recomputed. Device/inode identity, size,
timestamps, destination size, and full digest are checked around the copy.
Source/destination aliases and source path escapes are rejected.

The implementation creates a sibling temporary directory and writes this
fixed layout:

```text
evidence/intake-receipt.json
evidence/admission-review.json
evidence/admission-result.json
evidence/exclusions.json
manifest/foundry-ingest-manifest-v0.json
source/<admitted relative path>
staging-index.json
```

After copying, it re-runs the complete source inspection again. Only an
unchanged receipt permits the temporary directory to be atomically renamed to
the requested local staging path. The rename is a local filesystem operation;
it is not release or runtime promotion. Existing outputs are never replaced.

Post-rename verification fails closed. `verifyUniversalIntakeStage` requires a
regular non-symlink staging root with stable identity, an exact file set, and a
full size/SHA-256 match for every indexed artifact and staged source. It parses
the receipt, review, result, and manifest; recompiles admission; cross-binds all
digests; requires the exclusion ledger to match the deterministic result; and
requires the staged source set and every source digest to match the admitted
manifest exactly. The staging root is checked again after verification. If
this verification fails immediately after the rename, the final staging
directory is removed rather than left as an apparently valid result.

The staging index is self-digested over domain-separated canonical JSON using
`VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0`. It has authority `none` and only
`localStaging: completed_verified`. Job planning, execution, model training,
signing, publication, and promotion remain `not_authorized`; cloud dispatch
and object-store mutation remain outside this contract.

## Security and authority boundary

- A receipt proves only what a completed bounded scan observed.
- Admission is an explicit inventory decision, not legal advice or legal
  approval.
- Staging verifies local copied bytes and evidence consistency; it does not
  make the source or output physically immutable.
- Detector output does not establish coordinate frame, scale, calibration,
  provenance, rights, or fitness for reconstruction.
- Proprietary payloads are never decoded or decrypted by this contract.
- None of these artifacts is an execution confirmation, rights approval,
  compute approval, provider plan, training authorization, signature,
  publication instruction, or promotion instruction.

