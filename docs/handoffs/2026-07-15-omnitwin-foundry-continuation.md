# OmniTwin Foundry continuation handoff — 2026-07-15

This checkpoint closes a bounded contract and fixture-verification slice only.
The broad OmniTwin Foundry goal remains active and incomplete. Generation 1 is
disabled, migration 0058 remains a frozen NO-GO baseline, no migration 0059
exists, and no production database, provider, object store, credential,
signing, registration, release, publication, promotion, paid compute,
proprietary XGRIDS parsing or model-training authority was used.

The outcome is a **production-disabled Docker Desktop Linux
transport/enforcement fixture proof**. It is not production activation or a
release artifact.

## Outcome of this continuation

- Added a canonical adapter-configuration digest and fail-closed construction,
  request and receipt checks for the exact runner profile and required terminal
  enforcement.
- Added an authority-none, production-unwired local OS sandbox policy for one
  exact deterministic `normalize_mesh`/`local_cpu` stage with network access
  `none`, no GPU, checkpoint or resume.
- Added a build-excluded test backend against the pinned Docker Desktop Linux
  npipe endpoint and pinned Linux/amd64 PostgreSQL fixture image. The backend
  checks engine, image, seccomp, container, mount, resource, output and terminal
  identities before returning an observed result.
- Added durable deadline/operator-stop intent, stable terminal receipt replay,
  fail-closed unknown semantics and exact cleanup recovery for explicitly
  tested launch/cleanup crash states.
- Repaired six stale schema-tail expectations to include already-frozen 0058.
  No migration or journal bytes changed.
- Completed focused, live, full-regression and independent adversarial review.

## Workspace and immutable inputs

- Repository: `C:\Users\blake\omnitwin2`
- Branch: `feature/diary-p0-slice-3`
- Worktree: intentionally very dirty and user-owned. Preserve unrelated edits;
  do not reset, commit or publish the aggregate worktree without a separately
  reviewed scope.
- Current goal attachment: 51,717 bytes, SHA-256
  `d6684da7ff4f129dad5a086450692ceca7e40e117a19897aa0c2749c2d6aa3b9`.
- Predecessor attachment: 28,777 bytes, SHA-256
  `a0dbe2ef903f9e43aa2cf53d771e8cd7aa71c813af6821dc4b019f4ef3d3a4ac`.

## Frozen migrations and journal

These filesystem bytes were independently rehashed after implementation and
match the prior handoff exactly:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| 0053 | 533,870 | `6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34` |
| 0054 | 58,546 | `05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4` |
| 0055 | 17,323 | `47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7` |
| 0056 | 9,768 | `3075ba5895283dd6a15407e4aa3edb44073fe7125a69a541d125579efef7a78d` |
| 0057 | 59,292 | `10fc023060ecd1228421243272d584dcb1b2bd8bd277622d9f66c5cc27ba1c6e` |
| 0058 | 262,281 | `1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e` |
| Drizzle journal | 8,943 | `08ab4ac04f086c49a030848ca59929c32fdeb40669d3d767199616118ac701af` |

The journal remains version 7/PostgreSQL with 57 entries ending at index 56,
`0058_foundry_derivative_activation_disabled`. Its mixed line endings are
preserved. `0059*` count is zero.

The nine Activation V1 contract artifacts, `.gitattributes` and the amended
derivative-activation design also rehash unchanged. The amended design remains
69,012 bytes at SHA-256
`1f593314fd45850950afe168548ac1eefebabea2e0754ee05101cc21c4371659`.

## Preserved T-507/T-486 evidence boundary

- Original T-507 is 13 files / 2,888,304 bytes and is path/size/SHA-identical
  to the dossier copy. The phase-one output-index SHA-256 remains
  `5ce95707ed8111df82e32fd7997cbcf862bec2974cf544734f5098cfe0540773`.
- T-486 r2 remains exactly 22 files / 4,727,280 bytes. Manifest SHA-256 is
  `3fba49c89207b6b78fbba067436c6a2a993efada113c9c0267cb625ea06203fd`;
  the independently recomputed canonical digest remains
  `sha256:d2411e3f5a0ab3206c1dc174c71005130e5cd26df6369ddd2ec6e10b5eb9a85b`.
- T-507 remains `shared_lineage_internal_self_consistency_only`, not
  independent survey control. T-486 remains offline, unsigned and authority
  none. A bare continuation message is not an authenticated attestation.

## Fixture contract and observed enforcement

- Endpoint is fixed to
  `npipe:////./pipe/dockerDesktopLinuxEngine`; the test requires Linux/amd64,
  cgroup v2 and seccomp. This proves only the observed Desktop Linux fixture,
  not native Windows process custody.
- Worker image is pinned to
  `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`.
  This is a fixture pin, not supply-chain approval.
- The worker has a read-only root, numeric non-root identity, all capabilities
  dropped, no-new-privileges, exact pinned seccomp plus no extra security
  options, network `none`, private PID/cgroup namespaces, IPC `none`, no
  devices/GPU, and no health/restart/log capture.
- CPU, memory, memory-swap, PID and shared-memory limits are checked from live
  inspect. Exactly four unique RLIMIT entries are admitted: `core`, `cpu`,
  `fsize`, `nofile`, with exact soft/hard values. Wall-clock limit is observed
  by poll/reconcile only.
- Input is read-only; output is a pre-reserved single file with inode/device
  identity. An inaccessible tmpfs shadows the fixture image's declared
  PostgreSQL data volume. Standard streams are not persisted and their output
  volume is unmetered.
- The terminal receipt requires Docker status `exited`, non-running/non-dead,
  PID zero, finite ordered timestamps and exact exit/OOM/deadline/intent/output
  facts. Process-tree evidence is only `docker_inspect_stopped_init_only`.

## Durable lifecycle and cleanup evidence

- An exact-label named control volume carries a root-owned sentinel and optional
  deadline/operator-stop intent, both checked by metadata and hash.
- Noclobber provides atomic first-writer selection. Publication across write,
  chmod and sync is not indivisible. Missing, partial, renamed or corrupt
  evidence fails unknown/closed; it is not auto-repaired.
- Deadline and operator-stop paths persist intent before the stop signal,
  confirm the worker remains running, reconstruct the backend object, terminate,
  then reconstruct again for stable receipt replay.
- Live cleanup recovery covers four state classes: reservation-only;
  both-data/no-control; both-data/exact-empty-control before sentinel; and
  final-control-only after all other exact resources are removed.
- Launched cleanup validates live input/output and launch witnesses before
  deleting launch, then exact data, reservation and finally valid control.
  Internal postcondition checks the six deterministic names. A separate final
  label-filter scan found zero containers and zero volumes.
- Residual P2 evidence limits: the input-only create window and intermediate
  mid-cleanup substeps are code-reviewed rather than each fault-injected;
  reconstruction occurred in one Node process against the same daemon; no
  daemon/host/power-loss durability is proved; and engine-identity drift
  intentionally blocks cleanup until intervention.

## Verification record

| Gate | Result |
| --- | --- |
| Focused adapter/policy/backend/conformance | 4 files; 31 passed; 5 opt-in skips |
| Targeted live cleanup restart | 1 passed; 6 filtered skips; 37.89 seconds |
| Final opt-in Docker backend | 1 file; 7/7 passed; 171.75 seconds |
| Final proof-resource label scan | 0 containers; 0 volumes |
| Mechanical 0058-tail suites | 6 files; 48/48 passed |
| Final full API | 136/136 files; 2,533 passed; 5 opt-in skips; 337.03 seconds |
| Full API ESLint | passed |
| API build | passed |
| API typecheck | passed |
| Final independent audit | no P0/P1; proof-scope P2s recorded above |

## New artifact identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `foundry-local-command-adapter.ts` | 46,052 | `328a391731a733fde9d1986d0b43ccfa265dd62212b1a8fe0844e38978f838ca` |
| `foundry-local-os-sandbox-policy.ts` | 16,035 | `0da4b5021418f26889ddaf0d9aba15e3b596bed34068ffcd632972f13e7d993e` |
| `foundry-local-os-sandbox-fixture.ts` | 15,665 | `0c7e9e61969070e301ca3ace851d5958e973864fdb1fd565139bb95e87efdf5c` |
| `foundry-local-docker-sandbox-backend.ts` | 81,790 | `fc39625c88509ec0785d4371737d44775d9d7a74e15774628a8222382d4335a1` |
| `networkless-seccomp.json` | 1,972 | `42cc7dc78e75c9ab782fb661791618c4f3d31a0ab61e0161dcc02c1d8732ca4e` |
| `foundry-local-command-adapter.test.ts` | 40,169 | `ee6752e38c8056c2c69f2e7978dc7085ba1578328b2ce768c6f37508c7c95d25` |
| `foundry-local-os-sandbox-policy.test.ts` | 5,873 | `def57b77a61aec54b8ce23d0664effc5d3d46b91d5e763cd67adcdbd465e3822` |
| `foundry-local-docker-sandbox-backend.test.ts` | 21,748 | `0c6adca97c9c3a9af180736a6bd255a96f6d26539e7b37be7f356238ec07f417` |
| `foundry-local-normalize-mesh-glb-conformance.test.ts` | 39,083 | `d584ae6f2034b11e17e09ca41b136bab72571de45ca3fb18ce4e0c4b9e8238f5` |

The six mechanical tail-test hashes are recorded in
`docs/sessions/2026-07-15.md`.

## Confirmed NO-GO and proof limits

Do not shorten the result to “production sandbox proof.” The exact scope is
**production-disabled Docker Desktop Linux transport/enforcement fixture
proof**. It does not prove:

- a production sandbox or production wiring;
- native Windows custody, an LSM policy, host isolation or power-loss
  durability;
- semantic mesh normalization or geometry/detail improvement;
- a supply-chain-approved production worker;
- authenticated production runner/verifier custody;
- production database admission/activation or 0058 parity;
- measured authority, signing, registration, release, publication or
  promotion.

The fixture byte-copies one tiny public GLB. Generation 1 remains disabled.
0058 activation and 0059 remain NO-GO. No external or paid action occurred.

## Remaining work

1. Finish the authenticated runner/verifier receipt, closed callable API,
   source-scoped containment and custody-specific authority contracts.
2. Complete focused 0058 semantic/catalog/Drizzle/adversarial parity without
   modifying frozen 0053–0058 unless a separately authorized migration plan is
   approved; 0059 remains prohibited now.
3. Design and independently audit a real production sandbox/native custody/LSM
   posture and a supply-chain-approved semantic worker.
4. Add real database admission/activation and authenticated output custody while
   keeping generation 1 disabled until every positive gate closes.
5. Implement and evaluate real reconstruction/detail-enhancement/HD workers,
   operator workflows and deterministic failure recovery.
6. Close external survey control, rights/licence and authenticated venue
   operator review gates. T-507 remains same-lineage diagnostic only and T-486
   remains offline/unsigned.

## Next prompt

Continue T-508 from this checkpoint without treating the Docker fixture as
production authority. Preserve frozen migrations/journal and every NO-GO gate.
Take the next bounded dependency in order: authenticated callable
runner/verifier contracts and 0058 parity, or a separately scoped production
sandbox/semantic-worker design. Require independent negative-first audit and
durable evidence before any activation proposal.

## Continuation addendum · Activation V1 single-envelope byte kernel

After the Docker fixture checkpoint, this continuation completed the smallest
offline prerequisite for authenticated evidence: a standalone exact-byte
canonical JSON and one-signature DSSE/Ed25519 kernel. T-508 is still in progress.

### Added paths and exact identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/activation-v1-authenticated-evidence-bytes.ts` | 33,847 | `50f330ebcd078164ed62430e61916e1346acdf62acab776c609e10496ba3f400` |
| `packages/reconstruction-foundry/src/__tests__/activation-v1-authenticated-evidence-bytes.test.ts` | 41,328 | `d12df31e9d81570d2ecf67633192135004825deeac0b41929b76e0f531ff77e2` |
| `packages/reconstruction-foundry/src/index.ts` | 5,035 | `e244613f6ae35d002a2d00329be588b230f4d9b7cc834e37f3897430de017d4f` |
| `docs/specs/omnitwin-foundry-activation-v1-authenticated-evidence-byte-vectors.json` | 6,604 | `c3daba1eeecd823d53be0cc83352049758fa730415d1a7e904cd4bd5f4f43d5a` |
| `docs/specs/omnitwin-foundry-activation-v1-authenticated-evidence-byte-vectors.schema.json` | 11,315 | `e6b601532a7f8ed99b251a16f09604d4c2be22823dcd68899238aa18be83ba1f` |

The kernel covers all nine exact §3 signed profiles and independently pinned
domain/payload-type literals. It snapshots intrinsic `Uint8Array` bytes before
callbacks; rejects other typed-array brands; enforces fatal UTF-8/no BOM,
duplicate-aware number-free canonical JSON, unsigned ASCII key order, Unicode
scalars and a 128-container safety bound; admits only the exact closed
single-signature envelope; rejects base64 malleability; enforces inclusive
1 MiB/512 KiB limits; and verifies exact PAE with a normalized, native,
unproxied RFC 8410 Ed25519 public `KeyObject`. It returns identity/digests only.

The public vector contains no private key and is explicitly wire-only. Dynamic
tests use disposable Ed25519 pairs. No production key, signer, provider,
credential, database, object store or network service was used.

### Final gates

- Focused conformance: 44/44.
- Strict Ajv 2020-12 schema compile and vector validation: valid.
- Full Reconstruction Foundry: 24/24 files, 259 passed, one existing skip.
- Full package lint, typecheck and build: passed.
- Independent round-trip corpus: 20,000/20,000.
- Final negative-first audit: no P0/P1/actionable P2 after closing byte-length,
  typed-array, re-entrancy, wrapped/private/proxy/shadow/export key attacks.
- Frozen 0053–0058 and journal hashes match the table earlier in this handoff;
  no 0059 exists. The authenticated-result-evidence source contract remains
  87,168 bytes at SHA-256
  `550169ce29f47982ea2ff36e7a88cf978d9941fbeb60f776f6d49d67d3560875`.

### Exact scope boundary

At this historical checkpoint, do not call this a complete authenticated-
evidence verifier. It was the single-envelope byte/authentication primitive
only. The later paired-bootstrap addendum supersedes item 1's equality,
distinct-identity and ordering omissions, but not its combined-digest omission.
Still absent at this checkpoint were:

1. paired bootstrap `envelopeA`/`envelopeB` equality, distinct roots/order and
   combined digest;
2. closed semantic schemas for runner/provider/storage/verifier/admin/source/
   gateway/bootstrap payloads and their transcript/state machines;
3. signer authorization, key-ID-to-SPKI registry binding, trust-bundle and
   workload currentness, transport identity and revocation;
4. verification-report and auxiliary-byte contracts, SQL canonical-byte
   parity, PostgreSQL admission and typed projections; and
5. closed privileged callable APIs and source-scoped containment/custody.

The current API still exposes one generic database pool rather than the eight
distinct `session_user` planes required by the Activation V1 design, so a clean
production callable boundary cannot be claimed or safely wired yet.

### Next prompt

Continue T-508 from the exact hashes above. Preserve the single-envelope kernel
and frozen migrations/journal. Implement one pure authority-none semantic
dependency next: preferably the closed runner-terminal payload/transcript
automaton, or first the `FoundryStageArtifactGraphV0` that it consumes. Then add
the GLB-verifier semantic receipt and paired bootstrap composition before any
SQL parity/callable work. Do not wire activation, generation 1, production
signing, provider/object-store access, registration, release, publication or
promotion. Require another independent negative-first audit and durable
checkpoint before widening scope.

## Continuation addendum · context-established runner frame ordering

After the single-envelope byte-kernel checkpoint, this continuation added the
smallest runner semantic primitive the frozen prose currently supports: a pure,
root-exported frame-kind order analyzer for context-established transcripts.
T-508 remains in progress.

### Added paths and exact identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/activation-v1-runner-transcript-frame-order.ts` | 12,281 | `e7fd22ad5d4d959ea669a92cccc44a208ebddfb72da6306573900db94ad27697` |
| `packages/reconstruction-foundry/src/__tests__/activation-v1-runner-transcript-frame-order.test.ts` | 17,305 | `4188faad00cab9f25afa1b925b8bb5f0fd2037442d371fa076727dd40023a588` |
| `packages/reconstruction-foundry/src/index.ts` | 5,101 | `aac01874439787036293f988fbb2210240f195c5156a4b58043b748397e4e73a` |

The analyzer enforces the exact §5 success topology and the specified failure
terminal/early-exit edges, requires a unique final terminal, permits spool
freeze only after worker exit, and enforces the inclusive 4,096-frame cap. It
snapshots exact plain/unproxied data input and returns only a frozen,
authority-none structural analysis. The unresolved pre-context setup-failure
arm is rejected.

### Final gates

- Focused conformance: 36/36.
- Full Reconstruction Foundry: 25/25 files, 295 passed, one existing skip.
- Full package lint, typecheck and build: passed.
- Independent §5 audit: no P0-P3 finding.
- Independent transition model: 19,442 probes, zero mismatches.
- Frozen authenticated-result-evidence spec: 87,168 bytes, SHA-256
  `550169ce29f47982ea2ff36e7a88cf978d9941fbeb60f776f6d49d67d3560875`.
- Frozen migrations 0053-0058 and journal: unchanged; no 0059 exists.

### Exact scope boundary

This is not a raw transcript parser or runner-terminal semantic validator. It
does not validate frame bytes/framing or the 32 MiB cap, sequence/time/hash
fields, frame payloads, artifact states, failure-matrix compatibility,
signatures, database admission, authorization or authority. Its result states
those exclusions explicitly. `FoundryStageArtifactGraphV0` is not defined in
the frozen contracts, and the Activation V1 stage is singleton, so no generic
DAG was invented.

### Next prompt

Continue T-508 from the current hashes above. Preserve this ordering primitive,
the single-envelope byte kernel, frozen migrations/journal and every NO-GO
gate. Before claiming a full runner-terminal semantic validator, first freeze
the exact raw-frame encoding/framing and hash domains, per-frame payload
schemas, artifact-state derivation, pre-context setup-failure arm and closed
failure matrix. A separately complete signed profile may be implemented first
if its semantic contract is already closed. Do not wire activation, generation
1, production signing, provider/object-store access, database admission,
registration, release, publication or promotion. Require another independent
negative-first audit and durable checkpoint before widening scope.

## Continuation addendum · paired-bootstrap wire precheck

After the context-established runner ordering checkpoint, this continuation
implemented the largest bootstrap subset supported by the frozen bytes without
inventing authority. T-508 remains active and in progress.

### Added contract and exact identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/activation-v1-authenticated-evidence-bytes.ts` | 51,869 | `1290090d38d3450b0fca1c770aedad0095363bf4f4954a2201d526d28fda7e1a` |
| `packages/reconstruction-foundry/src/__tests__/activation-v1-authenticated-evidence-bytes.test.ts` | 42,804 | `ef85cc9c1b0b720c862ba97ca0bae45049c867fcbb0f0839882b9ad3d36c19aa` |
| `packages/reconstruction-foundry/src/__tests__/activation-v1-bootstrap-envelope-pair-wire-precheck.test.ts` | 29,853 | `ad6ee499e251855e6d5b5bdd35ebe404977bde7a89afe4d361daaf0cd7059a5b` |
| `packages/reconstruction-foundry/src/index.ts` | 5,101 | `aac01874439787036293f988fbb2210240f195c5156a4b58043b748397e4e73a` |

`precheckFoundryActivationV1BootstrapEnvelopePairBytes` snapshots two exact
envelopes and signer configs, verifies one canonical bootstrap DSSE signature
per side under the directly supplied public key, requires exact shared payload
bytes/type, rejects repeated key IDs or normalized RFC 8410 SPKI identities,
rejects shared-memory backing and returns the two frozen identities in unsigned-
ASCII key-ID order. It carries `authority:none` and names the shared receipt as
the ordinary per-envelope payload receipt only.

The result explicitly says that root/key-ID binding, comparison against a
separately supplied installation manifest, manifest semantic validation, a
dual verification report, one-time sentinel state, the combined bootstrap
digest and database admission were not performed. Envelope-to-envelope payload
equality is performed. Do not rename or summarize this helper as bootstrap
verification or admission.

### Final verification

- Focused byte-kernel/pair suite: 67/67.
- Full Reconstruction Foundry: 26 files, 318 passed, one existing skip.
- Full package lint, typecheck and build: passed.
- Independent final TypeScript correctness review: no actionable P0-P3.
- Independent final specification-fidelity review: no P0-P3.
- Frozen vector JSON/schema remain unchanged at
  `c3daba1eeecd823d53be0cc83352049758fa730415d1a7e904cd4bd5f4f43d5a`
  and `e6b601532a7f8ed99b251a16f09604d4c2be22823dcd68899238aa18be83ba1f`.
- Frozen 0053-0058 and journal hashes remain exact; no 0059 exists.

The correctness suite now permanently covers key-owned public-key hooks,
runtime Map replacement, Buffer comparison/base64/static replacement, and
iterator-independent PAE/domain-hash/canonical traversal. These are ordinary
deterministic application-integrity regressions, not production authority.

### Still missing before a full bootstrap verifier

1. Exact combined-digest domain/tag/framing, separators and digest-member form.
2. A closed canonical installation-manifest schema and positive/negative vectors.
3. A closed dual verification-report schema and vectors.
4. The authoritative root/key-ID binding byte API.
5. Real installation manifest, root key IDs/SPKI digests and verifier pins.
6. One-time state, PostgreSQL byte parity and privileged database admission.

The authenticated-evidence, callable API and schema/privilege contracts remain
frozen at SHA-256 `550169ce29f47982ea2ff36e7a88cf978d9941fbeb60f776f6d49d67d3560875`,
`1a338fbd01521951c85d8b3ada30891ab4ad56c834066f6c8477d04fd07aa15f`
and `f3c053b3468e9a31bb79e91e09b9756736ac86d6a5d07ec402d9d98cdf39da41`.

### Next prompt

Continue T-508 from the exact hashes above. Preserve the paired wire precheck,
single-envelope kernel, runner ordering primitive, frozen migrations/journal
and every authority-none/NO-GO field. Do not compose or admit full bootstrap
evidence until all six missing inputs above are frozen. Take the next bounded
offline dependency whose semantics are already closed; otherwise specify the
missing raw-frame, semantic-receipt or bootstrap byte contract first. Keep
generation 1, activation, production signing/provider/object-store/database
writes, registration, release, publication and promotion disabled.

## Continuation addendum · gateway-token commitment proposal

The broad T-508 goal remains active. After the paired-bootstrap byte precheck,
the next semantic-profile scan found no complete implementation contract. This
continuation therefore produced proposal-only artifacts for
`gateway_token_commitment` and intentionally did not add executable validation
or change any runtime/database path.

### Proposal artifacts and exact identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/specs/omnitwin-foundry-activation-v1-gateway-token-commitment-proposal.md` | 9,146 | `708cebf62955e293e6fcda90e696a8f20b6164bd793e8db960c5021d841526c5` |
| `docs/specs/omnitwin-foundry-activation-v1-gateway-token-commitment-proposal.schema.json` | 5,077 | `ed1767703c6ecba64f2441e93252a55c7f06bd596f950669b9ff4f3334c7cefa` |
| `docs/specs/omnitwin-foundry-activation-v1-gateway-token-commitment-proposal-vectors.json` | 12,784 | `4f8838d712c4a68a773c94190dbdcfb3f2268409b960282ae32cd2acdda6b23b` |
| `docs/specs/omnitwin-foundry-activation-v1-gateway-token-commitment-proposal-vectors.schema.json` | 6,825 | `3bd6c6e862dba618892c759ac9c86525abd790a07b3fd194a0f16117f1b05073` |

The proposal fixes exact 22-member payload, 13-member comparison-context and
18-member authority-none result shapes. It defines seven stable error classes
and ordered first-error precedence. The result makes every excluded operation
explicit: canonical bytes, signatures, signer/target pairing and currentness,
nonce uniqueness, token generation/possession/redemption, queue delivery and
database admission are `not_performed`; runtime authority is `none`.

### Verification

- Stock Ajv 8.18 Draft 2020-12 with `strict:true` compiled both schemas and
  validated the full corpus without custom keywords.
- The corpus has two positive arms and 17 negative cases. An independent
  semantic mutation harness matched 19/19 expected outcomes, including the
  accepted exact 300-second boundary and both distinct expiry failures.
- Two final read-only reviews found no P0-P3 issue.
- Migrations 0053-0058 and the journal remain exact; no 0059 exists.

### Promotion boundary and next prompt

These artifacts remain `proposed_not_frozen`, not implementation-approved and
not implemented. They do not amend the parent design drafts. Owner review must
approve or replace the proposed purpose literal
`provider_command_claim_token`, queue-scope grammar and 300-second cap; the
parent drafts must then explicitly adopt the final contract before validator
implementation.

Continue T-508 while preserving the paired-bootstrap precheck, single-envelope
kernel, runner frame-order analyzer, all proposal-only labels, frozen
migrations/journal and every authority-none/NO-GO field. Do not implement the
gateway-token proposal before adoption. Take the next already-complete offline
semantic dependency, or draft the minimum missing runner raw-frame/receipt
contract without adding authority. Keep generation 1, activation, production
signing/provider/object-store/database writes, registration, release,
publication and promotion disabled.

## Continuation addendum · deterministic multimodal route planning

The super-app reconstruction planner now has one shared deterministic route
compiler instead of an all-assets-to-all-stages chain. The same provider-neutral
recipe is used for local and cloud plan-only candidates; nothing in this slice
authorizes execution.

### Preserved routing and truth contract

- Captured point, mesh and image/video modalities enter only their applicable
  lanes. Registration/fusion and all consumers retain full transitive source
  closure so rights cannot disappear through a dependency.
- Captured runtime splats are appearance-only. Enhanced-captured visual inputs
  are isolated from measured/training lanes. Generated/concept and opaque
  vendor-container inputs are inspection/QA/package-only. XBIN remains a hard
  pre-recipe blocker until a reviewed adapter exists.
- AI appearance and semantic branches are parallel; captured-only neural
  training depends on fusion and retains upstream training-rights checks.
- Output truth is explicit: captured, enhanced-captured, AI and mixed candidate.
  Only fused geometry and the operational mesh may be marked eligible for
  measured review, which confers no measurement authority.
- Rehashed recipes cannot substitute stage routing, lineage, output class,
  stage kind, output names or rights purposes. Rehashed blocked previews cannot
  claim compiled outputs.
- Route/dossier/preview ordering uses one internal code-unit comparator and is
  regression-pinned with `-`, `.` and `_` IDs. Existing canonical-JSON digest
  behavior remains unchanged to preserve established artifact bytes.

### Exact identities and gates

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/canonical-order.ts` | 213 | `3d511d1404accf2095a7ef6fa2b321cb1e036c4ac1ec8cd01de387b7f6a019af` |
| `packages/reconstruction-foundry/src/pipeline-recipe.ts` | 31,432 | `28f3b4ee057e04416ac5e86a916fa60d80cc1267c2324dbc6db9d11d245be8a6` |
| `packages/reconstruction-foundry/src/plan-only.ts` | 18,591 | `62bafaf06a2776a21aa746c804cd2f1341a761de725608c579e8634766a7c8bd` |
| `packages/reconstruction-foundry/src/plan-preview.ts` | 53,691 | `f37ca81b61d6fcc8068be595b3ad6ca5d4422cfb88dabc7069b2ba2059cc5249` |
| `packages/reconstruction-foundry/src/__tests__/pipeline-recipe.test.ts` | 31,830 | `3717297d7e6a82964987d6c6cbe254f9da1ee56c96b71669acdd99addc2f645b` |
| `packages/reconstruction-foundry/src/__tests__/plan-preview.test.ts` | 21,851 | `0729bf31a9b249d8279d4e731d5b1968ca375303c1268b34ac46f29ebd630033` |

- Focused router/preview suite: 24/24.
- Full Reconstruction Foundry: 26 files, 327 passed, one existing skip.
- Typecheck, full ESLint and build: passed.
- Final independent integrity review: no P0/P1 finding.
- Final schema/order re-review after corrections: no remaining P0-P2 finding.
- Frozen migrations 0053-0058 and journal: exact; no 0059 exists.

No process/worker/provider call, credential use, object-store access, production
database operation, spend, signing, registration, release, publication or
promotion occurred.

### Next prompt

Continue T-508 and the broad super-app goal from the exact identities above.
Preserve the shared router, verifier, truth separation, full rights/source
closure, XBIN/opaque-input handling, authority-none plan artifacts and all
existing frozen migration/digest boundaries. The next product slice should add
a read-only lane summary to the local application using
`compileFoundryStageAssetRoutingV0`, even when no reviewed worker bindings are
available. It must clearly distinguish route insight from an exact compiled
recipe and must not fabricate a trusted worker, provider, execution, cost or
release result. Keep every existing production/activation gate disabled.

## Continuation addendum · local read-only processing outline

The requested next product slice is complete. The loopback guided app now
returns `{ preview, processingOutline }` from `POST /api/plan-preview`. The
`preview` member remains the strict schema-validated artifact and is the only
member stored for `/api/plan-dossier`; the outline is ephemeral, non-digested
and explicitly non-executable.

### Preserved behavior

- The outline maps manifest assets to human lanes using only the shared route
  compiler. It does not expose a raw DAG or any worker, command, job, provider,
  cost, recipe, clearance, signing or release claim.
- Its state is `recipeState:not_compiled`, `authority:none` and
  `clearance:not_evaluated`. Captured-appearance output is labelled
  enhanced-captured and separate from both measured geometry and AI.
- Safe relative filenames and stable IDs make both ordinary lanes and the
  unavailable-XBIN card recognizable to the operator.
- Opaque LCC2 and generated/concept/mask evidence are pinned to source review
  plus review/package-only. A manifest reorder produces byte-for-byte equal
  outline data, and duplicate asset IDs fail before an outline is returned.
- Any admitted XBIN yields `state:unavailable`, zero lanes and no partial route.
  The strict preview still carries its independent XBIN planning blocker.

### Exact identities and gates

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `tools/reconstruction-foundry/src/local-app.ts` | 53,638 | `342cf8c54a8a92be90d1b1e41607df819bd9466ca47ad0b9d0041891d2babb8e` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 92,349 | `35fc8e396778932f28734a0a9386de873b705def258d93e9f4150354832c02f0` |
| `tools/reconstruction-foundry/src/__tests__/local-app-guided-workflow.test.ts` | 29,121 | `c97d4bf7ce0a9044e8f7bd11e8280e0f1a14d3a09a3d101e694cfae1632cdcec` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 7,065 | `c6d048e61b283b37d7179d76ec62ef213f1856c4224cb2928e7dd2bceedc619e` |
| `tools/reconstruction-foundry/src/__tests__/local-app-processing-outline.test.ts` | 10,001 | `22032e3dbddc8389db2faba4d87cee2d6176fd2e1d2450a7fc14b1a2bc02f537` |

- Focused local tests: 18/18.
- Full local Foundry CLI: 13 files, 149/149 tests.
- Typecheck, full ESLint and build: passed.
- Both final independent re-reviews: no P0-P2 findings.
- Frozen migrations 0053-0058 and journal: exact; no 0059 exists.

No worker/process/provider call, credential use, object-store access,
production database operation, spend, signing, registration, release,
publication or promotion occurred.

### Next prompt

Continue the broad super-app goal with this outline and the strict plan blocker
unchanged. Work only from already available offline evidence or explicit new
owner inputs. Do not invent a trusted worker or treat route insight as
clearance/execution authority. T-507/T-486 remain constrained by independent
control, rights and venue-attestation inputs; T-508 may continue through
another ordinary offline product slice that does not require those inputs.

## Continuation addendum · source-aware Quality Decision Board V0

The loopback plan screen now explains what could actually improve quality and
what evidence would prove it, without converting a preview into an execution
surface. The response is `{ preview, processingOutline, qualityDecisionBoard }`;
the board and outline remain ephemeral siblings outside the strict downloaded
dossier and its digest.

### Preserved behavior and evidence limits

- Four source-aware strategies cover captured-runtime preservation, real
  photo/video detail, separately reviewed operational geometry and an optional
  AI visual derivative. Every expected gain is `unmeasured`, no winner is
  selected, and AI appears only when the operator requests that comparison.
- Cards show mechanism, can/cannot, likely failure, decisive test,
  alternatives, evidence state and every exact represented safe path/asset ID.
  Full lists use expandable disclosure; nothing is silently truncated.
- Declared reviewed transform artifacts are separated from the stronger claim
  of complete relevant-frame coverage. Complete registration, load-bearing
  transform coverage, control/residual sufficiency and independent-control
  status remain `not_evaluated` unless a later purpose-built evaluator proves
  them. A manifest's mere contents never prove survey independence.
- XBIN remains a whole-board hard stop with zero partial cards and the exact
  official-export/vendor-supported next action.
- `authority:none`, `recipeState:not_compiled` and
  `clearance:not_evaluated` remain explicit. No worker, recipe, command,
  provider, execution, cost, signing or release surface was added.

### Exact identities and verification

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `tools/reconstruction-foundry/src/local-app.ts` | 77,325 | `9254adfa2cb49b427543893d657aeb6e61621c40dbc2fb5b59316628aebf1c1a` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 100,267 | `68efbf8d8c61577e20de7153f1a776a8c4a8fafbe4c7bd8696c52f7bd89ac3be` |
| `tools/reconstruction-foundry/src/__tests__/local-app-guided-workflow.test.ts` | 31,380 | `a5082bd6229727e11a8cb81663bd889e1d48e9fff9738bb0aecd250a8b53845e` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 8,495 | `14f1c4c116c09ac12deb7356638faf7d25ff9a83a0fa76519b4ba05567d04562` |
| `tools/reconstruction-foundry/src/__tests__/local-app-quality-decision-board.test.ts` | 16,410 | `f8d58261c9cbf133c0f14356f0a615fc261f129a5f8d54f5012f76b96b8c52c1` |

- Focused board/API/browser: 22/22.
- Full local CLI: 14 files, 156/156 tests.
- Typecheck, full ESLint and build: passed.
- Final independent semantic and UX reviews: no remaining P0-P2.
- Rendered QA: 1280x720 two-column and 320x844 single-column; all four cards,
  stacked/wrapping narrow statuses, no page-level horizontal overflow, zero
  warning/error logs and zero overlays. The receipt table remains locally
  scrollable inside its wrapper.
- Frozen migrations 0053-0058/journal: exact; no 0059 exists.

No cybersecurity/authentication/credential/cryptography work, worker/provider
call, object-store or production-database access, spend, signing,
registration, release, publication or promotion occurred.

### Next prompt

Continue T-508 and the broad offline super-app goal from the identities above.
Preserve the strict preview/digest, board evidence semantics, full source
disclosures, truth separation, XBIN all-or-nothing stop and every authority-none
gate. Build Universal Source Facts V0 as the next bounded slice: a canonical,
digest-bound, read-only facts artifact and local UI for E57, GLB and streaming
OBJ inspection, clearly separating established facts from unknowns. Reuse the
existing E57 metadata probe and GLB inspector, keep XBIN unsupported, add
determinism/adversarial tests, and do not add execution, workers, providers,
credentials, signing or production deployment. T-507/T-486 remain externally
gated by independent survey control, complete venue-attestation/release scope
and written rights decisions, but those gates do not stop this offline slice.

## Continuation addendum · Universal Source Facts V0

Universal Source Facts V0 is now implemented as a canonical, receipt-bound,
read-only sibling artifact and local-app panel/API. It adds no admission,
planning or execution authority.

### Preserved facts and unknowns

- E57 app facts stop at the exact 48-byte physical header. The bounded Python
  aggregate mode is implemented and tested separately, but no app call site
  exists and no aggregate is attached until an immutable/digest-carrying
  same-byte proof exists.
- GLB facts come only from the container header and a bounded strict first JSON
  chunk. URI values, BIN/accessor decoding and later chunks remain outside V0.
- OBJ facts come from a complete bounded streaming parse with strict numeric,
  continuation, vertex-arity and point-of-use index handling. Native-coordinate
  bounds are not converted into units or a venue frame.
- Each artifact is bound to the unchanged intake receipt plus per-file
  path/size/SHA-256 and carries a domain-separated canonical facts digest.
  Accuracy, registration, scale/units, completeness, rights and processing
  eligibility are never inferred from format declarations.
- XBIN remains an all-or-nothing hard stop with zero partial assets and only
  the official XGRIDS export next action.
- The local panel renders every established value, unknown reason and decisive
  next test, plus exact file/facts hashes and a canonical JSON download.

### Verification and residual gap

- Focused: artifact/intake/hash 46/46; local app/UI 21/21; shared E57 parser
  24/24; capture signature 2/2; bounded Python aggregate 8/8.
- Full: Reconstruction Foundry 342 passed/1 existing skip; local CLI 158/158;
  capture factory 32/32. Typechecks, touched-file ESLint and the three available
  package builds passed.
- A real mixed E57+GLB+OBJ loopback run returned three digest-bound assets and
  downloaded canonical JSON with `externalProcess:none`. A real XBIN+OBJ run
  returned zero assets and the official-export stop. Both sessions stopped and
  all temporary fixtures/logs were removed.
- Rendered QA remains open only because the in-app browser runtime could not
  start under the current desktop sandbox (`EPERM` at
  `C:\Users\blake\AppData`). Source-level 320px regressions passed, but do not
  substitute for real desktop/mobile overflow, console, overlay and screenshot
  evidence.

### Key identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/types/src/capture-intake.ts` | 16,707 | `da60efb74563797f61da198dc29cb34b6ae3c2cf4010fc2569bbccdb9428c3d8` |
| `tools/capture-factory/src/signature.ts` | 2,497 | `87d79a5afaf84a3e71515f4f92a459cd21f01269dba3485cf5985d135baaa73c` |
| `tools/capture-factory/python/foundry_phase1_probe.py` | 77,513 | `396342132a56eb585cb8f3f5d7320a2516d4ed208839c7d769d5e9796d8b697c` |
| `packages/reconstruction-foundry/src/hash.ts` | 5,668 | `627929d42d1612cd43b54be6f5600281de8e4f7cd6a9732c213f26c8f9ee4f84` |
| `packages/reconstruction-foundry/src/intake-receipt.ts` | 27,591 | `02d13e4b5ca1f7ff45d258b759fa3521c83ad58ca2c4da1db60e66fbcad2baa7` |
| `packages/reconstruction-foundry/src/source-facts.ts` | 86,700 | `759399a1085111499ce65cf140ec8bdb6095997293f182b52d39ef126843b82b` |
| `packages/reconstruction-foundry/src/__tests__/source-facts.test.ts` | 17,177 | `9eb02b56d00a4dc2dcf4f4c9e3348cf05b6a4e0a04cf9922a446dd0626808431` |
| `tools/reconstruction-foundry/src/local-app.ts` | 79,370 | `d8cc664aef66b255af1882a884cd3d092415373be14d2347a3d332c30959f285` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 111,819 | `eb8b4236fc020d8e031bca796316e206df5990048f11223949567037d9f9bbb6` |
| `tools/reconstruction-foundry/src/__tests__/local-app.test.ts` | 17,027 | `7172c4399006217f4ba166992b445a28c27d1b04c9afc9de95dcdad37c13a659` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 10,378 | `d5228d6db7fca36c29830e8c0c24c1f12c6b5462570ebb0b63d8eb80847f151c` |

Frozen migrations 0053-0058 and the Drizzle journal remain byte-exact; no
`0059*` exists. No cybersecurity/authentication/credential/cryptography work,
source mutation, app-side external process, worker/provider call, object-store
or production-database access, spend, signing, registration, release,
publication or promotion occurred.

### Next prompt

Continue T-508 and the broad offline super-app goal from the identities above.
First, when the in-app browser process is permitted, close the exact visual-only
gate by rendering a mixed E57+GLB+OBJ session at 1280x720 and 320x844 and
recording document/card/table overflow, console warnings/errors, overlays,
download interaction and screenshots. Then build a read-only Source Readiness
Map V0 from the receipted Source Facts plus the existing deterministic route
compiler. It should show supported input lanes, unknown evidence, blockers and
the decisive capture/export/registration test without compiling a recipe,
selecting a worker/provider or authorizing execution. Keep E57 aggregate facts
unattached until an immutable/digest-carrying same-byte proof exists; preserve
the XBIN hard stop, truth separation and every authority-none/frozen boundary.
T-507/T-486 remain externally gated by independent survey control, complete
venue attestation/release scope and written rights decisions, but those gates
do not stop ordinary offline T-508 product work.

## Continuation addendum · Source Readiness Map V0

Source Readiness Map V0 is implemented as a canonical pre-admission sibling of
the exact intake receipt and Universal Source Facts. It is intentionally not
built from the post-admission route compiler: the map reports source-family
representation and evidence gaps only and cannot imply route or processing
readiness.

### Exact checkpoint

- Schema/version: `omnitwin.foundry.source-readiness-map.v0`.
- Digest domain: `VENVIEWER_FOUNDRY_SOURCE_READINESS_MAP_V0`.
- Basis: `exact_intake_receipt_and_universal_source_facts`.
- Fixed lanes: point geometry, mesh geometry, image/video,
  registration/control, visual scene representation, context/evidence,
  vendor/opaque package and unclassified.
- Every available receipt file appears exactly once in the canonical file list
  and in every applicable fixed lane. Lane/file counts, duplicate-byte counts,
  Source Facts unknowns, five generic gap classes, decisive tests and summary
  are canonical derivations.
- Policy remains read-only, network/mutation/reconstruction none, admission not
  evaluated, route/recipe/worker/provider none, execution not authorized,
  authority none and rights/accuracy/registration not evaluated.
- XBIN remains all-or-nothing: zero files, zero gaps and no partial lane
  references/evidence; only the affected XBIN paths and official-export action
  survive.
- The local app compiles and parses receipt, facts and readiness before
  publishing any of them as ready. `/api/source-readiness` requires the exact
  current digest and emits canonical attachment bytes; stop clears all three.
- The panel sits immediately after Source Facts and renders complete lane,
  source, gap and next-test content. XBIN becomes an assertive accessibility
  alert while the digest/download footer remains available.

Final audits closed every actionable finding: duplicate labels are re-derived
globally; targeted detection cannot be hidden; blocked receipt count cannot be
smaller than affected sources; contradictory grouped unknowns produce a normal
schema failure rather than escaping `safeParse`; strict nested objects reject
injected route/recipe/job/worker/provider fields; known routes return 405 for
all unsupported methods; current available and blocked downloads are exact
canonical bytes; and the XBIN blocker is announced accessibly.

### Verification and live proof

- Focused readiness core: 12/12.
- Focused local app/UI: 26/26.
- Full Reconstruction Foundry: 28 files, 354 passed, one existing skip.
- Full local Foundry CLI: 14 files, 163/163.
- Reconstruction Foundry/local CLI typechecks, touched-file ESLint and both
  builds passed.
- Mixed live digest:
  `1bb1bececd801d8080b834281bef989bab7bf31056f6f938a369b6b0b1468901`;
  seven files, eight lanes, 28 unique grouped gaps, 28,562-byte current
  attachment, stale digest 409, no absolute/worker/job leakage.
- XBIN live digest:
  `2a69592f2641feab8e20b48778c186d941a7b48e07a2fef4cd74046dd3120b28`;
  zero files/gaps, eight blocked lanes, only `portal-cam.xbin`, stale digest
  409 and no `shell.obj`/absolute-root leakage.
- Browser QA at 1280x720 and 320x844 rendered all eight mixed lanes and all 30
  evidence/gap list entries, with no page-level horizontal overflow and no
  warning/error logs. Mixed desktop/mobile screenshots were visually checked.
  XBIN DOM/layout QA verified the alert, official-export text, affected path,
  zero lane articles, hidden summary/lanes, digest/download footer and no
  desktop/mobile overflow. The same mixed render closes the earlier Source
  Facts visual-only gate.

The in-app browser accepted the unique readiness-download button click without
page error but did not emit a programmatic Blob download event within five
seconds. Do not rewrite that as browser-event proof: exact download behavior is
instead proved by the live 200/409 responses and unit-level canonical byte
equality.

### Current identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/source-readiness.ts` | 47,621 | `274d82babbeb5aedf1ac655c657e34712b6d7dc9bc03890d1b74f7123c5ce3d5` |
| `packages/reconstruction-foundry/src/__tests__/source-readiness.test.ts` | 24,962 | `14c6732a5f101082d1bbafdcbde6d607ad5d30adcfdcda0a34725ec64e5bc59d` |
| `packages/reconstruction-foundry/src/index.ts` | 5,175 | `6b3ab81a7605dd7bc7edb779896e6e9419cd115d603f6b108f37398737f1d685` |
| `tools/reconstruction-foundry/src/local-app.ts` | 81,713 | `2b06dcf8378b509f2c85e2c3c7ecf1d7204d543871da236df24d1065ccc33254` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 126,239 | `351394fed2081bc892efcba4328b50201bcf3acbb1f1e8395ad57bed9c5e0ab5` |
| `tools/reconstruction-foundry/src/__tests__/local-app.test.ts` | 21,193 | `c43afc423c027e0a5618b150b5925df260227e915fafae6099a06ed23bb3d6df` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 16,795 | `f784c65ee654e733a51b4c28796ba43eff4a72d9ddfb1a5309ed8e85d5ebb388` |

Frozen migrations 0053-0058 and the Drizzle journal remain byte-exact; no
`0059*` exists. E57 aggregate facts remain deliberately unattached until an
immutable/digest-carrying same-byte association exists. No cybersecurity,
authentication, credential or cryptography work, source mutation, app-side
external process, worker/provider/object-store/production-database action,
spend, signing, registration, release, publication or promotion occurred.

### Next prompt

Continue T-508 and the broad offline super-app goal from these exact identities.
Preserve the receipt/facts/readiness digest chain, fixed lane/gap derivations,
strict parser, XBIN all-or-nothing stop, accessibility behavior and every
authority-none/frozen boundary. Build a digest-bound operator evidence
checklist from the readiness map: prioritize exact capture, official-export,
bounded-inspection and registration-input requests, show all affected relative
paths and required completion evidence, and do not acquire data, mutate files,
compile a route, select a worker/provider or authorize execution. T-507/T-486
still need independent survey control, complete venue-attestation/release scope
and written rights decisions for their own completion, but those inputs do not
block this ordinary offline slice. T-508 remains active and in progress.

## Continuation addendum · Operator Evidence Checklist V0

Operator Evidence Checklist V0 is now the canonical pre-admission bridge from
the exact Source Readiness Map to concrete evidence requests. It is not a job,
route, acquisition order, approval record or completion tracker.

### Exact checkpoint

- Schema/version: `omnitwin.foundry.operator-evidence-checklist.v0`.
- Digest domain: `VENVIEWER_FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V0`.
- Basis: exact Source Readiness Map; binds receipt, Source Facts, readiness and
  checklist SHA-256 values.
- Every reviewed generic gap/unknown has one fixed category, evidence priority,
  label, reason, requested test and completion evidence definition. Unknown
  future codes fail closed.
- Missing-source work starts with a desired-output scope decision, permits no
  selected lane and only requests new receipted sources for selected lanes.
- Format, bounded-inspection and provenance results require the exact requested
  test to be attempted and recorded; unresolved is an outcome only after that
  attempt and its limitation.
- Each affected path carries size/digest, duplicate identity, per-path lanes,
  readiness status and inspection evidence. Item lanes equal their source-lane
  union; path counts remain distinct from content counts.
- The verifier recompiles and canonical-compares against exact Source
  Readiness. Standalone schema validity is not proof of upstream completeness.
- Policy remains read-only, desired-output profile not bound, necessity/
  admission/rights/accuracy/registration not evaluated, no mutation/network/
  reconstruction/request performance/completion tracking, no route/recipe/
  worker/provider, execution not authorized and authority none.
- XBIN remains atomic: zero ordinary items/groups and one official-export
  blocker with only affected XBIN paths.

The local app publishes receipt/facts/readiness/checklist atomically, adds the
exact-digest canonical download route and clears all four on failure/stop. The
panel after Source Readiness renders every request/criterion/limit, shows
path-to-family and duplicate/distinct-content truth, lazily creates complete
source rows only when the disclosure opens and has local polite download
feedback. XBIN retains only the blocker and digest/download footer.

### Verification and live proof

- Focused core: checklist + readiness 21/21.
- Focused local app/UI: 30/30.
- Full Reconstruction Foundry: 29 files, 363 passed, one existing skip.
- Full local CLI: 14 files, 167/167.
- Both package builds, typechecks and complete source-tree lints passed.
- Three independent final audits: no P0/P1; every P2 was corrected and
  regression-pinned.
- Mixed live checklist:
  `50d12466ff3e74c18d111e1b2e1bcb5bc200ab1503c6cf3bbc69128d1444f1bb`;
  48,971 bytes, 28 items/three groups, exact upstream bindings, current 200,
  stale/malformed 409, no absolute root or operational fields.
- XBIN live checklist:
  `49056f36601ad440544bc48a9804a04ab785e85c45f9209a9d64d68a54943639`;
  3,151 bytes, one blocker, zero groups/items, only `portal-cam.xbin`, current
  200/stale 409 and no `open.obj` or absolute-root leakage.
- Browser QA at 1280x720 and 320x844 rendered the complete available checklist
  and XBIN block with no horizontal overflow or warning/error logs. Lazy mixed
  disclosure opened exactly its two path/family rows; 26 others stayed empty.
  XBIN opened only `portal-cam.xbin`. Desktop screenshots were checked; mobile
  screenshot commands timed out, so mobile proof is the exact DOM/geometry
  measurements, not a screenshot claim. No browser download was triggered.
- Both sessions stopped with 202; ports and all temporary files were removed.

### Current identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/source-readiness.ts` | 47,714 | `dcbab76ac8bc4f7c71ac1b4b8fb8b31ae3e4b7ea2c98f997b42d6071792af27f` |
| `packages/reconstruction-foundry/src/operator-evidence-checklist.ts` | 52,151 | `e1dc8b645ac90eb018acc955878bb2eb2baba805326fd4efb88572e4d6510de3` |
| `packages/reconstruction-foundry/src/__tests__/operator-evidence-checklist.test.ts` | 24,609 | `0ee860aa0ca1654759f4c0c31560b2e82576c0c54180340fb53741b1f5adb35e` |
| `packages/reconstruction-foundry/src/index.ts` | 5,225 | `a4d07261b2d952852da5813cb50d921a3702c4150fe1bf51f6717484701ecc16` |
| `tools/reconstruction-foundry/src/local-app.ts` | 84,392 | `8eaef7e26295f83defeb0857de59dbb19e66ce44949106d6e3b58cea561e90f8` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 143,111 | `ea0c1bfcd0a95bf0f901271a649ab2972e078f24db143215f7c44a27115b047f` |
| `tools/reconstruction-foundry/src/__tests__/local-app.test.ts` | 25,814 | `f0b918bbc64bec867db2bf6c4b876af8baf791314ba25ab82a89b5c35f8e0feb` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 23,562 | `e36e759ee976381bd3de357bbb078d6c5ec8dbded608b6b0ddd6976400cce0dc` |

Frozen migrations 0053-0058 and the Drizzle journal remain byte-exact; no
`0059*` exists. No cybersecurity/authentication/credential/cryptography work,
acquisition, source mutation, app-side external process, worker/provider/
object-store/production-database action, spend, signing, registration, release,
publication or promotion occurred.

### Next prompt

Continue T-508 and the broad offline super-app goal from these identities.
Preserve the receipt/facts/readiness/checklist digest chain, exact verifier,
scope-before-acquisition semantics, per-path lanes/duplicate truth, lazy complete
UI, XBIN atomic stop and every authority-none/frozen boundary. Next extend
Universal Source Facts with bounded image, video, splat, calibration and
trajectory facts, then run one small rights-cleared real detail experiment with
frozen viewpoints and independent controls. Do not acquire or process data,
compile a route, select a worker/provider or authorize execution merely because
the checklist names an evidence dependency. T-507/T-486 external survey,
attestation/release and rights inputs remain required for their own authority
claims but do not block ordinary offline T-508 work. T-508 remains active and
in progress.

## Continuation addendum · Gaussian PLY Source Facts V3

The SPZ V2 checkpoint above is now followed by a new immutable Gaussian PLY V3
profile. This remains ordinary local 3D reconstruction-product engineering.
No cybersecurity, credential, cloud, deployment, signing, publication or
source-mutation work was required.

### Exact checkpoint

- Current schemas/domains are Universal Source Facts V3, Source Readiness Map
  V3 and Operator Evidence Checklist V3. V1/V2 were not widened and the frozen
  V2 chain golden remains green.
- Intake now distinguishes the receipt candidate `gaussian_ply` from an
  ordinary PLY point cloud. The inspector receives only the already-open,
  identity-checked handle used by the full SHA-256 pass and finalization rejects
  a substituted observer identity.
- The first profile covers case-sensitive PLY 1.0 `binary_little_endian`, one
  fixed-width vertex element, float32 `x/y/z`, `f_dc_0..2`, `opacity`,
  `scale_0..2`, `rot_0..3`, optional all-or-none `nx/ny/nz`, and complete
  `f_rest` counts 0/9/24/45/72. Property order is arbitrary and every byte
  offset is derived from the declaration order.
- Unique fixed-width scalar extras are bounded and retained. Property names
  use printable non-whitespace ASCII; encoding and scalar tokens are
  case-sensitive. PlayCanvas packed PLY is deferred only when its complete
  legacy/current signature is present, so one `packed_*` extra does not create
  a false packed-format result.
- Bounds are 128 GiB source, 1 MiB header, 64 KiB header line, 64 elements,
  4,096 properties, 256 combined comments/obj_info lines, 100,000,000 vertices
  and 32,768-byte stride. Exact `header + count × stride = source` is required.
- Structural success never decodes values. Eleven state-neutral unknowns keep
  decoded attributes, encoding semantics, physical bounds, units, frame,
  renderer compatibility, fidelity, provenance, accuracy, registration and
  rights outside the result. XBIN still withholds every partial ordinary
  artifact and exposes only the official-export action.

### Real proof

| Source | Exact structural result | Receipt → facts → readiness → checklist |
| --- | --- | --- |
| Reception LCC SH3 | 496,504,970 bytes = 2,026 + 2,002,028 × 248; 62 properties; normals; SHA `da8efa94…` | `d8172f1f…` → `8d192581…` → `0f215f55…` → `5af3c317…` |
| Reception LCC SH0 | 134,589,707 bytes = 911 + 1,979,247 × 68; 17 properties; normals; SHA `8f6894aa…` | `2d59fb1b…` → `eb7cf5f3…` → `e6367875…` → `086b3391…` |
| Brush `export_05000.ply` | 11,859,606 bytes = 1,550 + 50,246 × 236; 59 lexicographically declared properties; no normals; SHA `ae5cffa8…` | `96229acc…` → `2305a6ce…` → `7920416a…` → `f63dbdb2…` |

Each chain has one represented visual-scene lane, 12 readiness gaps and 12
checklist requests in two groups. The exact complete hashes, limits, mappings,
non-claims and primary-source pins are retained in
`docs/reports/reception-room-gaussian-ply-source-facts-v3-evidence-2026-07-17.json`.

### Runtime and verification

- The local app renders V3 receipt, facts, readiness and checklist artifacts
  and exposes all declared PLY properties, types, roles and byte offsets.
- Real Brush QA at 1280×720 and 320×844 showed all 59 rows with no page-level
  horizontal overflow; the table scrolls only inside its panel. Console
  warnings/errors were empty.
- Receipt, Source Facts V3, Source Readiness V3 and Checklist V3 canonical
  downloads each returned 200 JSON attachment responses; their UI controls
  were exercised. The local server was then stopped.
- Final audit hardening keeps normal offsets in semantic `nx/ny/nz` order,
  uses case-sensitive bounded PLY grammar for receipt classification, and
  refines a valid header beyond the 64 KiB receipt probe only after established
  same-handle inspection. Failed ordinary PLY remains outside V3.
- Gates: classifier 18/18; inspector 21/21; combined V3 chain 35/35; V3 plus
  frozen V2 golden 48/48; shared types 2,110/2,110; full core 494 passed/1
  skipped across 37 files; local app 174/174 across 14 files; every
  lint/typecheck/build gate passed. Two independent audits found no remaining
  actionable P0-P3.

External survey/control, provenance/rights and renderer/reference evidence is
needed only before making the corresponding authority claims. It is not needed
to continue the ordinary local super-app implementation.

### Latest next prompt

Continue the active OmniTwin Foundry /goal from the latest Gaussian PLY V3
checkpoint. Treat this as local 3D reconstruction and product engineering.
Exclude cybersecurity, credential, penetration-testing, cloud-deployment,
signing and publication work. Preserve raw sources read-only and keep V1/V2/V3
artifact meanings immutable. Next, build a new bounded image/video container-
facts profile and keep capture-role classification (DSLR, phone, panorama,
captured or generated) separate from file validity. Do not authorize processing
merely because a format fact or evidence request exists. T-507/T-486 authority
inputs remain necessary only for authority claims; T-508 remains active.

## Continuation addendum · SPZ Source Facts V2

The SPZ-only immutable profile is complete. This is ordinary local super-app
source-understanding work; it required no cybersecurity, credential, cloud,
deployment or publication work and performed no reconstruction or source
mutation.

### Exact checkpoint

- Active local schemas are Universal Source Facts V2, Source Readiness Map V2
  and Operator Evidence Checklist V2. V1 is not widened; a literal gzip fixture
  and fixed timestamp pin its exact facts/readiness/checklist canonical bytes
  and digests.
- `inspectSpzSourceFacts` receives the already-open, identity-checked handle and
  completed SHA-256/size. It never receives or reopens a path. The high-level
  intake path is the only package-root V2 issuer surface; the caller-supplied
  collector/result issuer remains internal.
- Legacy v1-v3 covers exact layouts, single-member gzip, CRC/ISIZE, exact EOF,
  optional gzip headers and declared bounded trailing ILV extension records.
  V4 covers header/extensions/TOC and five or six complete independent
  Zstandard ranges, including exact compressed-input consumption.
- Bounds are 64 GiB source/decompressed, 1 MiB gzip header, 16 MiB/256 extension
  records and v4 plausibility ratio 1024. Old Node 22 runtimes can import the
  package and inspect legacy sources; unsupported v4 decompression returns the
  stable runtime-unavailable outcome.
- Ten SPZ unknowns remain explicit and state-neutral. They do not establish
  decoded attributes, physical bounds, units, venue frame, renderer support,
  visual fidelity, provenance, metric accuracy, registration or rights.
- Runtime registries are frozen; V2 evidence-code aliases are versioned. The
  artifact digest is canonical local self-consistency only and authority stays
  `none`; it is not independent attestation.
- XBIN remains an all-or-nothing stop. Gaussian PLY is still outside V2 and is
  the next immutable profile.

### Real proof and verification

The eight clean Reception v3 SPZ files re-established 52,911,630 source bytes,
3,459,703 Gaussians and 69,194,188 decompressed bytes with eight unique hashes.
Final chain:

- Receipt: `3fa54eba75cbb22d4fcc947027641f156472df546d553012b297e32bde875a58`
- Source Facts V2: `c665eb1350d0a39197d425167c8e3e3f0557c5186f194132699ed1280b3cb615`
- Source Readiness V2: `07132d0589254211312cd72b2780b11a815c5a0afcfae05dbdc287b29e68976f`
- Checklist V2: `94bf31b16fe4c812f07637077d98e85acc5ce85a52fa18e89930ec5e9ef94de4`

The final evidence manifest is
`docs/reports/reception-room-spz-source-facts-v2-evidence-2026-07-17.json`.
Desktop 1280×720 and mobile 320×844 captures render all eight cards with no
page overflow or console warning/error. A synthetic v4 HTTP fixture proves two
extension records, SH degree 2 and all six stream records survive canonical
download exactly.

| Gate | Result |
| --- | --- |
| Focused SPZ contract | 3 files; 52/52 passed |
| Full Reconstruction Foundry | 34 files; 459 passed; 1 existing skip |
| Full local Foundry app | 14 files; 172/172 passed |
| Lint / typecheck / build | both packages passed |
| Independent final audits | no actionable P0-P3 |

### Current identities

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/spz-source-facts.ts` | 33,040 | `e30eed8f7cc20d214c4b848307f7480b35bf72a0ea5ad2af4c040d7786846feb` |
| `packages/reconstruction-foundry/src/source-facts-v2.ts` | 40,550 | `0a6cf6f06e2d83bdf92e6b8eecd61190ea1e257bb02a736d2767a4d7a77cdeca` |
| `packages/reconstruction-foundry/src/source-readiness-v2.ts` | 48,227 | `0891b2646605f0456aca1e23259513120c90de083a01b56bb2940b361dc950c9` |
| `packages/reconstruction-foundry/src/operator-evidence-checklist-v2.ts` | 60,375 | `771203499c8a937a70273a34ac08fb470a1b8ed90e96eccc2191c5b506d5ba31` |
| `packages/reconstruction-foundry/src/intake-receipt.ts` | 32,871 | `c4532e1305e8a554468ffdb473d071a317cde4018be97249b6979dcf376af488` |
| `packages/reconstruction-foundry/src/index.ts` | 6,836 | `bfd0043c3dcf03f1cda7c087e98993cc46bfe7ac3df05fd09f0f10562172e210` |
| `packages/reconstruction-foundry/src/__tests__/spz-source-facts.test.ts` | 18,767 | `78a31a4c28743861d67330cd0ea8835f2f7144e8176823e3d31687a799eab6fd` |
| `packages/reconstruction-foundry/src/__tests__/spz-source-pipeline.test.ts` | 20,473 | `d3b62cb4b9ce7413076f57193672daf7e4faea4874bcc2c32555821eb3d6fb1b` |
| `packages/reconstruction-foundry/src/__tests__/spz-zstd-runtime-fallback.test.ts` | 2,789 | `f959d3d75a42a82ca66a986a27c0f9ae110de7d4863919480650e7d68b7d971c` |
| `tools/reconstruction-foundry/src/local-app.ts` | 84,419 | `2c5278e4e0d0d29726a89cac01b6aedd58ac55f530f938e4d0846704554eeba3` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 143,385 | `e03a7e697a4aeeed253f9541419f98908c80d5651e183567f43792916d42e9f0` |
| `tools/reconstruction-foundry/src/__tests__/local-app.test.ts` | 35,816 | `b53adee1fb8a6148fe7f7f1b5f54dff848f30fa7654443253747ed66d6d7aee5` |
| `docs/reports/reception-room-spz-source-facts-v2-evidence-2026-07-17.json` | 8,704 | `971cf5a8d20a59dea4431fd613c9977466f45cc2962f4fa1bf198a9da4436521` |
| `docs/reports/evidence/local-foundry-spz-v2-desktop-2026-07-17.png` | 221,079 | `d6025ef159cfd02dbf7076f5355fa68ad56c16e39e9af5138ecd207ff7fd1b96` |
| `docs/reports/evidence/local-foundry-spz-v2-mobile-2026-07-17.png` | 72,935 | `8e2c3de2597b95fe9d6fc20062a714c767b3601bc1d3e9a2dc11b401e94bc015` |

### Next prompt

Continue T-508 and the broad offline super-app goal from the SPZ V2 evidence
chain above. Preserve the immutable V1/V2 meanings, same-handle identity
binding, XBIN atomic stop, state-neutral unknowns, internal issuer boundary,
canonical-download behavior and authority-none semantics. Build a new bounded
Gaussian PLY Source Facts profile rather than widening V2; then separate image
and video container facts from capture-role classification so a valid file does
not erase DSLR/phone/panorama or captured/generated ambiguity. Use current local
data read-only where available. Do not acquire or process new data, compile a
route, select a worker/provider or authorize execution merely because an
evidence request exists. T-507/T-486 survey, rights and attestation inputs remain
required for authority claims but do not block ordinary offline T-508 work.
T-508 remains active and in progress.

## Continuation addendum · SOG Source Facts V1

The canonical receipt evidence chain now has an immutable V1 profile and one
new real splat target: standalone stored-ZIP SOG v2. This is ordinary offline
T-508 product work, not reconstruction, admission or activation.

### Exact checkpoint

- Current schemas/domains are Universal Source Facts V1, Source Readiness Map
  V1 and Operator Evidence Checklist V1. V0 was not silently widened because a
  SOG receipt now produces materially different canonical bytes.
- The SOG inspector receives only the already-open, identity-checked handle
  used by the complete second-pass hash. It never receives or reopens a path.
  The completed main SHA-256 is passed into the observer; every outcome carries
  that source SHA/size, and collector finalization rejects a same-size outcome
  substituted from different bytes.
- Bounds: 64 entries; 4 MiB central directory; 1 MiB duplicate-key-safe
  fatal-UTF-8 meta JSON; depth 64; 100,000 JSON values; 32 MiB per WebP; 128 MiB
  aggregate planes.
- It rejects encryption, ZIP64, multidisk, compression, unsupported flags,
  unsafe/duplicate names, prefix/gap/overlap, contradictory local/central
  fields, CRC/size/member/meta faults and unsigned/ambiguous descriptors.
- Signed 32-bit descriptors are supported only with exact signature, CRC and
  compressed/uncompressed-size agreement. This is the actual Reception/XGRIDS
  layout, not a compatibility guess. Valid local zero placeholders are reported
  as consistent with the central directory rather than literally equal. Actual
  unsigned 12-byte descriptors return one stable unsupported result, and late
  cancellation is rechecked after final identity inspection.
- Established facts stop at SOG/meta declarations, encoded means ranges,
  antialias/SH declarations, exact container/member checks, complete WebP RIFF
  member structure/dimensions/VP8L header and Gaussian pixel capacity. No member filename
  is emitted.
- Ten explicit unknowns preserve decoded attributes, physical bounds, units,
  venue frame, renderer compatibility, appearance fidelity, provenance,
  accuracy, registration and rights. All ten have exact V1 checklist mappings.
- SOG maps only to `visual_scene_representation`; malformed SOG remains a
  per-file target failure. XBIN still prevents every partial parser/result.

### Real proof and verification

The existing Reception Quality `0_15_0_0.sog` reproduced its prior exact
10,279,160-byte SHA-256
`111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368`.
The artifact established 602,409 declared Gaussians, eight stored members,
eight exact signed descriptors, seven CRC-verified complete RIFF members with
VP8L headers, shared 780×776
per-Gaussian capacity and SH bands 3 / palette 65,536. Canonical Source Facts
download returned 200. These facts do not establish visual quality, metric
truth, rights, registration or processing suitability.

Pixel decodability and Gaussian attributes were not established.
The authority-none chain is retained in
`docs/reports/reception-room-sog-source-facts-v1-evidence-2026-07-16.json`:
receipt `caf51aaf59b0170b6e3ae59c8bf2e9d1423b04f8b89123bdc4cfe9754473bb14`,
Source Facts `5c0118f0ff4908353bcfd3087e55b73739a70544887c201ef97a215a61c1bf69`,
Readiness `8f9b5fb38f36ba13942e32dae57099c0421871f90e599fe29780e05d8eaa85a6`
and Checklist `a2c160af90d12b2c9c46cd33464e1827709b486922c98b7484fbebc8496d5bf9`.

| Gate | Result |
| --- | --- |
| SOG inspector + pipeline | 43/43 passed |
| Full Reconstruction Foundry | 31 files; 407 passed; 1 existing skip |
| Full local Foundry CLI | 14 files; 168/168 passed |
| Builds / typechecks / full lints | both packages passed |

Live desktop/mobile QA at 1280×720 and 320×844 had no page-level horizontal
overflow and no warning/error logs; the wide receipt table remained locally
scrollable. Exact final SOG facts/copy were checked by DOM/geometry. The in-app
browser screenshot channel stalled on the unusually tall page, so no false
in-app screenshot claim is made; local Chromium fallback captures were visually
checked. A separate XBIN state exposed zero facts assets, readiness files/gaps
or checklist items/groups and only the official-export block. Both listeners
and all temporary files were removed.

Final audit also added an explicit `Unresolved facts` UI count and renamed the
source-level counter to `Sources not established or untargeted`; the responsive
summary remains 5/2/1 columns. The canonical architecture and runbook now lead
with the ordinary local multimodal path and keep the optional release workflow
separate.

### SOG checkpoint identities (superseded by the SPZ V2 addendum)

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `packages/reconstruction-foundry/src/sog-source-facts.ts` | 42,355 | `253c7832d3274c513a7b74302e0c158c5b7e6d28be678b2a80e31a48fe26fe1c` |
| `packages/reconstruction-foundry/src/__tests__/sog-source-facts.test.ts` | 26,279 | `3fa530d81a04c65f486e08360ffd66f06e674cfe17df4d7efb809db97d39a8c2` |
| `packages/reconstruction-foundry/src/source-facts.ts` | 102,591 | `3b2fd18024b7acebdec3a5ac57098f1c57d9da98c301c26d271850d886a1ba8b` |
| `packages/reconstruction-foundry/src/hash.ts` | 6,471 | `3208dca57440fbb89947fe876d331bfcc8fd3797709346550182b00ba826f25d` |
| `packages/reconstruction-foundry/src/intake-receipt.ts` | 28,398 | `25520078ed393954f3c56a32121901f95063ef55ee2ce29a830cfb9d0bfe09da` |
| `packages/reconstruction-foundry/src/source-readiness.ts` | 47,958 | `c1575fb7308d33927ce34a38695b60f66c24ca12ca40a20c9e2e04019acec3e7` |
| `packages/reconstruction-foundry/src/operator-evidence-checklist.ts` | 56,214 | `c853495a61832982f8888b560b6c35a2f5a906cddd46cd4730abde595e412c1b` |
| `packages/reconstruction-foundry/src/__tests__/sog-source-pipeline.test.ts` | 13,525 | `fb345d8394374eaf544eaef53e6b34dfd35a45f145b49d9f8c9aa0236cae748f` |
| `packages/reconstruction-foundry/src/index.ts` | 5,264 | `0bc53bf9d2fb37423143d52aa14f981d941bf955926d181c663760510c0674e3` |
| `tools/reconstruction-foundry/src/local-app.ts` | 84,392 | `84e67dd7a65c6d3666651d2506c56b3b70571c066709620cb178dd29bdfc0e0a` |
| `tools/reconstruction-foundry/src/local-app-assets.ts` | 143,354 | `f8eb8e6efb60adc15738a4ded22ece3ee903c791c831826ec251fc7be6a8998e` |
| `tools/reconstruction-foundry/src/__tests__/local-app-assets.test.ts` | 24,730 | `97b4202b2fa97fe0fa76dd1a44b928322e462a6e3f503769fa7ffd3172a3e942` |
| `docs/reports/reception-room-sog-source-facts-v1-evidence-2026-07-16.json` | 5,138 | `db3889bfbbef0444c2067175c08b34590b9524101e1e5ca0c253bff54a8b6226` |

Frozen migrations 0053-0058 and the Drizzle journal remain byte-exact; no
`0059*` exists. No cybersecurity/authentication/credential/cryptography work,
source mutation, external service, worker/provider/object-store/production-
database action, spend, signing, registration, release, publication or
promotion occurred.

### Latest next prompt

Continue T-508 from the later SPZ V2 checkpoint above. Preserve immutable V1
and V2 meanings, same-handle source identity, XBIN atomic stop, state-neutral
unknowns, the internal issuer boundary, canonical-download behavior and every
authority-none boundary. Build a new bounded Gaussian PLY Source Facts profile
rather than widening V2. Then separate image/video container facts from
capture-role classification so a valid JPEG or PNG cannot erase DSLR, phone,
panorama, captured or generated ambiguity. Do not acquire or process new data,
compile a route, select a worker/provider or authorize execution merely because
an evidence request exists. T-507/T-486 external survey, complete venue
attestation/release and written rights inputs remain required for authority
claims but do not block ordinary offline T-508 work. T-508 remains active and
in progress.

## Current continuation pointer · after Gaussian PLY V3

This pointer supersedes every earlier `Latest next prompt` in this cumulative
handoff. Gaussian PLY V3 is complete and independently audited; do not repeat
the SPZ or Gaussian PLY slices.

Continue the active OmniTwin Foundry /goal from the latest Gaussian PLY V3
checkpoint. Treat this as local 3D reconstruction and product engineering.
Exclude cybersecurity, credential, penetration-testing, cloud-deployment,
signing and publication work. Preserve raw sources read-only and keep V1/V2/V3
artifact meanings immutable. Next, build a new bounded image/video container-
facts profile and keep capture-role classification (DSLR, phone, panorama,
captured or generated) separate from file validity. Do not authorize processing
merely because a format fact or evidence request exists. T-507/T-486 authority
inputs remain necessary only for authority claims; T-508 remains active.

## Current continuation pointer · after image/video Container Source Facts V4

This pointer supersedes the earlier Gaussian PLY V3 continuation pointer.
Image/video Container Source Facts V4 is complete and independently audited;
do not repeat the SOG, SPZ, Gaussian PLY or media-container slices.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Preserve raw sources read-only, immutable V1-V4
artifact meanings, the later-pass same-handle identity binding, canonical media
candidate ordering, XBIN atomicity, internal issuance, authority-none semantics
and the separation between container validity and capture role/provenance.

V4 supports bounded SOF0/SOF2 eight-bit Huffman JPEG, static PNG and ISO-BMFF
movie/video-declaration inspection. Real evidence covers JPEG and PNG only;
ISO-BMFF remains fixture-only and does not establish sample-table completeness,
`mdat` binding, sample decode or decoder compatibility. Ten media unknowns
remain explicit. The exact evidence chain and browser QA are in
`docs/reports/reception-room-image-video-container-source-facts-v4-evidence-2026-07-17.json`.

Next build bounded calibration and trajectory source facts, as queued by the
earlier source-understanding roadmap. Do not infer capture role or provenance
from filenames, dimensions or metadata; acquire or process new data; compile a
route; select a worker/provider; or authorize execution merely because an
evidence request exists. A rights-cleared detail experiment remains later work
requiring its stated inputs. T-507/T-486 inputs are needed only for authority
claims. T-508 and the broader offline super-app goal remain active.

## Current continuation pointer · after Calibration / Trajectory Source Facts V5

This pointer supersedes the earlier image/video Container Source Facts V4
pointer. Calibration / Trajectory Source Facts V5 is complete and independently
audited; do not repeat the SOG, SPZ, Gaussian PLY, media-container or
calibration/trajectory structural slices.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, penetration testing,
cloud deployment, signing and publication are out of scope. Preserve raw
sources read-only, immutable V1-V5 artifact meanings, same-open-handle exact
size/SHA-256 binding, format-specific failure registries, cancellation
non-issuance, V1-V5 target precedence, XBIN atomicity, internal issuance and
authority-none semantics.

V5 establishes only bounded UTF-8 CSV record structure and JSON syntax/tree
shape. It does not establish field semantics, time units or cadence, frame,
CRS, units, transform/quaternion convention, calibration applicability,
synchronization, accuracy, drift, provenance, rights, registration or
permission to process. Real evidence covers four trajectory candidates;
calibration remains fixture-only. Exact chains and final truth boundaries are
in
`docs/reports/calibration-trajectory-source-facts-v5-evidence-2026-07-17.json`.

Next, inventory the remaining open point-geometry inputs and freeze a distinct
V6 Source Facts profile beginning with ordinary non-Gaussian PLY. Add LAS/LAZ
or XYZ only where real local inputs and explicit bounded contracts support
them. Keep point property structure separate from units, frame/CRS, accuracy,
provenance, rights and authority. Do not acquire or process new data, compile a
route, select a worker/provider, authorize execution or reinterpret an evidence
request as permission. T-507/T-486 inputs remain necessary only for authority
claims. T-508 and the broader OmniTwin Foundry `/goal` remain active.

## Current continuation pointer · after ordinary point PLY Source Facts V6

This pointer supersedes the Calibration / Trajectory Source Facts V5 pointer.
SOG, SPZ, Gaussian PLY, media-container, calibration/trajectory and ordinary
point PLY structural slices are complete; do not repeat them.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Preserve raw sources read-only, immutable V1-V6
artifact meanings, same-open-handle exact size/SHA-256 binding, Gaussian-first
precedence, exact point success/failure registries, mandatory unknowns,
cancellation non-issuance, XBIN atomicity, internal issuance and authority-none
semantics. Cybersecurity, credentials, penetration testing, cloud deployment,
signing and publication remain out of scope for this local path.

V6 establishes only case-sensitive PLY 1.0 binary-little-endian header and
fixed-width payload layout for exactly one positive vertex element with unique
scalar declarations and names `x`/`y`/`z`. It decodes no values and establishes
no property semantics, bounds, completeness, units, scale, frame, CRS, axes,
geometry role, accuracy, registration, provenance, capture class, rights or
authority. The real positive is a derived COLMAP artifact and is not
authoritative captured or metric geometry. Exact evidence and final browser/
test qualifications are in
`docs/reports/ordinary-point-ply-source-facts-v6-evidence-2026-07-18.json`.

Do not widen V6 with XYZ or LAS/LAZ. A headerless XYZ profile may proceed only
after a complete bounded streaming row pass against an exact receipted source;
LAS/LAZ waits for a real local input. Any decoded-value or physical-bounds
inspection is also a distinct later profile. T-507/T-486 inputs remain
necessary only for authority claims. T-508 and the broader `/goal` remain
active.

## Current continuation pointer · after Reception captured-quality comparison V0

This pointer supersedes the ordinary point PLY Source Facts V6 pointer. Do not
repeat SOG, SPZ, Gaussian PLY, media-container, calibration/trajectory,
ordinary point PLY or the Reception captured-quality V0 slice.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. No cybersecurity, credential, penetration-testing,
cloud-deployment, signing or publication work is needed for this path.
Preserve raw sources read-only, immutable V1-V6 meanings, same-handle identity
where applicable, cancellation non-issuance, XBIN atomicity, internal issuance
and authority-none semantics.

T-529 added a strict captured-quality comparison contract, process adapter,
controller, loopback HTTP/CLI surface and responsive UI. The frozen real run
compares exact Quality SOG and Mobile SPZ profiles through six same-centre views
twice. It retained 24/24 manifest-matched PNGs, 12/12 byte-identical repeat
pairs, unchanged hashes for all eight sources, six review-only metric groups,
zero console errors and declared/observed external requests zero. Every verdict
is `review`; `winner` is `not_selected`. This proves no physical accuracy,
survey truth, source quality, equivalence, rights, isolation, release authority
or product acceptance. Exact evidence and qualifications are in
`docs/reports/reception-room-captured-quality-comparison-v0-evidence-2026-07-18.json`.

Next build a distinct bounded XGRIDS/Potree 2.0 bundle Source Facts V7 profile.
The next useful input is one known-good Reception export bundle containing
`metadata.json`, `hierarchy.bin` and `octree.bin`, plus real count/byte-range
mismatch negatives. Bind the three files as one bundle, freeze byte/count/range
equations and cancellation/identity limits, and keep structure separate from
decoded geometry, units, frame/CRS, physical bounds, accuracy, provenance,
rights, renderer fidelity and authority. T-507 independent surveyed controls
and T-486 rights/identity/release inputs remain prerequisites only for later
authority or publication claims. T-508 and the broader `/goal` remain active.

## Current continuation pointer · after XGRIDS/Potree v2 Source Facts V7

This pointer supersedes the Reception captured-quality comparison V0 pointer.
Do not repeat SOG, SPZ, Gaussian PLY, media-container,
calibration/trajectory, ordinary point PLY, captured-quality V0 or Potree V7.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, penetration testing,
cloud deployment, signing and publication remain out of scope. Preserve raw
sources read-only, immutable V1-V7 meanings, exact member/bundle identities,
same-stream hashing and parsing, bounded capture, sequential bundle inspection,
cancellation non-issuance, XBIN atomic blocked wrappers, path-specific
supersession, internal issuance and authority-none semantics.

T-530 added a frozen XGRIDS/Potree v2 three-member bundle profile. The exact
Reception replay establishes metadata declarations, 22-byte reachable
hierarchy structure and complete 14-byte-record octree layout only: 175,237
points, 93 logical nodes and 2,453,318 gapless bytes at bundle digest
`f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2`.
It decodes no values. Three compatibility observations and ten unknowns remain.
Four other primary room bundles have metadata/octet-length contradictions and
five have unreachable hierarchy bytes under the frozen traversal; no cause,
truncation, general corruption or vendor-viewer failure is established. Exact
evidence, browser QA and gate qualifications are in
`docs/reports/xgrids-potree-v2-source-facts-v7-evidence-2026-07-18.json`.

Next, build a distinct bounded V8 only if it materially advances the local
product. A strong candidate is finite/range-checked point-value decoding and a
private local preview for the exact established Reception bundle, with explicit
node/sample/memory/time/cancellation limits, exact bundle binding and repeated
same-camera evidence. Do not silently widen V7 or infer units, axis/frame/CRS,
physical bounds, completeness, accuracy, registration, provenance, capture
class, rights, viewer fidelity or authority from decoded numbers. Do not
acquire new data, compile an execution route, select a worker/provider or
authorize processing merely because an evidence request exists. T-507
independent surveyed controls and T-486 rights/identity/release inputs remain
prerequisites only for later authority or publication claims. T-508 and the
broader `/goal` remain active.

## Current continuation pointer · after XGRIDS/Potree v2 point-values V8

This pointer supersedes the XGRIDS/Potree v2 Source Facts V7 pointer. Do not
repeat SOG, SPZ, Gaussian PLY, media-container, calibration/trajectory,
ordinary point PLY, captured-quality V0, Potree V7 or point-values V8.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, penetration testing,
cloud deployment, signing and publication remain out of scope. Preserve raw
sources read-only; immutable V1-V8 bytes, meanings and digest domains; exact
member/bundle identities; bounded work; cancellation non-issuance at the
implemented phase guards; XBIN atomic blocked wrappers; internal issuance; and
authority-none semantics.

T-531 added the exact-bundle V8 point-value and private diagnostic-preview
layer. The unchanged Reception bundle at `f226739d…` decoded all 175,237 records
with no finite, declared-range or derived-node-bound violation. V8 records
component extrema/quantiles, intensity and opaque-byte distributions, and an
exact deep duplicate profile: 168,929 unique positions, 6,308 duplicate-
position record excess and maximum multiplicity 6,298. That produces one
concentration observation, not a corruption or cause claim. Twelve canonical
1024×1024 CPU PNGs over three planes and four modes repeated at exact pixel/PNG
identities. Facts/readiness/checklist SHA-256 values are `29da55f1…`,
`0106b768…` and `234e6dc2…`. One V7 unknown is resolved; nine remain.

The responsive workbench exercised every plane/mode and zoom/reset at desktop
and mobile sizes, with no page overflow or browser warning/error. It preserves
the V7 public surface. Exact evidence, screenshots, front-end fidelity ledger
and gate qualifications are in
`docs/reports/xgrids-potree-v2-point-values-v8-evidence-2026-07-18.json`.
Focused V8 gates are clean. Broader gates honestly retain unrelated shared
handoff-package failures and one repeatable generic 500-file OBJ state-poll
socket reset before Potree assertions; exact causal independence of that reset
is not claimed. Synchronous decode/compression checks cancellation only at
phase guards and does not promise same-thread mid-compression abort.

Next, choose a distinct bounded local-product slice that uses the frozen
evidence rather than reinterpreting it. A useful candidate is an operator
comparison/review flow across the exact V8 diagnostics and the existing SOG,
SPZ and captured-quality evidence. It must retain observation-only status,
avoid selecting a winner or authorizing processing, and keep units, frame/CRS,
physical bounds, completeness, accuracy, registration, vendor semantics,
provenance, rights, viewer fidelity and authority unresolved. Do not acquire
new data, compile an execution route, select a worker/provider or authorize
processing merely because an evidence request exists. T-507 surveyed controls
and T-486 rights/identity/release inputs remain prerequisites only for later
physical-authority or publication claims. T-508 and the broader `/goal` remain
active.

## Current continuation pointer · after Photo Capture Quality Workbench V0

This pointer supersedes the XGRIDS/Potree v2 point-values V8 pointer. Do not
repeat SOG, SPZ, Gaussian PLY, media-container, calibration/trajectory,
ordinary point PLY, captured-quality V0, Potree V7, point-values V8 or the Photo
Capture Quality Workbench V0 implementation.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, identity attestation,
penetration testing, signing, cloud deployment and publication remain out of
scope. Preserve raw sources read-only, immutable V1-V8 meanings, explicit truth
layers, XBIN atomic blocked wrappers, internal issuance and authority-none
semantics.

T-532 adds a separate receipt-bound JPEG/PNG capture-triage report and local
workbench. It preserves the existing 18-build/12-held-out Reception protocol,
re-verifies exact bytes, decodes pixels sequentially, applies frozen
resolution/exposure/clipping/edge-energy/colour and dHash heuristics, checks RAW
companions and possible split leakage, and serves digest-bound memory-only WebP
previews. Fresh request IDs, monotonic run revisions, persisted submitted roles
and fail-closed Stop settlement are regression-pinned. Full core and CLI suites
are green at 741 passed/1 skipped and 635 passed/1 todo with one skipped file;
package lint/typecheck/build and responsive Browser QA are clean.

The recorded four-photo run is a controlled repository fixture only. Its 2/2
split, 16/10 missing slots and four expected retake findings are not conclusions
about the real Reception capture. Exact evidence is in
`docs/reports/reception-room-photo-capture-quality-workbench-v0-evidence-2026-07-18.json`.

The next real input is an owned local folder containing the actual 18 build and
12 held-out JPEG/PNG photographs named by
`docs/reports/reception-room-30-photo-capture-checklist.md`, plus matching
untouched RAW files or one explicit capture-session note for each missing RAW
counterpart. Run the workbench locally, preserve held-out exclusion, and review
every untouched original before attempting a separate registration experiment.
Do not interpret a heuristic pass as calibration, registration, physical
accuracy, provenance, rights or release authority. T-508 and the broader
`/goal` remain active.

## Current continuation pointer · after Room Envelope Review V0

This pointer supersedes the Photo Capture Quality Workbench V0 pointer. Do not
repeat SOG, SPZ, Gaussian PLY, media-container, calibration/trajectory,
ordinary point PLY, captured-quality V0, Potree V7, point-values V8, Photo
Capture Quality Workbench V0 or Room Envelope Review V0 implementation.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, identity attestation,
penetration testing, signing, cloud deployment and publication remain out of
scope and are not blockers. Preserve source bytes read-only, frozen V1–V8
meanings and identities, bounded work, cancellation non-issuance, explicit
truth layers and `authority:none` semantics.

T-533 now provides a strict digest-bound operator envelope artifact, real-data
loopback workbench and separate fit-only Python consumer. The stored automated
proposal uses the full 1024×1024 frame, selects all 175,237 Reception records
and remains deliberately `needs_revision` / `not_eligible`. Its digest is
`1721c649…bc209`. The accepted-only Python gate rejects it before E57 access or
output. Full core/CLI suites are green at 754 passed/1 skipped and 680 passed;
both lint/typecheck gates pass; fit-only Python is 8/8. Exact evidence is in
`docs/reports/reception-room-envelope-review-workbench-v0-evidence-2026-07-19.json`.

The immediate next input is a 10–20 minute human review in the local screen:
inspect and mark all three exact previews, identify the proposed horizontal
plane, draw the actual Reception room-only envelope, enter the human reviewer
label and choose **Accept as fit seed** only if the outline is genuinely
correct. Do not substitute the automated full-frame proposal or have an agent
self-approve it. After an accepted eligible artifact exists, run the separate
fit-only consumer and review its authority-none candidate/refusal. Keep frozen
validation/test stations unread during that fit action. Purpose-scoped rights,
independent survey control and later locked validation remain separate gates
for authority or release claims. T-533, T-508 and the broader `/goal` remain
active.

## Current continuation pointer · after HD Stack Licence Evidence V1

This pointer supersedes the Room Envelope Review V0 pointer for choosing the
next engineering slice; it does not close or replace the pending T-533 human
room-envelope review. Do not repeat the earlier source-format, viewer,
capture-quality or room-envelope implementations.

Continue the active OmniTwin Foundry `/goal` as ordinary local reconstruction
and product engineering. Cybersecurity, credentials, identity attestation,
penetration testing, signing, cloud deployment and publication remain out of
scope and are not blockers. T-534 completed a purpose-scoped code, model,
dataset, format and service-terms screen in
`docs/reports/omnitwin-hd-stack-license-evidence-v1-2026-07-19.json`, with the
operator-readable outcome in
`docs/reports/omnitwin-hd-stack-license-evidence-v1-2026-07-19.md` and detailed
matrix in `docs/reports/omnitwin-foundry-technology-license-matrix.md`.

The exact integrated browser runtime is Three.js 0.180.0, React Three Fiber
8.18.0 and Spark 2.0.0; all three code packages are MIT candidates at those
pins. The preferred conditional local reconstruction path is pye57/libE57,
PDAL, Open3D, COLMAP's integrated global mapper, an allow-listed hloc lane and
gsplat, subject to an exact dependency/notice closure and independently cleared
source data. AI-derived enhancement must remain a visibly separate derivative
lane with its model, weights, inputs, settings and provenance recorded; it is
never raw, surveyed or as-captured truth.

Do not implement or distribute an independent raw XBIN, LCC or LCC2 decoder.
Use only official XGRIDS exports and public, documented downstream formats
unless written rights expressly permit the exact additional use. Keep
WorldMesh, Mip-Splatting, original 3DGS, ScaRF, released ArtiFixer/MeshCoder
stacks, CL-Splats, ReAct-GS, WildGaussians, Cross-Temporal 3DGS,
GaussianUpdate, NeuWorld and SimFoundry out of the commercial product dependency lane;
their technique-only or inspiration-only classifications do not grant code,
weight, dataset or asset rights. KTX-Software requires isolation; Basis
Universal core is the lower-friction texture candidate.

The next bounded product slice should make the preferred local worker closure
reproducible without installing packages or touching venue data: pin exact
pye57/libE57/Xerces, Open3D, COLMAP, hloc allow-list and gsplat versions,
digests, licences, notices and optional-weight exclusions in a local-only
manifest, then surface that readiness in the nontechnical workbench. Do not
reuse or build `infra/runpod/Dockerfile`: its older pye57/Open3D pins and
moving-main SPZ/DN-Splatter acquisitions make it an explicitly excluded legacy
cloud image until separately closed. Preserve
raw sources read-only and do not use cloud, credentials, spend, signing or
publication. Separately, T-533 still needs a human-drawn Reception room
envelope. Matterport account/order terms, venue permissions and exact XGRIDS
source rights remain external evidence gates for processing or shipping those
sources—not blockers to building the ordinary local shell and permissive core.
T-508 and the broader `/goal` remain active.

## Current continuation pointer · after Local HD Worker Manifest V0

This pointer supersedes the HD Stack Licence Evidence V1 pointer for choosing
the next engineering slice. It does not close or replace the pending T-533
human room-envelope review. Do not repeat the earlier format, viewer,
capture-quality, room-envelope, licence-screen or local-worker-manifest work.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and
reconstruction engineering. Cybersecurity, penetration testing, credentials,
identity attestation, signing, deployment and publication remain out of scope
and are not blockers.

T-535 now provides the strict checked-in
`configs/reconstruction/local-hd-worker-v0.manifest.json`, schema, generated
TypeScript payload, exact core validation and nontechnical loopback readiness
panel. Its canonical payload digest is `fbfd7c6c…f436`. The state is deliberately
`planned_not_installed_not_execution_ready`; every one of the eight root
dependency/notice closures remains open. The release graph requires the
generated payload, the browser requires exact identities and disabled states,
and there is no worker/install/execution route or control.

Preserve the exact disjoint lanes. pye57/libE57/Xerces, Open3D and
COLMAP/weight-free hloc are local Windows candidates only. gsplat and PPISP are
separate reviewed GPU-worker-only lanes; D-016 still disables local Windows
Gaussian training. PDAL 2.10.2 remains explicitly deferred. Do not build or run
`infra/runpod/Dockerfile`, decode raw XBIN/LCC/LCC2, auto-download learned hloc
assets, or let an AI derivative replace captured or metric truth.

The next bounded product step is exact dependency and notice closure, starting
with the local E57 lane: pin the CPython 3.10 Windows x64 interpreter, NumPy,
pyquaternion and the complete libE57/CRC++/Xerces build/runtime/legal bundle.
Keep Open3D and COLMAP/hloc closures independent, and define the
RunPod-canonical gsplat/PPISP GPU-worker image separately. Do not install or
execute from the planning manifest; only a later immutable reviewed bundle may
change readiness state.

Separately, T-533 still needs Blake to inspect all three Reception projections,
draw the actual room-only envelope, enter the reviewer label and choose
**Accept as fit seed** only if the outline is genuinely correct. T-508, T-486
and the broader `/goal` remain active. Exact T-535 evidence is in
`docs/reports/omnitwin-local-hd-worker-manifest-v0-evidence-2026-07-19.json`.

## T-536 · Exact Local E57 Intake Environment V0

T-536 supersedes only T-535's historical CPython 3.10 E57 candidate. It does
not rewrite T-535, unify Open3D into the E57 environment or make any worker
ready to execute.

- Canonical child:
  `configs/reconstruction/local-e57-intake-environment-v0.manifest.json`,
  digest `34ad3f54ea5a5afcca908c66f48ab039381d6910b2372afbafee0c1f8545ea1e`.
  It binds T-535 digest
  `fbfd7c6c51c8be06f9bb411f4833fbf0fd0daba45d09512ed70bf63420b9f436`.
- E57-only target: official CPython 3.13.14 Windows x64 embeddable archive,
  pye57 0.4.19 cp313, NumPy 2.5.1 cp313 and pyquaternion 0.9.9. Open3D 0.19
  remains a separate compatibility lane.
- Exact closure recorded: four artifact receipts, all 13 ordered pye57 wheel
  receipts, four native-lineage records, 29 legal receipts and three runtime
  dependency edges. Independent inventory digests and cross-links reject drift
  in ordinary members, metadata, native binaries or legal materials.
- Honest compatibility evidence: an isolated temporary archive extraction ran
  imports, a quaternion assertion and a synthetic three-point E57 write/read
  smoke. No package installer or system install was used, and no user/venue
  source was read. The 4,096-byte cp313 fixture hashes to `91f2b9a0…db31`.
  The smoke resolved `MSVCP140.dll` from the host, was not a future bundle test
  and retained no repository log.
- Still open: exact Microsoft C++ runtime disposition, exact pybind11 build
  version/notice, assembled redistribution pack, complete extracted-member
  allow-list, clean-host bundle smoke and adapter binding. The bundle is not
  materialized, execution is disabled and authority is none.
- The generated source carries the full reviewed document and the generator
  recomputes its digest. Readiness verifies that reviewed digest, the server
  binds child to parent before DTO construction, and the Windows release graph
  requires a positive generated-source byte contribution.
- The existing loopback workbench renders four artifacts and six open gates
  under “Exact artifacts recorded — application bundle still open,” adds no
  install/run control and labels the parent CPython 3.10 lane historical.
  Final desktop/mobile Playwright QA found no overflow and zero console
  warning/error; the listener closed.
- Final gates: focused 6/6 core and 95/95 tool; full 774 passed/1 intentional
  skip core and 753/753 tool; both typechecks, both lints and core build pass.
  The tool build retains its pre-existing cross-package `rootDir`/TS6307
  packaging failure and no T-536-specific diagnostic.

Evidence:
`docs/reports/omnitwin-local-e57-intake-environment-v0-evidence-2026-07-19.json`.

## Current continuation pointer · after Exact Local E57 Intake Environment V0

This pointer supersedes the Local HD Worker Manifest V0 pointer for choosing
the next engineering slice. It does not close or replace the pending T-533
human room-envelope review.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and
reconstruction engineering. Cybersecurity, penetration testing, credentials,
identity attestation, signing, deployment and publication remain out of scope
and are not blockers.

Do not return to CPython 3.10 for the canonical E57 lane and do not force
Open3D into CPython 3.13. The E57-only contract is the exact T-536 child above;
the T-535 CPython 3.10 card is historical lineage, while Open3D remains a
separate lane. Do not install from or execute the planning manifest, and do not
wire the adapter to marker files as though a verified bundle existed.

The next bounded E57 product step is closure of the six explicit gates. Select
one exact Microsoft-publisher C++ runtime prerequisite or redistributable
artifact and record its terms and hash; resolve or explicitly retain the
pybind11 source-to-binary/notice limitation; assemble one deterministic
application-local CPython 3.13 E57 directory and legal pack with a complete
regular-file allow-list; prove it with the recorded synthetic fixture on a
clean supported Windows environment; and only then bind that immutable bundle
receipt into the existing aggregate-only read adapter. The clean-host test must
prove native loads do not silently fall back to undeclared host libraries. It
must not use Reception, Matterport, XGRIDS or any other venue source.

Preserve the aggregate-only product contract: no point-record reads, embedded
image reads or write mode during ordinary intake. Keep raw XBIN/LCC/LCC2
decoding excluded, AI derivatives separate from captured/metric truth, and
cloud/provider work outside this local closure. Separately, Blake still needs
to complete the T-533 human Reception envelope review. T-508, T-486 and the
broader `/goal` remain active.

## T-539 · Deterministic Local E57 Runtime Bundle V0

T-539 completes only the deterministic candidate-bundle, legal-pack and
fail-closed adapter-contract slice. It does not establish clean-host execution
readiness or enable the production adapter.

- The checked-in candidate receipt is
  `configs/reconstruction/local-e57-runtime-bundle-v0.receipt.json`. Its
  canonical bundle digest is
  `9d93928658fb650a319edf1b65bad250b8fa213d810e3554d5e345b42a974696`
  and it binds T-536 digest
  `34ad3f54ea5a5afcca908c66f48ab039381d6910b2372afbafee0c1f8545ea1e`.
- Two isolated temporary materializations produced byte-identical canonical
  receipts: 1,032 regular files / 66,757,784 bytes. The complete tree includes
  the exact CPython 3.13.14 E57 runtime closure, probe and 30 legal items: all
  29 T-536 parent materials plus the exact pybind11 licence.
- Verification rejects missing or extra files, case-fold collisions, symlinks,
  junction aliases, hardlinks, path escapes and pre/post tree mutation. The
  candidate bundle was not installed into the application or system.
- The bundle directory is published by atomic rename, but its sibling receipt
  sidecar is a separate filesystem entry. A normal sidecar-write failure rolls
  back only the unchanged, fully verified new bundle; a process or host crash
  between the two publications remains recoverable rather than transactional.
- The builder requires the exact reviewed 77,513-byte phase-one probe at
  digest `39634213…697c`. The production adapter can invoke only
  `inspect-e57-aggregate`; the probe file's dormant COLMAP/alignment modes mean
  this is an aggregate-E57 adapter bundle, not an E57-only code closure.
- The selected Microsoft prerequisite is the central x64 Visual C++ v14
  Redistributable package `Microsoft.VisualCpp.Redist.14.Latest` version
  `14.51.36247`, with exact artifact hash
  `843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c`.
  The selected installer and canonical `MSVCP140.dll` were not downloaded,
  bundled or installed. Official CPython `VCRUNTIME140` files and NumPy's
  renamed receipt-listed MSVCP copy remain explicit bundle members. Direct
  Microsoft acquisition during reviewed clean-host setup is the
  lower-assumption path.
- The exact pybind11 licence is included and digest-bound. Binary markers
  strongly support pybind11 3.0.1, but no publisher build attestation exists;
  retain `inferred_3.0.1_not_attested` unless new publisher evidence appears.
- Qualification and adapter-binding receipts cross-bind the T-536 environment,
  candidate bundle and clean-host observation. Qualification requires a
  disposable supported Windows host, pre-install failure, exact Microsoft
  installer/signature/registry evidence and complete loaded-module inventory.
- The ordinary E57 adapter remains aggregate-only: no point-record reads,
  embedded-image reads or write mode. Its production binding is deliberately
  `null`; without a real qualification receipt it returns
  `RUNTIME_BUNDLE_UNBOUND` before spawning a process.
- The nontechnical workbench reports candidate readiness only and retains
  exactly three gates: `central-runtime-setup-review`,
  `clean-host-qualification` and `production-adapter-binding`.

No Microsoft/runtime installer, system install, user/venue source, cloud,
credential, spend, signing or publication was used. The exact `fflate`
workspace dependency was resolved from the existing offline package store.
Evidence:
`docs/reports/omnitwin-local-e57-runtime-bundle-v0-evidence-2026-07-22.json`.

## Current continuation pointer · after Deterministic Local E57 Runtime Bundle V0

This pointer supersedes the Exact Local E57 Intake Environment V0 pointer for
choosing the next engineering slice. It does not close the pending T-533 human
room-envelope review, T-508, T-486 or the broader `/goal`.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and
reconstruction engineering. Cybersecurity, penetration testing, credentials,
identity attestation, signing, cloud deployment and publication remain out of
scope and are not blockers.

Do not rebuild the deterministic candidate bundle unless an exact reviewed
input changes. Do not weaken the complete-tree verifier, substitute loose marker
files or fill the production adapter binding from synthetic contract fixtures.
The checked-in receipt records a reproducible candidate, not clean-host proof.

The next bounded E57 step is a disposable supported-Windows clean-host
qualification. First review the central-runtime setup/distribution disposition,
then acquire the exact Microsoft artifact directly from Microsoft, verify its
hash and publisher signature, install it centrally on that disposable host and
run only the recorded synthetic E57 fixture. Record the pre-install refusal,
central registry version and complete loaded-module inventory, proving
`MSVCP140.dll` and every native dependency resolve only from declared runtime
or central-prerequisite locations rather than undeclared host fallbacks. Do not
bundle the Microsoft installer and do not use Reception, Matterport, XGRIDS or
any other venue source.

Only after that real qualification receipt exists may the cross-bound adapter
binding be issued and the production `null` binding replaced. Preserve the
aggregate-only contract: no point-record reads, embedded-image reads or write
mode. Keep raw XBIN/LCC/LCC2 decoding excluded and AI derivatives separate from
captured or metric truth. The pybind11 build provenance limitation remains
`inferred_3.0.1_not_attested` unless publisher evidence closes it. T-533,
T-508, T-486 and the broader `/goal` remain active.

## T-540 · Prepared HD Dataset Gate V0

T-540 completes only the local prepared-input validation slice. It does not
register photos, reconstruct a room, train or enhance a model, enable a worker
or establish that any real venue package is ready for release.

- The selected package root must contain only `dataset/` and `depths/`. The
  fixed contract requires depth priors, factor 2 reduced images and test-every-8
  filename splitting. Browser requests cannot change those inputs or options.
- `venviewer_training/colmap_contract_cli.py` wraps the existing dependency-light
  COLMAP parser with one deterministic bounded JSON line. Its only input is the
  already-selected package root; it derives both child directories and writes
  no files.
- `packages/reconstruction-foundry/src/prepared-hd-dataset-readiness.ts`
  compiles and verifies the canonical authority-none receipt. The success
  result is exactly
  `prepared_dataset_validated_runtime_and_training_disabled`.
- Every prepared member must now equal one intake member by relative path,
  byte size and SHA-256. This one-to-one rule was added after independent review
  caught that the first compiler draft did not cross-link the two file sets.
- `tools/reconstruction-foundry/src/local-prepared-hd-dataset.ts` re-reads the
  source and the fixed parser, CLI, Config-B and gsplat source-lock files before
  and after the bounded Python process. Cancellation, timeout, output caps,
  process failure, mutation and stale-request behavior all discard the report.
- The ordinary local-app CLI resolves one Python interpreter once to a
  canonical absolute local path. Its small child environment keeps APPDATA on
  Windows and HOME on POSIX so the selected interpreter can see an
  already-installed user-site NumPy; the browser has no interpreter or path
  switch.
- The workbench exposes strict start, status, cancel and digest-bound report
  download routes. Its completed copy explicitly says that photo registration,
  reconstruction, training and enhancement were not performed.
- A generated 12-file Config-B package completed through the real browser path.
  Source receipt `e8e56e6a…aacdf` stayed unchanged; canonical readiness receipt
  `2a8ef68e…c2cc7` re-verified after download. The UI rendered 2 cameras, 3
  registered images, 3 runtime images, 2 training images, 1 held-out image, 2
  sparse points and 2 depth priors at 1440×1000 and 390×844, with zero console
  warnings/errors. The listener was closed after QA.
- Final gates: core 792 passed/1 intentional skip with typecheck/build/lint
  green; T-540-focused tools 64/64 with typecheck/lint green; Python 55/55.
  The shared dirty worktree still has two broader qualifications: an unrelated
  untracked `captured-quality-comparison.d.ts` blocks the Windows release-build
  fixture (820/821 tests otherwise), and the existing tools cross-package build
  emits 9 TS6059 plus 9 TS6307 diagnostics. None of those diagnostic lines
  names the new readiness source.

No user or venue package, registration, reconstruction, training, enhancement,
worker activation, network provider, credential, spend, signing or publication
was used. Exact evidence is in
`docs/reports/omnitwin-prepared-hd-dataset-gate-v0-evidence-2026-07-22.json`.

## Current continuation pointer · after Prepared HD Dataset Gate V0

This pointer supersedes the T-539 pointer only for choosing the next local
product slice. It does not erase or satisfy T-539's external clean-host E57
qualification, T-533's human room-envelope review, T-508, T-486 or the broader
`/goal`.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and 3D
reconstruction engineering. Cybersecurity work, identity attestation, signing,
deployment and publication are outside this local product lane and are not
dependencies for the next slice.

The recommended next local slice is **Durable Local Intake Workspace V0**:
make an operator-selected intake and its exact receipts survive the temporary
loopback session in an app-owned local workspace, while keeping the original
source read-only and preserving the existing captured/enhanced/generated truth
labels. The workspace must use explicit user-selected import/copy actions,
re-verify bytes before and after transfer, resume without silently approving
rights or reconstruction, and expose plain-language storage and deletion
controls. Do not add worker dispatch, cloud upload, reconstruction, training or
enhancement to that persistence slice.

In parallel, Blake still needs to inspect and decide T-533's real Reception
room envelope. Grand Hall T-486 gates and the E57 clean-host qualification need
their real external evidence before those paths can advance. When an approved
real prepared `dataset/` + `depths/` package exists, run it through T-540 and
record a separate receipt; do not generalize this synthetic proof into a venue
quality or physical-accuracy claim.

## T-541 · Durable Local Intake Workspace V0

T-541 completes only the durable local-copy, restart and explicit-deletion
slice. It does not add native drag-and-drop selection, reconstruction, model
training, enhancement, worker execution or cloud dispatch.

- A canonical workspace intent binds the exact universal intake receipt and,
  when present, an exact receipt-derived guided admission draft. Without that
  draft every member remains pending; admitted and excluded members retain
  their original captured, enhanced-captured, generated-cinematic or
  concept/imagination provenance without promotion.
- Copy starts only from the explicit `copy_into_local_workspace` browser action.
  The browser supplies no path. The process owns one canonical source root and
  one canonical, initially absent or resumable workspace directory.
- Every receipt file is copied, including zero-byte and duplicate-content
  members. Source mtimes are preserved; the copied active source must reproduce
  the original receipt exactly. Final verification hashes the complete tree and
  rejects missing, extra, symlinked or hardlinked members.
- Interrupted work resumes only at completed-file boundaries. A partially
  copied large file starts again; V0 does not claim byte-range resume.
- The workspace persists canonical intent, intake receipt, optional admission
  evidence, payload and final authority-none index. A completed workspace can
  be closed and reopened from `--workspace` alone; only a process-local return
  value exposes the copied source path.
- The workbench reports exact file/byte progress, seven truth counters, the
  workspace digest and the canonical record. Delete requires the current
  receipt and workspace digests, the exact `delete_local_workspace_copy`
  confirmation and a separate visible checkbox.
- Deletion renames the workspace before recursive removal. An ordinary removal
  failure restores and identity-checks the original workspace path. Process
  crash or power loss during the renamed tombstone phase remains unverified,
  and secure erasure is explicitly not claimed.
- Real local QA used a generated three-file, 29-byte source including a
  zero-byte file. The copied hashes matched, the first session stopped without
  deleting, the second reopened from the workspace alone at digest
  `77aa0e0571078b52cd70ed68772909757e6d3a8aa7afc1008df8503fcdfde4f6`,
  the path-free report returned correctly, and delete-and-stop removed only the
  workspace while every source hash remained unchanged.
- Desktop and 390×844 mobile Browser QA found no horizontal overflow and zero
  console warnings/errors. The browser automation did not expose the blob
  download event, so OS Downloads-folder persistence was not claimed; the real
  authenticated report endpoint returned the exact attachment and parsed
  canonical index.
- Final gates: core 797 passed/1 intentional skip with typecheck, build and lint
  green; T-541-focused tools 79/79 with typecheck and lint green. The shared
  dirty worktree's unrelated untracked `captured-quality-comparison.d.ts`
  leaves the Windows release fixture at 880/881. The known tools cross-package
  build emits 9 TS6059 plus 9 TS6307 diagnostics and names the new workspace
  source in zero diagnostic lines.

No real venue source, reconstruction, training, enhancement, worker, cloud,
credential, spend, signing, publication or cybersecurity work was used. Exact
evidence is in
`docs/reports/omnitwin-durable-local-intake-workspace-v0-evidence-2026-07-22.json`.

## Current continuation pointer · after Durable Local Intake Workspace V0

This pointer supersedes the T-540 pointer only for choosing the next local
product slice. It does not erase or satisfy T-533's human room-envelope review,
T-508, T-486, the E57 clean-host qualification or the broader `/goal`.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and 3D
reconstruction engineering. Cybersecurity, identity attestation, signing,
deployment and publication remain outside this local product lane and are not
dependencies for the next slice.

The recommended next bounded slice is **T-542 Native Drag-and-Drop Intake
Launcher V0**. Reuse the existing trusted Windows native source helper and
basket so a nontechnical operator can pick or drop multiple E57, OBJ, GLB,
supported splat, photograph and video sources and select a durable workspace
without typing CLI paths. Browser messages must remain path-free; source and
workspace paths stay process-owned. Inspect every selected item read-only,
show a plain-language multi-source basket, and attach each confirmed item to
the T-541 persistence contract without silently admitting rights or promoting
truth.

Keep T-542 deliberately narrow: selection, receipt inspection, basket review
and durable local import only. Do not add reconstruction, registration,
training, enhancement, worker dispatch or cloud upload yet. Those later stages
need their own explicit job graph, resource estimates, cancellation/retry and
truth-separation slices. In parallel, Blake still needs to complete T-533's
real Reception envelope review; Grand Hall T-486 and the E57 clean-host lane
still require their external evidence.

## T-542A - Windows Picker / Node Path-Reopen Preview V0

T-542A completes the bounded native-picker, multi-source basket and durable
path-reopen preview. Parent T-542 remains in progress because this is not a
genuine Windows OS drag-and-drop target.

- The Windows Common Item Dialog selects multiple files, one folder at a time
  and an output folder. The browser cannot submit paths, filenames, helper
  configuration or filters. Canonical paths stay inside the Node/helper
  process boundary.
- Node.js reopens selected paths after the picker returns. This is explicitly
  `ordinary_windows_picker_node_path_reopen_preview`; it does not claim that
  native source or output handles retain or transfer byte custody.
- Each selected root is inspected independently and attached to one T-541
  child workspace. A durable top-level collection index records terminal
  children, and the reopen verifier verifies every stored child. Truth classes
  remain pending and are never promoted by copying.
- Remove and Clear are absent by design because retained-helper lifecycle
  reconciliation for those mutations is not implemented. Restart the local
  session to change the list.
- Loopback view, action result and report records are path-free and use only
  neutral File/Folder labels. The public report contains no path, SHA-256 or
  digest fields. Picker cancellation, rejected selections, unavailable/failed
  helpers, partial copy failure, all-failed, collection-index failure and
  cancellation have distinct terminal copy. Ready is shown only when the
  report confirms a durable collection index and at least one stored child.
- Stop uses one idempotent promise that closes the controller/helper before
  closing the HTTP listener. Concurrent stop requests share that attempt; a
  failed helper close returns a truthful 503 and remains retryable.

The real local observation used generated non-venue inputs only:

- `File 1`: 89-byte OBJ, source/copied SHA-256
  `34157ec24f714142f180b7069f12611dea597b1b6172734078d543a3c311a50b`,
  child workspace SHA-256
  `0c1fe98982008077969727a9d0026a725af2c4472734d757a46b38ee20f6b074`.
- `File 2`: 154-byte PLY, source/copied SHA-256
  `35675f3e55b57d4ca71b1357043327bc9432545ae33af46a53f59b131567d4ae`,
  child workspace SHA-256
  `e161d88badf287e64e0bfba9d526e4dd8779cf078482d7d82038b8dea78fe129`.
- `Folder 3`: one nested 85-byte text file, source/copied SHA-256
  `ae1fcdfee0df66cf92661ae8867878bf04f68991a6297ab29137b2e90e6d8743`,
  child workspace SHA-256
  `80644cb06557f205d2df811cf0b98c77980908ef9b5651c168192d75ce7d4c47`.
- Totals were 3 roots / 3 files / 328 bytes. All three stored. The durable
  collection index SHA-256 is
  `d8c95b5fbd12d6e0a5ef90cde02f90ed3a5d48b13dff016fc803e2112fda0cd3`,
  and reopen verification returned `storedChildrenVerified=3`.

Browser QA completed the picker-to-report flow. Desktop client/scroll width was
1265/1265. A 390x844 mobile override reported 375/375, three neutral rows and
visible success/report controls. Console warnings/errors were zero; final
listeners and helper processes were zero.

A native folder-root bug was found and fixed. Helper Rust is 121/121;
TypeScript protocol/bridge/adapter/intake is 112/112. The rebuilt debug helper
is 2,275,840 bytes at SHA-256
`3bdd27002c73475c2e31a1f81ed47256beb7e65c969fdc31c2892b88fb7ea856`.
Final focused tools are 47/47 with typecheck, targeted lint and diff check
green. Full tools are 57 files passed/1 failed and 928 tests passed/1 failed;
the sole failure is the pre-existing unrelated untracked
`captured-quality-comparison.d.ts` release fixture. The tools build still has
9 TS6059 plus 9 TS6307 diagnostics, none naming T-542. Core is 68 files, 797
passed/1 skipped, with typecheck/build green; its two lint parser errors are
unrelated generated declarations.

No user/venue source, reconstruction, registration, training, enhancement,
cloud, credential, spend, signing, publishing, deployment or cybersecurity
work occurred. Exact evidence is in
`docs/reports/omnitwin-windows-picker-path-reopen-preview-v0-evidence-2026-07-22.json`.

## Current continuation pointer - after Windows Picker / Node Path-Reopen Preview V0

This pointer supersedes the T-541 pointer only for choosing the next bounded
local product slice. It does not close T-542, T-533, T-508, T-486, T-539 or the
broader `/goal`.

Continue with **T-542B Genuine Windows OS Drop Target V0**. Build a real
process-owned Windows drop target and feed its selected roots into the existing
local-native-intake basket. Reuse the same neutral path-free browser, Node
path-reopen truth boundary, one-T-541-child-per-root persistence and durable
top-level collection index. Do not silently relabel the current Common Item
Dialog as drag-and-drop, and do not claim retained-handle byte custody unless a
later implementation and evidence genuinely establish it.

Keep T-542B narrow: OS drop selection, basket attachment, exact local intake,
cancellation, restart and terminal report only. Do not add reconstruction,
registration, model training, enhancement, cloud dispatch, credentials or
cybersecurity work. T-533 still needs Blake's human Reception room-envelope
decision; T-486 still needs Grand Hall external evidence; T-539 clean-host
qualification/production binding and T-508 remain active independently.

## T-542B - Windows Explorer Drop / Node Path-Reopen Preview V0 — implemented, real gesture pending

T-542B now has a genuine helper-owned Windows OLE drop-target implementation,
but it and parent T-542 remain in progress because the final real Explorer
gesture has not yet been observed end to end.

- Helper build `venviewer-windows-source-helper/0.2.0` creates a dedicated OLE
  STA, a visible topmost panel and a Windows message loop. `RegisterDragDrop`
  covers both the top-level panel and its instruction child; cleanup calls
  `RevokeDragDrop` before destroying the windows.
- The drop surface accepts `CF_HDROP` / `TYMED_HGLOBAL` with Copy only and
  returns None for invalid or Move-only offers. One `drop_sources` request
  carries a mixed file/folder gesture and returns `drop_sources_ok` with
  `windows_native_drop_cfhdrop_then_handle_open` evidence.
- Candidate roots are opened and validated before the helper commits the native
  command. The browser-visible basket appends nothing until the full returned
  batch passes its limits and conflict checks. If the basket rejects after the
  helper selected the batch, the controller terminally closes the helper; do
  not describe this as helper rollback followed by continued session use.
- Escape or the panel close button returns a distinct cancellation with no
  selections. The observed Escape path closed the panel, kept the neutral
  browser list unchanged and made no copy claim.
- The browser only requests that the separate native panel open. It has no
  HTML5 drag/drop listeners, `DataTransfer` path or file input, and it receives
  no dropped file object or filesystem path. The response boundary enforces an
  exact public-field allowlist, exact schema-version allowlist, generated
  `File N`/`Folder N` labels and rejection of basename, relative and absolute
  locator strings. Node still reopens selected paths;
  the truthful mode is
  `ordinary_windows_native_selection_node_path_reopen_preview` with filesystem
  model `node_path_reopen_after_native_selection`. Retained-handle native byte
  custody is not claimed.
- The integrated persistence contract remains one T-541 child per accepted
  root plus one durable collection index whose reopen verifier checks every
  stored child. Truth remains pending review and authority remains none. This
  persistence path is implemented but has not yet been verified through the
  real Explorer gesture.
- Browser/programmatic stop shares one retryable close attempt and closes the
  controller/helper before the HTTP listener. Expired sessions stop accepting
  ordinary actions and retry an unconfirmed close with bounded exponential
  delay. CLI `SIGINT` and `SIGTERM` use the same confirmed app stop, remember a
  signal received during startup and retain retry behavior after an
  unconfirmed close.
- The final lifecycle/privacy integration gate is 46/46, with typecheck,
  focused lint and diff check green. `SIGINT`/`SIGTERM` behavior was verified
  through deterministic injected signals and deferred shutdown. A real isolated
  Windows console/ConPTY signal-delivery smoke was not run.
- Final integrated gates are T-542-focused 9 files / 210 tests passed. Full
  tools are 57 files passed / 1 failed and 949/950 tests; the only failure is
  the pre-existing unrelated untracked `captured-quality-comparison.d.ts`
  release-fixture sibling. Core is 68 files, 799 passed / 1 skipped, with
  typecheck and build green. Core lint remains qualified only by the two known
  generated-declaration project-service errors.
- Native gates are final: 136/136 all-target tests, `cargo fmt --check`,
  all-target Clippy with `-D warnings` and the optimized release build passed.
  The 778,752-byte release helper has SHA-256
  `6d82ceb864e69b6d8d29ffef1dc1fa038a92ae484f3cccabcb19c8464129d9c0`
  and contains no debug `omnitwin_drop_trace` marker.

The prepared generated non-venue fixture is 3 roots / 3 files / 187 bytes:

- 40-byte OBJ,
  `d88a99dac830a352977233bf34afa40802fc4a03f5bfa11f5bc594ad61a72ae0`;
- 106-byte PLY,
  `bfb923d2c48bd8c8103813a66b52b03c582a609cab6e986db4c794891ec99f24`;
- one folder containing a 41-byte OBJ,
  `6c30a33159b1c343006812c671666486c9236fd045a2adf6aca1db8829aec28c`.

The fixture hashes were rechecked and its output parent still has only the
preparation marker. Calibrated Computer Use pointer drags produced zero OLE
telemetry because that automation did not initiate or reach Explorer OLE. This
does not establish either helper success or helper failure. One human Explorer
gesture remains mandatory.

Do not update `docs/state/tasks.md` to done yet. The qualified evidence record is
`docs/reports/omnitwin-windows-explorer-drop-path-reopen-preview-v0-evidence-2026-07-22.json`.

## Current continuation pointer - after T-542B implementation, before real Explorer proof

This pointer supersedes the T-542A pointer only for choosing the next action. It
does not close T-542B, T-542, T-533, T-508, T-486, T-539 or the broader
`/goal`.

Continue the active OmniTwin Foundry `/goal` as ordinary local product and 3D
reconstruction engineering. Cybersecurity, identity attestation, signing,
deployment and publication remain outside this local lane and are not blockers.

The immediate next action is one real mixed Explorer drag of the prepared two
files and one folder into the separate Windows panel. Then choose the prepared
output parent and complete the local copy. Before changing any task status,
verify 3 neutral roots / 3 files / 187 bytes, exact copied hashes, one T-541
child per root, a durable collection index that reopens with three verified
children, unchanged originals, path-free browser output, zero console
warnings/errors, no horizontal overflow and zero listener/helper processes
after Stop. The integrated code gates are recorded above; the physical gesture
and its resulting local evidence remain the completion boundary.

Keep the slice narrow. Do not add reconstruction, registration, training,
enhancement, worker dispatch or cloud upload. T-533 still needs Blake's human
Reception envelope decision; T-486 and T-539 still need their independent real
external evidence; T-508 and the broader `/goal` remain active.

## Grand Hall ordinary provenance templates — ready for user completion

Three exact blank JSON templates and one concise guide now turn the remaining
Grand Hall external-record requests into ordinary user-completable artifacts:

- source-processing rights:
  `docs/operations/grand-hall-source-processing-rights-intake-template-v0.json`;
- venue reviewer identity/authority plus release-scope choice:
  `docs/operations/grand-hall-venue-review-and-release-scope-intake-template-v0.json`;
- independent survey acquisition with 8 fit controls and 6 blind checks:
  `docs/operations/grand-hall-independent-survey-control-intake-template-v0.json`;
- completion guide:
  `docs/operations/grand-hall-ordinary-provenance-intake-guide-2026-07-22.md`.

Every template is `blank_user_completion_required`, authority none and
unsigned. All 21 guardrails are false, no source decision or venue review is
pre-filled, and the six blind checks are fixed outside the fit. The venue
template binds the existing decade-30 pack only as context and explicitly does
not treat it as release approval.

Mechanical validation passed: all 3 JSON files parse; source-record count is 3;
survey counts are exactly 8 fit / 6 blind with 14 unique slots; all neutral-state
and role invariants pass. T-486 r2 remains untouched and reverified at 22 files
with all 21 indexed member hashes/sizes matching; its manifest SHA-256 remains
`3fba49c89207b6b78fbba067436c6a2a993efada113c9c0267cb625ea06203fd`.

Next, ask Blake to make dated copies and complete the applicable rights,
venue-review/scope and survey records with every cited supporting file. Do not
edit the templates or r2. After the completed copies arrive, validate their
exact files and only then prepare a separately named unsigned preflight. No
T-486 review input, approval or publication request exists yet.

### Independent-review hardening (2026-07-22)

The four intake-pack artifacts now close the evidence-shape gaps found in an
independent review. Rights decisions are unambiguously split by source family
across local processing, derivative creation and use, public display, public
twin publication, original and derived redistribution, cloud processing and
model training. The venue template binds the exact frozen 149-node inventory
and requires the bounded included/excluded lists to be a disjoint, exhaustive
partition before `allReleaseNodesPartitioned` may become true.

Each survey slot now binds a source-side observation to an
independent-survey observation using explicit frame IDs, paired coordinates,
both observation references/digests and deterministic point-pair evidence. Its
pre-fit plan has blank identity/digest/time completion fields, exact fixed slot
lists and blank method/policy fields; separate sections record independence,
same-lineage exclusions and the sealed blind-bundle custody/release order.

All completion facts remain blank, all 3 templates retain authority none and
`unsigned: true`, and all 21 guardrails are immutable false. The guide
enumerates the only mutable booleans: whole-scope classification,
bounded-scope classification and exact bounded partition completion. The 14
survey `usedForFit` values remain fixed by role.

Mechanical validation passed for JSON parsing, neutral state, 3 source
families with all 10 required separate rights fields, the frozen 149-node
inventory contract, 3 exact mutable-booleans paths, 8 fit + 6 blind unique
paired slots, pre-fit slot identity, independence/custody sections and all 21
fixed-false guardrails. The pack files contain no out-of-scope terminology.
The decade-30 context digest is unchanged at
`12a54cfbe587270105f44cfbdc0582d855b8d9b270e231e3ebf1f5d860798e7e`.
T-486 r2 remains untouched and reverified at 22 files / 21 exact indexed
members, manifest SHA-256
`3fba49c89207b6b78fbba067436c6a2a993efada113c9c0267cb625ea06203fd`
and package digest
`d2411e3f5a0ab3206c1dc174c71005130e5cd26df6369ddd2ec6e10b5eb9a85b`.

## T-507/T-486 — July-19 diagnostic scope correction (2026-07-22)

The July-19 diagnostic runner has been corrected locally. It now fails closed
onto exact sweeps 0–48, excludes adjacent-space sweep 49 before partitioning and
uses the frozen T-507 holdout `[5, 15, 25, 35, 44]`. The regenerated report is
50 discovered / 49 bounded / 44 fit / 5 held out. Its proposed target is
`e57-global-diagnostic`, explicitly a same-lineage E57 scan-pose diagnostic with
no survey or release authority; `venue-control` is no longer claimed by this
generated edge.

The full E57 and COLMAP inputs matched their pinned July-19 hashes before only
the residual report and proposed transform were regenerated. Their new SHA-256
receipts are `54d670f2bb0799591e6ad4722612ba42a42127ebdb5f03cf9d93b311ecc4a779`
and `e07d2fba336502395900c2a953732e226346f52347a221cf829c1bdd1ac86075`.
Focused regression tests are 7/7; focused lint, semantic/diff checks and the
direct strict TypeScript check pass; deterministic rerun reproduced the same
output receipts. The
package-wide typecheck remains qualified only by unrelated shared dirty-worktree
errors beginning in the untracked `local-native-collection-analysis.test.ts`;
do not alter that work as part of this correction.

The original T-507 tree remains byte-exact at 13 files / 2,888,304 bytes /
inventory SHA-256
`9ec3584eccb692279966f8de184eadb16519f97cf5b581ecb38d4af587f5fbcf`.
T-486 r2 remains byte-exact at 22 files / 4,727,280 bytes / inventory SHA-256
`349f8b9fb7cfe07d012210914f7cad350015a3eedca3cbc6245c26342333595b`.
Keep both frozen. T-486 stays offline and in progress; independent survey,
rights and release review remain the real external continuation inputs.

## T-544 · Durable Collection → Foundry Workbench Bridge V0 — bounded slice complete

T-544 closes the dead-end between a durably indexed T-542 collection and the
existing local V8 inspection components without broadening authority.

- `LocalNativeIntakeControllerV0.getCollectionAnalysisInputV0()` returns the
  process-owned collection root and exact index digest only after index commit.
  The value is not part of any browser DTO.
- `openLocalNativeIntakeCollectionForAnalysisV0()` validates the root/index and
  exact supplied digest globally, then reverifies every stored T-541 child in
  isolation and releases only its verified copied-payload capability inside the
  process.
- `LocalNativeCollectionAnalysisControllerV0` runs children sequentially
  through the existing V8 intake receipt, Source Facts, readiness and operator
  checklist. It binds the V8 receipt back to the T-541 receipt and performs a
  second full T-541 verification before publishing the neutral result.
- Public items contain generated labels, family counts/support, artifact
  states/digests, sorted unique fixed blocker codes and one fixed next-action
  state/code. They contain no source/copy/workspace path, basename, relative
  locator, raw reason, inherited request text or file name. XBIN is explicitly
  `XBIN_OFFICIAL_EXPORT_ONLY` with `OBTAIN_OFFICIAL_EXPORT` and remains opaque.
  A collection entry with no stored copy is `COPIED_PAYLOAD_NOT_STORED` with
  `RESTART_LOCAL_INTAKE`; it is not mislabeled as a failed verification.
  Cancelled or bounded-inspection-failed items use `RESTART_LOCAL_SESSION`,
  matching the controller's deliberate one-shot lifecycle.
- Every result is authority none and `needs_operator_review`. Start/status/
  cancel/report are explicit exact-empty-body routes. Stop closes analysis
  before intake/helper shutdown.
- Cancellation is abortable during V8, but the existing T-541 verifier has no
  signal. The canonical view/report field and UI therefore state
  `between_bounded_verification_steps`; a current verification step may finish
  first.

The generated mixed-family regression covers E57, OBJ, GLB, Gaussian PLY,
photo, video and XBIN. The real default-core regression creates two durable
T-541 children from generated 5-byte OBJ and 9-byte GLB originals, completes
both through V8/post-verification, then mutates one copied payload and proves
the damaged child fails while the later child completes. Other regressions pin
wrong-index-digest rejection, mutation after V8, cancellation, unchanged
originals, path/basename non-disclosure, pending truth and absence of admission,
plan, reconstruction, worker/provider, training, enhancement, cloud, rights,
signing and publication behavior.

Final gates are 4 focused files / 47 tests passed, tools package typecheck
passed, targeted lint passed and scoped diff check passed. Automated HTTP and
browser-asset contracts are green; a manual visual browser pass was not run.
The earlier same-session note that the untracked analysis test lacked an
implementation is now superseded: the implementation exists and typecheck is
green.

Evidence is
`docs/reports/omnitwin-durable-collection-workbench-bridge-v0-evidence-2026-07-22.json`.

## Current continuation pointer — after T-544

T-544 is complete only for generated/default-core bridge proof. It does not
close T-542B, T-542, T-533, T-508, T-486, T-539 or the broader `/goal`.

The smallest user-assisted next check remains one real mixed Explorer drag into
the T-542B native OLE panel, followed by durable copy and this new Step 3
inspection. Verify neutral rows, exact copied hashes, one T-541 child per root,
collection reopen, T-544 analysis results, unchanged originals, no private
locator in HTTP/browser output and zero helper/listener processes after Stop.
Also perform a desktop/mobile visual pass of Step 3 because this slice verified
its asset and HTTP contracts but did not make a manual visual claim.

Do not claim admission, planning or reconstruction from a T-544 result; its
stable next action remains operator evidence review, or an official export for
XBIN.
