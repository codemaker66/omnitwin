# OmniTwin Foundry continuation handoff — 2026-07-14

This checkpoint closes a bounded contract and verification slice only. The
broad OmniTwin Foundry goal remains active and incomplete. Generation 1 is
disabled, migration 0058 is a frozen NO-GO baseline, no migration 0059 exists,
and no production database, provider, object store, credential, signing,
release, publication, promotion, paid compute or model-training authority was
used.

The provider-result admission and watchdog contracts remain explicit NO-GO
readiness boundaries. The record-provider-result contract is
`frozen_unimplemented`. Nothing in the contracts is activation evidence.

## Outcome of this continuation

- Read the current goal attachment as exact bytes and retained the predecessor
  identity for continuity.
- Preserved migrations 0053–0058 and the Drizzle journal byte-for-byte.
- Closed the workload-proof, request-schema and catalog-contract foundations.
- Repaired and independently re-audited the provider-result admission,
  record-provider-result and watchdog semantic models. The final independent
  read-only audit found no actionable P0–P3 issue across 59 structural and
  semantic checks.
- Replayed the frozen journal into a disposable PostgreSQL 16 server, inspected
  the live catalog, checked identifiers, relations, columns, constraints,
  indexes, triggers, roles and ACLs, and removed the disposable audit resources.
- Reconciled supporting Foundry reports with current repository test counts and
  kept all claims non-authorizing.

## Frozen inputs and byte identities

### Goal attachment

- Current attachment: 51,717 bytes, 1,964 CRLF separators, no final LF,
  SHA-256
  `d6684da7ff4f129dad5a086450692ceca7e40e117a19897aa0c2749c2d6aa3b9`.
- Predecessor attachment: 28,777 bytes, final LF, SHA-256
  `a0dbe2ef903f9e43aa2cf53d771e8cd7aa71c813af6821dc4b019f4ef3d3a4ac`.

### Frozen migrations and journal

| Artifact | SHA-256 |
| --- | --- |
| 0053 | `6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34` |
| 0054 | `05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4` |
| 0055 | `47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7` |
| 0056 | `3075ba5895283dd6a15407e4aa3edb44073fe7125a69a541d125579efef7a78d` |
| 0057 | `10fc023060ecd1228421243272d584dcb1b2bd8bd277622d9f66c5cc27ba1c6e` |
| 0058 | `1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e` |
| Drizzle journal | `08ab4ac04f086c49a030848ca59929c32fdeb40669d3d767199616118ac701af` |

Migration 0058 is exactly 262,281 bytes. The journal is exactly 8,943 bytes,
contains 57 entries from 0000 through 0058, has 405 LF bytes of which 347 are
CRLF pairs and 58 are bare LF, and ends in LF. Do not normalize it. No `0059*`
file exists.

### Activation V1 contract set

| Contract | Bytes | SHA-256 |
| --- | ---: | --- |
| authenticated result evidence | 87,168 | `550169ce29f47982ea2ff36e7a88cf978d9941fbeb60f776f6d49d67d3560875` |
| callable API | 105,456 | `1a338fbd01521951c85d8b3ada30891ab4ad56c834066f6c8477d04fd07aa15f` |
| schema/privilege manifest | 130,878 | `f3c053b3468e9a31bb79e91e09b9756736ac86d6a5d07ec402d9d98cdf39da41` |
| catalog-manifest format | 68,123 | `f5e04286720f20132ed8694e6d1213290ebe3b91da38869f53063d9c6dd9f6e4` |
| catalog-manifest schema | 347,162 | `dce1bad7aa190976ac98b62e0b943956861aabbfb97e85a0f1533eea5d968ee9` |
| request-schema format | 18,198 | `784ca41c07540b83142c613ca8ca04c6948dc3620c13c1e93ffc91d3613c4cb7` |
| request-schema JSON Schema | 25,107 | `61a9ba7e0d5d00f59773b6dc2ab8a3fb0eda12758ed07018641ce0c22cecd4bd` |
| workload-inclusion proof | 69,070 | `cbb147b37933a64ccebc5f0ee7a51236e7d178dbd01b985c826492f8ac33400f` |
| workload-inclusion proof schema | 38,313 | `56900412b6041222aea82619c522ed26a87588331a22b141a8e6b9b9f39086e0` |

All nine are UTF-8, BOM-free, LF-only, final-LF terminated and free of trailing
whitespace. The three JSON schemas have no duplicate object keys. The relevant
LF policy is `.gitattributes` SHA-256
`0fbedd28d2b174c25ed85d8b959687202324a94ce49bd69855101cf002444a01`.
The amended derivative-activation design remains SHA-256
`1f593314fd45850950afe168548ac1eefebabea2e0754ee05101cc21c4371659`.

## Contract verification and settled semantics

- Strict Draft 2020-12 compilation passed for the catalog, request and workload
  schemas with 99, 32 and 25 definitions respectively. Root verification used
  Ajv 8.18.0; the author harness independently used Ajv 8.20.0.
- The final catalog harness accepted eight canonical fixtures and rejected 55
  targeted mutations. The independent final audit re-read the final hashes and
  found no actionable P0–P3 issue.
- The request schema accepted 16 closed positive arms, rejected all 148
  required-property removals, rejected an unknown property in each arm and
  rejected 12 targeted semantic-shape mutations.
- The workload-proof audit re-derived nine canonical JSON blocks, accepted
  eight positive objects, rejected 210 structural mutations and 19 parser/proof
  negatives, and checked seven depth/count boundaries through depth 32 and
  count `2^32`. Frozen example roots are:
  - A `075030fafab3b9df89d4ed5c1c627d405c55c2648fb7cfdf070a477cc5faf8a7`
  - B `f13b2f0335b1fca0a8c71a10b8154b0decafd69e84f9455c9bcc33a7134eafc1`
  - C `de7b3d057186356171cccd525a68cbdb23072ba7c0edeec65bc59fc9a32838f2`

The provider-result model now freezes these points:

- Admission has one separate `preamble:1`, 13 contiguous `accepted:1..13`
  operations, five closed pre-accepted outcomes and ten accepted semantic
  branches. Every branch binds its own predicates, AST nodes, accesses,
  aggregate effects, writes, return sources and outcomes. Positive readiness
  stays NO-GO until the complete vector, cascade, AST/live-routine match and
  expanded-catalog match exist.
- Record-provider-result has seven closed branches and nine ordered operations.
  Its common preamble records pre-root `SESSION_USER`/`SYSTEM_USER`, role and
  membership catalogs, group closure and identity-only R25 candidates before
  taking the root lock. It validates R1/R11/R5, the paired recovery caller and
  provider signer, interval/artifact equality and recursive R25/R26 parent and
  inclusion-root authority at the operation-1 clock, then rechecks the same
  pair and lineage at the operation-4 claim clock.
- Operation 1 performs preliminary execution/R11/R5/R1 work; operation 2 binds
  the selected R27 to the exact locked attempt, execution and fence before any
  mutation. Later-different replay validates the existing R24→R22 containment
  closure.
- The scalar SQL API is exactly
  `public.fdv1_api_record_provider_result(uuid,text)`. Its SQL-derived request
  wrapper is a closed object with ordered `executionId` and
  `apiIdempotencyKey` scalar records, an empty closed `request`, strict RFC 8785
  JCS and the frozen domain-separated SHA-256 formula. Same key with a different
  execution rejects `23505`.
- Equal replay and all fresh arms resolve the same ordered 11-field result.
  Fresh arms share eight sources and exactly three branch-specific status/link
  sources. Changed-key reuse returns no tuple and rejects `23505`.
- Historical result handling is non-positive materialization of an already
  accepted complete R27/0053 graph, including after a later containment epoch.
  It does not require a current enabled epoch and never creates positive epoch,
  execution or output authority. It may only claim the existing observation
  and conditionally add the first-terminal historical R29 link. Generation-1
  sentinel disabled or no eligible complete graph rejects `23514` without
  mutation; submit, invoke, broker, custody, release, new graph and new R24/R22
  effects remain forbidden.
- Semantic continuations bind a full non-null
  `(nextOperationNamespace,nextOperationOrdinal)` target. Return and error
  outcomes require both target fields to be null. This removes the former
  `preamble:1`/`accepted:1` ambiguity.
- Watchdog intent has four frozen cursor rows, eight unresolved blockers and 13
  decisive negative tests. It locks before its selection clock, uses inclusive
  `due_at <= scan_cutoff_at`, rechecks selected rows without `SKIP LOCKED`, and
  samples a distinct mutation/receipt clock. Its readiness stays NO-GO.

## PostgreSQL 16 replay and catalog findings

The disposable audit used PostgreSQL 16.14 with
`default_table_access_method=heap`. Journal migrations must be replayed with
`psql --single-transaction`; raw autocommit correctly fails at migration 0044
because `LOCK TABLE` requires a transaction block. A clean single-transaction
replay applied all 57 entries through 0058.

Live results after replay:

- the only activation epoch was exactly `disabled_sentinel|false`; zero enabled
  epochs existed;
- all 24 tables created by 0058 were ordinary permanent heap tables with RLS
  and FORCE RLS false;
- 578 columns existed: 559 `NOT NULL`, 19 nullable, zero dropped;
- the live schema had 81 foreign keys, 27 checks, 116 indexes and 121 user
  triggers;
- the static 0058 identifier scan saw 4,658 quoted occurrences and 672 unique
  identifiers, maximum 61 UTF-8 bytes, with no identifier over 63 bytes and no
  truncation collision;
- all six future relations R25–R30 and `fdv1_action_sequence_v1` were absent:
  `foundry_derivative_workload_authorizations_v1`,
  `foundry_derivative_workload_authorization_revocations_v1`,
  `foundry_derivative_authenticated_evidence_v1`,
  `foundry_derivative_runner_terminal_receipts_v1`,
  `foundry_derivative_terminal_result_links_v1`, and
  `foundry_derivative_glb_verifier_receipts_v1`;
- seven current capability roles were `NOLOGIN NOINHERIT`, with zero role
  memberships; future roles were absent;
- no `fdv1_api_*` callable routine existed and PUBLIC had no mutation table
  privilege.

One concrete privilege defect remains in frozen 0058. Twenty-six `fdv1*`
helpers retain PUBLIC EXECUTE. Exactly one is SECURITY DEFINER:
`fdv1_assert_recovery_boundary(varchar,varchar,uuid,uuid,bigint,text,text)`.
It is created at 0058 line 2124, takes locks and reads recovery authority as its
owner, and is missing from the PUBLIC revokes at lines 5751–5776. This is an ACL
closure defect and future `rejectServiceOrPublicInternalRoutineExecute` must
reject it. This handoff does not overclaim a demonstrated exploit.

Two other live-design blockers remain explicit:

- all 24 table declarations omit `USING heap`; the live audit happened to use
  heap because of the server default, but the DDL does not pin that fact;
- the watchdog's future derivative-epoch arm conflicts with current R1's
  `effective_at <= recorded_at` check and unresolved UUID lineage.

The disposable audit container and its volume were removed. A pre-existing
user-owned running container named `omnitwin-foundry-pg-20260713`, created on
2026-07-13, was not part of this audit and was left untouched.

## Broader repository verification

Current source verification passed:

- Reconstruction Foundry: 23 files / 215 tests, plus one expected Windows
  symlink skip; focused 9 files / 103 tests plus the same skip.
- Reconstruction CLI: 12 files / 145 tests; focused 1 file / 9 tests.
- API Foundry: 10 files / 188 tests.
- Test-only local GLB conformance: 10/10; adjacent local-adapter/executor slice
  71/71.
- Types: 90 files / 2,078 tests; Foundry-focused 8 files / 230 tests; original
  focused file 1 / 17 tests.
- Capture Factory: 5 files / 30 tests.
- T-507 controls: 2 TypeScript files / 20 tests and 23/23 Python tests.
- T-514 Config B preflight: 74/74 Python tests.
- Typechecks passed for Reconstruction Foundry, CLI, Capture Factory, Types and
  API.

T-514 remains a non-training proof. Its deterministic receipt is 12,910 bytes,
SHA-256 `7b896c930587756b622001b34a4ac68da75dba10b69e1a975323f73b5280c907`,
with payload SHA-256
`8132107010427e8d60f3f6dd93f8ac24bebfdeea79cc3547b67a43d0e3fa9eb1`.
The decision is `contract_valid_runtime_blocked`, runtime-ready is false, and
the execute path refuses with exit 78. The newly recorded
`simple_trainer_depth.py` identity is
`e883f24c221412e6ee54c84cc0aca873947ed9410f703f300dedc1667bb19aa5`.

The external T-507 output tree is currently available at
`outputs/grand-hall-foundry-phase1`: its exact 13-file tree is byte/hash
identical to the copy retained in the T-486 r2 dossier. The output-index file
SHA-256 is
`5ce95707ed8111df82e32fd7997cbcf862bec2974cf544734f5098cfe0540773`.
The r2 dossier is an exact 22-file tree (21 indexed artifacts plus its
manifest); every indexed byte/length was rechecked, the manifest SHA-256 is
`3fba49c89207b6b78fbba067436c6a2a993efada113c9c0267cb625ea06203fd`,
and its canonical package digest is
`d2411e3f5a0ab3206c1dc174c71005130e5cd26df6369ddd2ec6e10b5eb9a85b`.
This corrects the earlier availability statement only: the evidence remains
authority-none, no independent surveyed control exists, and no T-507 compute
was rerun. T-509 identities match. Historical workflow counts were relabeled
as historical and the current 215/145 counts were recorded.

A new cross-package, build-excluded conformance test now proves one bounded
path from universal GLB receipt/review/verified stage through
`executeNextFoundryProviderCommand` and the local CPU adapter into the existing
test-only lossless normalizer/writer, followed by the public three-file bundle
verifier. Exact execution/attempt/fence, staging/manifest/admission, stage,
worker-profile, source and output-prefix bindings are checked. Same-marker
replay writes once; pre-backend cancellation writes nothing; staging/profile/
fence/source substitutions and each output-artifact tamper fail. The output is
still authority-none with activation absent and every downstream capability
false. The store/backend are in-memory test harnesses, and the test-only
functions remain outside the root export and production build. This is a
test-only end-to-end conformance proof, not production execution evidence.

Conformance file SHA-256 values:

- API conformance:
  `c298a04c765d855252750120e7360462a6e69a747aab79a71ef891b7030e8d22`;
- build-excluded fixture:
  `c7fce6e45f7588e354cb303ad52b42ca19b484f73f4b42eebdb48906b783c368`;
- refactored output-bundle test:
  `76e2dc3d8bc6c51a91a0cb883e3e711524e50e984d16057d54feb661bf591e8a`.

The 2026-07-14 primary-source licence refresh also confirms that permissive
code cannot close the captured-content gate. The latest bare `b` is not an
authenticated venue-authority attestation. Independent survey remains at zero
fit/zero blind controls versus the requested eight/six; the internal decision B
still covers four anchors and one exclusion rather than the complete release.
Matterport contract/order rights, venue-reference imagery and XGRIDS clearance
remain external written-decision gates. Preserve the T-486 dossier unsigned and
offline.

Current supporting-document identities:

| Artifact | SHA-256 |
| --- | --- |
| root investigation | `c7c744def508e6d3d908ba1c94aa3a08ae7aae3c98bc5c2b7fe283e93e5efbff` |
| root evidence JSON | `c8c564bdac19d2909e805915158dd976a7f5ea9e5c00212887980008da17d548` |
| moonshot | `970afb6dce84aa5528b8ca6fab40b81d0daa86033c83acbdf1a793335c40a6f5` |
| system architecture | `b475b96fa5016f15ef6bf9f4b82cb8f2a494d1ea3f77f6a4436e9cec414f4eaa` |
| universal-ingest format | `c3d6d66c63b2827d5784faecad1d11fc2a818ed2ff4cef5f70a72ba8bab7868a` |
| universal-ingest schema | `7fb7abb559fc407d6c2af374c9d39f2b039c529878844f306fabc0e280d673e1` |
| canonical venue package | `6189c67ed10c0d0cec6169840d49cb106e8d6139099184f4bc2f7d307c32f554` |
| quality contract | `d41bff0a38df22c7b7d23602a73e83bd43caed298cde2ec2622b2b8d9d526c86` |
| JobSpec | `4c4dd17e8f58b8e69df665f5f4928055e153dcd22ab16204ed99c95df7e99a38` |
| roadmap | `f0c30ada8fe3cdccdf8b5190ed9d094154386b01d822b5acfd96dd4972c3c586` |
| technology/license matrix | `b9d28e0b917073ee59d05525d58858d7f4ed0dcf0d82a87227e5a3eb16ea92dc` |
| one-room pilot | `e09b46b83f7e103c4f91f4d3f7ad1a551527f0b9acf0bb9ff41c8de1bcabd3c6` |
| UX workflow | `3f64c8e98f4e2cccb1f057290e2353aa03d122a31e8e631609583b001a9a3e0a` |
| splat correction | `b4fca887bc2447f2569d0fafc45c0edc374a8989e1410760b5ec717c19d8f53e` |
| T-514 report | `ad28db5347c2b12616576b0634627862e7e247e71347ebe6be9096b7f2a8b9a6` |
| guided-workflow evidence | `ac09ab05418febbe7a75b83e8202cf2be16fff3f2aa245a3af5d029a90e2e6db` |
| task ledger | `844479358b05afe1d26256e43771bd3cca78db2178015d57b6bfff242f8d80c0` |
| 2026-07-14 session log | `ab9d7525cc6792328b0aa6f0f57d73d2bd765991e6786ba9f1360ae22e14292c` |
| T-507 independent-control audit | `c8c1ae2fb5c8eb82db4850246d167495beaaeb61bcd665b3fca64f7976f99b67` |
| T-507 audit evidence | `352e4818fbc4319b6c9e63675eb81268786d884aeb3ea2ad9a7f1a28c23d023c` |
| Grand Hall gate intake | `4d41b10250dafdbb83c6749b7d83357f3af0a919beaa20a91da9993118c35ca8` |
| offline-review package spec | `61250ce33719de4de77e031e36fb542723bf574e5249c328d02aaf2014194bda` |

## Confirmed NO-GO and unverified work

- No expanded `expectedCatalog`, deterministic generator output, frozen
  source/contract instance hashes or recursively validated catalog bytes exist.
- No semantic-verifier implementation or independently authenticated verifier
  bootstrap/review pin exists. JSON Schema validation is necessary but never
  activation evidence.
- Evidence, verification-report, context, canonical-row and canonical-vector
  schemas/artifacts remain absent.
- Exact repaired SQL bodies/effects, final column/default/nullability/attnum
  projection, explicit access methods, indexes, triggers, policies, raw ACL and
  default-ACL storage, and column-level grants remain uninstantiated.
- The six future relations, action sequence, callable APIs and future roles do
  not exist. Provider/runner/storage/custody/release services and their evidence
  remain unwired in production. The new in-memory GLB harness proves interface
  conformance only and supplies no live activation or OS sandbox.
- No expanded instance has been compared to a clean live PostgreSQL 16 catalog;
  no candidate implementation has passed the required concurrency,
  dependency, exact-byte and adversarial matrices.
- Actual HD reconstruction/training remains separately gated by rights-cleared
  inputs, reviewed geometry/control, approved compute authority and the normal
  Foundry execution barriers.

## Remaining work

1. Preserve the verified T-507/T-486 bytes. Choose whole-release versus bounded
   Grand Hall scope, then obtain the external survey, complete scope
   classification, authenticated venue authority and exact Matterport/reference
   rights decisions before any online T-486 registration or transform review.
2. Design the exact repaired SQL delta without editing frozen 0058 or creating
   0059: R25–R30, `fdv1_action_sequence_v1`, explicit heap access method,
   complete routine effects, the PUBLIC EXECUTE repair, R1/watchdog resolution,
   indexes, triggers, policies and least-privilege table/column ACLs.
3. Create and adversarially validate the missing evidence, report, context,
   canonical-row and canonical-vector contracts.
4. Implement a deterministic, content-addressed semantic verifier with pinned
   PostgreSQL 16 SQL/PLpgSQL analyzers and an independently authenticated
   verifier-identity/digest bootstrap policy.
5. Generate the complete expanded `expectedCatalog` only from frozen source
   bytes; validate ordering, JCS/self-digests, consumer closure, semantic branch
   effects and every negative assertion. Do not hand-author unproved facts.
6. Only after separate read-only audits are clean, implement a new reviewed
   migration path and run fresh disposable PostgreSQL 16 static, live,
   adversarial and concurrency verification.
7. Do not promote the in-memory GLB harness. A production local worker still
   requires a separately audited OS sandbox, real database admission/activation,
   crash/reconcile proof and authenticated output custody.
8. Keep generation 1 disabled and continue the broader T-500/T-505 and
   T-510–T-513 programme only behind its recorded rights, geometry, capture and
   authority dependencies.

## Next prompt

```text
/goal Continue the active OmniTwin Foundry goal from docs/handoffs/2026-07-14-omnitwin-foundry-continuation.md. Read the handoff and verify its hashes before changing anything. Preserve the exact T-507/T-486 bytes, the three new test-only GLB conformance hashes and the external survey/identity/rights gates; do not reinterpret the latest bare b as an authenticated attestation or promote the in-memory harness into production. Treat migrations 0053–0058 and the Drizzle journal as frozen; do not edit 0058 or create 0059. Preserve the nine final activation V1 contract hashes unless a concrete independently audited defect requires a revision. First design an exact non-executed repaired-SQL/privilege delta for R25–R30, fdv1_action_sequence_v1, explicit heap access, the missing PUBLIC EXECUTE revoke, the R1/watchdog epoch conflict, complete routine effects, indexes/triggers/policies and table/column grants. Keep provider-result admission and watchdog NO-GO and record-provider-result frozen_unimplemented. Then create the missing evidence/report/context/canonical-row/vector contracts and a deterministic semantic verifier plus independently authenticated verifier pin. Only after separate P0–P3 audits are clean may a generator emit an expanded expectedCatalog and a disposable PostgreSQL 16 verification run assess a candidate migration. Keep generation 1 disabled and do not use production DB/provider/object storage, credentials, paid compute, signing, publication or promotion.
```
