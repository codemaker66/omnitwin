# OmniTwin Foundry activation V1 administrative request schemas

Status: **DESIGN DRAFT / NO-GO — closes JSON value shapes only; grants no
authority.**

Date: 2026-07-14

This appendix freezes the eleven `jsonb` request values in callable API section
5.1. It does not repair 0058, create 0059, enable generation 1, create
credentials, contact a provider/object store, or authorize execution, upload,
custody, signing, release, publication, redistribution, serving, promotion,
runtime use or measured geometry.

`docs/specs/omnitwin-foundry-activation-v1-request-schemas.schema.json` is the
machine-readable Draft 2020-12 shape. Its `x-fdv1Rules` identifiers refer to the
cross-row/byte rules defined here; neither artifact may be used without the
other, and both are content-addressed by the final catalog manifest. Workload
registration additionally depends on the normative Merkle, trust-bundle, leaf,
and verification-record contract in
`docs/specs/omnitwin-foundry-activation-v1-workload-inclusion-proof.md` and its
adjacent JSON Schema. All four files are one closed contract for that API.

## 1. Common value rules

Every request is a depth-1 JSON object with exactly the keys listed for its arm.
Unknown keys and JSON null are forbidden; an optional key is omitted rather
than set to null. Strings are NFC. ASCII-constrained strings reject NUL/control
characters and surrounding whitespace. Fixed-form and ASCII patterns reject
CR/LF explicitly; they do not rely on the ECMA-262 `$` final-line-terminator
behavior. JSON integers have scale zero.
Canonical request size is the RFC 8785 JCS UTF-8 byte length.

The reusable value types are:

| Type | Exact rule |
| --- | --- |
| `UUID` | lower-case canonical 36-character non-nil UUID |
| `SHA` | `^sha256:[a-f0-9]{64}$` |
| `KEY120` | `^[a-z0-9][a-z0-9._-]{0,119}$` |
| `IDEM` | 1–160 printable non-space ASCII bytes, no surrounding whitespace |
| `UTCMS` | exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`, calendar-valid and equal after the DB millisecond formatter round trip |
| `B64U(n)` | canonical unpadded base64url; decode/re-encode identical and decoded length from 1 through `n` bytes inclusive |

For a mixed scalar/JSON signature, SQL constructs and hashes exactly:

```json
{
  "schemaVersion": "omnitwin.foundry.fdv1.api-call.v1",
  "function": "<exact public function identity signature>",
  "scalarArguments": {},
  "request": {}
}
```

`scalarArguments` has the function-specific scalar names below in signature
order. The JSON object never duplicates a scalar target ID/SHA. The accepted
`admin_action` evidence must bind this wrapper's JCS SHA, the function-specific
action literal, idempotency key, exact subjects and current activation caller.
Callers provide only `adminEvidenceId`, never payload/admission SHA,
administrator/authentication facts, DB time, sequence, authority, policy,
generation, horizon or result digest.

## 2. Register storage profile

`fdv1_api_register_storage_profile(jsonb)`, maximum JCS size 8192 bytes, has
exactly these 21 keys:

| Key | Type/rule |
| --- | --- |
| `schemaVersion` | literal `omnitwin.foundry.fdv1.register-storage-profile.request.v1` |
| `profileId` | `KEY120` |
| `profileVersion` | `KEY120` |
| `bucket` | trimmed ASCII 1–255; `^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$` |
| `rootPrefix` | trimmed ASCII 2–1024, has at least one byte before and ends `/`; no URI prefix, backslash, `?`, `#`, empty/dot/dotdot segment |
| `brokerPolicySha256` | `SHA` |
| `custodianPolicySha256` | `SHA` |
| `kmsConfigurationSha256` | `SHA` |
| `retentionConfigurationSha256` | `SHA` |
| `retentionDays` | JSON integer 1–36500 |
| `maximumResultCustodySeconds` | JSON integer 1–86400 |
| `validFrom` | `UTCMS` |
| `expiresAt` | `UTCMS` |
| `infrastructureEvidenceId` | `UUID`; accepted `predecessor_source` for the complete profile material |
| `brokerCallerAuthorizationId` | `UUID` |
| `storageCreateSignerAuthorizationId` | `UUID` |
| `custodianCallerAuthorizationId` | `UUID` |
| `storageReadSignerAuthorizationId` | `UUID` |
| `verifierSignerAuthorizationId` | `UUID` |
| `adminEvidenceId` | `UUID` |
| `idempotencyKey` | `IDEM` |

`validFrom < expiresAt`. SQL locks and verifies the exact caller/signer arms and
pairing policies, matches every profile leaf to the predecessor evidence, runs
the namespace pre-scan, and derives resource UUID, activation caller/admin,
the three fixed true requirement booleans, infrastructure receipt SHA, profile
JSON/SHA, request SHA, sequence and time.

## 3. Revoke storage profile

`fdv1_api_revoke_storage_profile(uuid,jsonb)`, maximum 1024 bytes. The scalar
wrapper is exactly `{ "storageProfileResourceId": UUID }`. JSON has exactly:

- `schemaVersion`: literal
  `omnitwin.foundry.fdv1.revoke-storage-profile.request.v1`;
- `reasonCode`: `administrative_revocation`, `configuration_compromise`,
  `namespace_compromise`, or `service_decommissioned`;
- `adminEvidenceId`: `UUID`; and
- `idempotencyKey`: `IDEM`.

SQL derives logical profile ID/version/SHA, revocation ID/JSON/SHA,
caller/admin/time and exact containment.

## 4. Register workload authorization

`fdv1_api_register_workload(jsonb)` has maximum JCS size 32,768 bytes for the
trust-root arm and 8,192 bytes for either leaf arm. Every
arm has common keys `schemaVersion` (literal
`omnitwin.foundry.fdv1.register-workload.request.v1`), `bindingKind`,
`validFrom:UTCMS`, `expiresAt:UTCMS`,
`inclusionProofBase64url`, canonical unpadded base64url decoding to the exact
`OTFDMP01` proof length `28 + 32 * depth`, 28–1,052 bytes and therefore
38–1,403 encoded characters, `adminEvidenceId:UUID`, and
`idempotencyKey:IDEM`. `validFrom < expiresAt` and the interval lies within the
named authorizing root. Runtime proof verification uses that exact stored root
authorization; no ambient, latest, or caller-selected bundle is permitted.
The public runtime API has no bootstrap arm: all three arms require this proof.

The exact discriminated arms are:

- `trust_root` — 12 total keys: common plus
  `bindingKind = "trust_root"`;
  `inclusionAuthorityRootAuthorizationId:UUID`, naming one current, previously
  sequenced stored
  `trust_root` authorization whose validity contains the requested interval;
  `trustDomain`, a normalized lower-case DNS name
  of 1–253 bytes; `rootPublicKeyDerBase64url`, canonical base64url decoding to
  exactly the 44-byte RFC 8410 Ed25519 SPKI;
  `authorizedLeafMerkleRootSha256:SHA`, the new root's distinct child-
  authorization Merkle root; and `trustBundleBase64url`, canonical unpadded
  base64url decoding to 1–16,384 bytes. Those bytes are strict UTF-8 RFC 8785
  JCS validating against the frozen trust-bundle schema; its embedded child
  root must equal `authorizedLeafMerkleRootSha256`. The Merkle policy is pinned
  and derived, never caller selectable.
- `db_caller` — 18 total keys: common plus
  `bindingKind = "db_caller"`; `parentRootAuthorizationId:UUID`; `plane`, one of
  `activation|claimer|submit_gateway|recovery_gateway|evidence_admitter|output_broker|output_custodian|watchdog`;
  `dbSessionRole`, `^[a-z_][a-z0-9_]{0,62}$`;
  `dbSystemUserSha256:SHA`; `spiffeId`, normalized SPIFFE URI at most 2048 bytes
  with no query/fragment; `issuer`, `subject`, and `audience`, each trimmed NFC
  1–240 bytes without controls; `credentialKind = "spiffe_x509_svid"`;
  `serviceArtifactSha256:SHA`; and `serviceConfigurationSha256:SHA`.
- `evidence_signer` — 19 total keys: common plus
  `bindingKind = "evidence_signer"`; `parentRootAuthorizationId:UUID`;
  `evidenceKind`, one of
  `admin_action|predecessor_source|gateway_token_commitment|runner_terminal|provider_result|storage_create|storage_read|glb_verifier`;
  `pairedCallerAuthorizationId:UUID`; the same `spiffeId`, `issuer`, `subject`,
  `audience`, and credential literal; `signerPublicKeyDerBase64url`, canonical
  base64url decoding to the exact 44-byte RFC 8410 Ed25519 SPKI;
  `maximumReceiptLagSeconds`, JSON integer 1–300;
  `serviceArtifactSha256:SHA`; and `serviceConfigurationSha256:SHA`.

SQL derives registry generation/root, authorization UUID/JSON/SHA, the exact
authority SHA, root-independent candidate-leaf JCS/commitment, DB role OID,
workload/caller-binding/key/bundle/proof/policy digests, key ID, parent bundle
copy, signer semantic plane and the closed cross-root pairing-policy JSON/SHA. The request
cannot supply a parsed bundle, leaf, verification record or derived digest/ID.
Runtime trust-root registration verifies the proof against the explicitly
named inclusion authority; DB-caller and evidence-signer registration verify
it against their named parent root. For an evidence signer, the request's
paired-caller UUID selects and root-first locks one already committed DB-caller
before signer-leaf construction. SQL freshly recomputes that row's workload-
identity and closed caller-binding SHAs, requires the signer leaf's sole
`pairedCallerBindingSha256` selector to equal the latter, and verifies its
plane, catalog login binding, current lineage and exact interval containment:
`signer.validFrom >= pairedCaller.validFrom` and
`signer.expiresAt <= pairedCaller.expiresAt`. The exact caller
authorization SHA, separately exposed workload-identity SHA, both lineages and
pairing-policy SHA are added only to the atomic post-proof verification record,
whose paired-caller interval-containment verdict MUST be true.
Only the separate bootstrap
special ceremony has neither an inclusion authority nor proof, and that
ceremony is not an arm of this public runtime request schema.

## 5. Revoke workload authorization

`fdv1_api_revoke_workload(uuid,jsonb)`, maximum 1024 bytes. The scalar wrapper
is `{ "workloadAuthorizationId": UUID }`.

The non-compromise arm has exactly four keys: schema literal
`omnitwin.foundry.fdv1.revoke-workload.request.v1`; `reasonCode` equal to
`administrative_revocation` or `service_decommissioned`;
`adminEvidenceId:UUID`; and `idempotencyKey:IDEM`.

The compromise arm has exactly those keys plus required
`compromiseNotBefore:UTCMS` and fixes `reasonCode = "security_compromise"`.
That instant must not be later than DB recorded time. SQL derives the target
SHA/arm/root impact, revocation UUID/JSON/SHA, caller/admin/time and exact
affected-phase containment.

## 6. Revoke broker authorization

`fdv1_api_revoke_broker_authorization(uuid,jsonb)`, maximum 1024 bytes. The
scalar wrapper is `{ "brokerAuthorizationId": UUID }`.

The non-compromise arm has exactly four keys: schema literal
`omnitwin.foundry.fdv1.revoke-broker-authorization.request.v1`; `reasonCode`
equal to `administrative_revocation` or `service_decommissioned`;
`adminEvidenceId:UUID`; and `idempotencyKey:IDEM`.

The compromise arm has exactly those keys plus required
`compromiseNotBefore:UTCMS` and fixes `reasonCode = "security_compromise"`.
That instant must not be later than DB recorded time. SQL derives the exact
broker authorization SHA and reservation/output graph, revocation UUID/JSON/
SHA, caller/admin/time and phase-scoped containment. The effective boundary is
`coalesce(compromise_not_before, recorded_at)`: an exact broker action at the
boundary is affected, while an action strictly before a later boundary remains
immutable historical evidence.

## 7. Revoke custodian authorization

`fdv1_api_revoke_custodian_authorization(uuid,jsonb)`, maximum 1024 bytes. The
scalar wrapper is `{ "custodianAuthorizationId": UUID }`.

The non-compromise arm has exactly four keys: schema literal
`omnitwin.foundry.fdv1.revoke-custodian-authorization.request.v1`;
`reasonCode` equal to `administrative_revocation` or
`service_decommissioned`; `adminEvidenceId:UUID`; and
`idempotencyKey:IDEM`.

The compromise arm has exactly those keys plus required
`compromiseNotBefore:UTCMS` and fixes `reasonCode = "security_compromise"`.
That instant must not be later than DB recorded time. SQL derives the exact
custodian authorization SHA and reservation/object/read/verifier graph,
revocation UUID/JSON/SHA, caller/admin/time and phase-scoped containment. The
effective boundary is `coalesce(compromise_not_before, recorded_at)`: an exact
custodian action or admitted evidence at the boundary is affected, while an
action strictly before a later boundary remains immutable historical evidence.

Neither revocation request selects an activation, attempt, evidence row,
containment effect or trust-registry lineage. Scope is derived only from the
exact target authorization and its typed graph; workload/root fanout remains
exclusive to workload-authorization revocation. Same activation caller/key and
equal wrapper SHA replays the stored revocation. Changed reuse, or an already
revoked target presented under any different key or caller, is `23505` with no
new row.

## 8. Register executor authorization

`fdv1_api_register_executor(jsonb)`, maximum 16384 bytes, has exactly these 23
keys:

- schema literal `omnitwin.foundry.fdv1.register-executor.request.v1`;
- `submitCallerAuthorizationId:UUID`, `runnerSignerAuthorizationId:UUID`,
  `recoveryCallerAuthorizationId:UUID`, and
  `providerSignerAuthorizationId:UUID`;
- `providerKind`, lower key-like ASCII 1–40;
- `providerTarget`, canonical printable ASCII 1–240;
- `providerAdapterId:KEY120`, `providerAdapterVersion:KEY120`,
  `providerAdapterArtifactSha256:SHA`,
  `providerAdapterConfigurationSha256:SHA`, and
  `providerDeploymentSha256:SHA`;
- `requestProfileId:KEY120`, `requestProfileVersion:KEY120`, and
  `requestProfileSha256:SHA`;
- `workerProfileId:KEY120` and `workerProfileSha256:SHA`;
- `containerImageDigest`, normalized digest-only OCI reference 1–512 bytes with
  exactly one `@sha256:<64 lowerhex>` and parse/serialize equality;
- `stageId:KEY120`, `validFrom:UTCMS`, `expiresAt:UTCMS`,
  `adminEvidenceId:UUID`, and `idempotencyKey:IDEM`.

The four authorization IDs are pairwise distinct/current. Runner is
`runner_terminal` paired to submit; provider is `provider_result` paired to
recovery; provider signer artifact/configuration equals the selected adapter;
and the requested window lies within all four bindings. SQL requires the
complete accepted predecessor-evidence set for the executor binding, adapter
artifact/deployment, request profile and worker profile, then derives its set
SHA. It also derives executor/submit workload SHAs, issuer/subject/audience/
credential, fixed command `['omnitwin-sealed-worker','normalize_mesh_glb','v0']`,
operation/class, authorization UUID/JSON/SHA, caller/admin, sequence and time.

## 9. Revoke executor authorization

`fdv1_api_revoke_executor(uuid,jsonb)`, maximum 1024 bytes. The scalar wrapper
is `{ "executorAuthorizationId": UUID }`. JSON has exactly schema literal
`omnitwin.foundry.fdv1.revoke-executor.request.v1`; `reasonCode`, one of
`administrative_revocation|identity_compromise|adapter_compromise|deployment_compromise|service_decommissioned`;
`adminEvidenceId:UUID`; and `idempotencyKey:IDEM`. All target/receipt/caller/
containment leaves derive under locks.

## 10. Activate

`fdv1_api_activate(jsonb)`, maximum 4096 bytes, has exactly nine keys:

- schema literal `omnitwin.foundry.fdv1.activate.request.v1`;
- `candidateId:UUID`;
- `closureId:UUID`;
- `executorAuthorizationId:UUID`;
- `storageProfileResourceId:UUID`;
- preallocated distinct/unused `activationId:UUID` and `executionId:UUID`;
- `adminEvidenceId:UUID`; and
- `idempotencyKey:IDEM`.

SQL derives every SHA, candidate reservation/project/job/stage/source/worker/
profile leaf, complete predecessor-evidence-set SHA, current enabled epoch and
policies, administrator/caller, authority/horizon/literals, activation/
execution/admission JSON, sequence and time. No caller generation, policy,
authority, eligibility, disposition or time is accepted.

## 11. Revoke activation

`fdv1_api_revoke_activation(uuid,jsonb)`, maximum 1024 bytes. The scalar wrapper
is `{ "activationId": UUID }`. JSON has exactly schema literal
`omnitwin.foundry.fdv1.revoke-activation.request.v1`; `reasonCode`, one of
`administrative_revocation|authority_compromise|security_response`;
`adminEvidenceId:UUID`; and `idempotencyKey:IDEM`. SQL derives target SHA,
revocation row/receipt, caller/admin/time and containment/stop.

## 12. Disable epoch

`fdv1_api_disable_epoch(jsonb)`, maximum 4096 bytes, has exactly seven keys:

- schema literal `omnitwin.foundry.fdv1.disable-epoch.request.v1`;
- `disabledReason = "containment"`;
- `priorEpochId:UUID`;
- `sourceKind`, one of
  `derivative_policy_revocation|derivative_policy_generation_superseded|base_policy_revocation|base_policy_generation_superseded|registry_attestation_revocation|workload_authorization_revocation|executor_authorization_revocation|output_broker_authorization_revocation|output_custodian_authorization_revocation|quarantine_storage_profile_revocation|activation_revocation|global_or_scoped_kill|quarantine_security_event`;
- `sourceId`, ASCII 1–160;
- `adminEvidenceId:UUID`; and
- `idempotencyKey:IDEM`.

`sourceId` is a canonical UUID for revocation, kill and security-event branches;
generation-superseded branches use the exact regex
`^[a-z0-9][a-z0-9._-]{0,119}:[1-9][0-9]{0,18}$`, where the colon is one literal
separator between a `KEY120` policy/version selector and a canonical positive
decimal generation no greater than `9223372036854775807`. SQL resolves the
exact source SHA/time, requires the prior epoch to be latest effective, and
derives the contiguous next generation, new epoch UUID, effective/recorded
times, fixed disabled/system/sentinel fields, JSON/SHA, caller/admin and
containment. Caller-selected `activation_epoch_disabled`,
`activation_epoch_replaced` and `derivative_authority_expired` causes are
forbidden to prevent recursion or caller-authored wall-clock authority.

## 13. Exact replay and denial

Every function checks the complete call-wrapper SHA before mutation. Exact
caller/idempotency replay returns the immutable original result. Changed reuse
is `23505` and changes nothing. A malformed/oversized/unknown-key/wrong-arm
request is `22023`; wrong-plane identity is `42501`; failed evidence/authority/
relational closure is `23514`. Errors never echo request bodies, evidence,
credentials, tokens or private storage/provider references.
