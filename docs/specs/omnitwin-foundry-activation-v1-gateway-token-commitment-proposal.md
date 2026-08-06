# OmniTwin Foundry Activation V1 gateway-token commitment semantic contract proposal

Status: **proposed, not frozen, authority none, not implementation-approved**.

This companion proposal closes one deliberately small gap in the design draft
`omnitwin-foundry-authenticated-result-evidence-v1.md`: the exact semantic JSON
shape for `gateway_token_commitment`. It does not amend that design draft,
authorize a gateway, admit evidence, redeem a token, activate generation 1 or
approve migration 0058. Promotion requires explicit contract review and new
positive/negative implementation evidence.

## 1. Existing requirements preserved

The parent design draft already requires one canonical, number-free payload,
one Ed25519 DSSE signature, the exact gateway-token domain/payload type, a
signer-generated evidence ID and nonce, environment/tenant/project scope,
signer binding, exact command/sidecar, target submit/recovery caller, plane,
queue scope, a 32-byte redemption-token SHA-256 and bounded expiry. The token
plaintext remains only in the target gateway's private store. The command's
`claim_token` is the admitted evidence UUID, never the secret or its digest.

This proposal adds only an exact payload shape and a pure comparison context.
It cannot establish signer/caller currentness, immutable signer-to-target
pairing, queue delivery, one-use state, token possession, redemption, database
admission or runtime authority.

## 2. Proposed payload

The payload is one exact flat object with 22 members. All members are required;
unknown members, nulls and JSON numeric leaves are forbidden.

| Member | Proposed rule |
| --- | --- |
| `schemaVersion` | exact `omnitwin.foundry.derivative-gateway-token-commitment.v1` |
| `evidenceKind` | exact `gateway_token_commitment` |
| `authority` | exact `none` |
| `evidenceId` | non-zero lower-case canonical UUID |
| `purpose` | exact `provider_command_claim_token` |
| `nonceSha256` | `sha256:` plus 64 lower-case hex; signer-declared digest of a distinct one-use nonce |
| `environmentId`, `tenantId`, `projectId` | lower-case key-like ASCII, 1–120 bytes |
| `signerAuthorizationId` | non-zero lower-case canonical UUID |
| `signerAuthorizationSha256` | prefixed SHA-256 of the exact signer authorization |
| `issuedAt`, `observedAt`, `expiresAt` | calendar-valid millisecond UTC using `+00:00` |
| `subjectKind` | exact `provider_command` |
| `subjectId` | exact pending provider-command UUID |
| `subjectSha256` | prefixed SHA-256 of the immutable command sidecar |
| `targetPlane` | exact `submit_gateway` or `recovery_gateway` |
| `targetCallerAuthorizationId` | exact current target caller UUID supplied by comparison context |
| `targetCallerAuthorizationSha256` | prefixed SHA-256 of that caller authorization |
| `queueScope` | lower-case ASCII queue selector, 1–160 bytes |
| `redemptionTokenSha256` | signer-declared prefixed SHA-256 commitment to exactly 32 private random token bytes |

Upstream canonical payload bytes use unsigned-ASCII key order under the parent
design draft. This parsed-object semantic proposal does not verify raw-byte
canonicalization, duplicate keys, a byte-order mark, whitespace, DSSE framing
or a signature. The payload never contains token plaintext, nonce plaintext,
admission identity, verification result, currentness boolean,
grant/redemption identity or a database time.

The pure validator can establish only digest syntax and cross-role inequality.
It cannot establish either preimage, nonce uniqueness, token length, generation
method or entropy; those remain later authenticated-source/runtime checks.

## 3. Proposed expected context

A pure semantic validator receives a separately trusted, already snapshotted
plain object with exactly:

`schemaVersion`, `environmentId`, `tenantId`, `projectId`,
`signerAuthorizationId`, `signerAuthorizationSha256`, `subjectId`,
`subjectSha256`, `targetPlane`, `targetCallerAuthorizationId`,
`targetCallerAuthorizationSha256`, `queueScope`, and `maximumExpiresAt`.

The context `schemaVersion` identifies the context itself and is not compared
with the payload `schemaVersion`. Each of its other 11 same-named bindings must
compare equal byte-for-byte with the corresponding payload leaf;
`maximumExpiresAt` is used only by the expiry rule. The context is not signed
evidence and cannot be supplied by the payload under validation. Its authority
depends on a future authenticated caller/locked-database path, which this
proposal does not implement.

## 4. Proposed cross-field rules

1. `issuedAt <= observedAt < expiresAt <= maximumExpiresAt` after exact
   calendar parsing and millisecond round trip.
2. `expiresAt - observedAt` is at most 300 seconds. This is a proposed maximum,
   selected to match the design draft's upper bound for normal signer receipt
   lag; it
   requires owner review before freezing.
3. `nonceSha256` and `redemptionTokenSha256` are distinct.
4. `targetPlane` is the only arm discriminator. It changes no other payload
   shape and must equal the expected context.
5. The 11 same-named expected-context bindings compare exactly. The validator
   does not query a registry, command table, queue or token store and does not
   prove that the signer authorization is immutably paired with the target
   caller authorization or plane.

## 5. Proposed authority-none result

A future pure validator may return a frozen result only after the payload
schema and all rules above pass:

```text
schemaVersion = omnitwin.foundry.activation-v1-gateway-token-commitment-semantic-validation.v0
authority = none
validationScope = payload_and_expected_context_only
evidenceId = exact validated payload evidenceId
targetPlane = exact validated payload targetPlane
semanticValidation = passed
canonicalByteVerification = not_performed
signatureVerification = not_performed
signerAuthorizationCurrentness = not_performed
targetCallerCurrentness = not_performed
signerTargetPairing = not_performed
nonceUniqueness = not_performed
redemptionTokenGeneration = not_performed
queueDelivery = not_performed
tokenPossession = not_performed
tokenRedemption = not_performed
databaseAdmission = not_performed
runtimeAuthority = none
```

No `valid`, `verified`, `trusted`, `authorized`, `admitted`, `redeemable` or
`executionEligible` boolean is permitted.

## 6. Proposed stable error classes

| Code suffix | Meaning |
| --- | --- |
| `INPUT_SHAPE_INVALID` | payload/context carrier is not an exact plain data object |
| `PAYLOAD_SCHEMA_INVALID` | required/unknown/type/format/literal failure |
| `EXPECTED_CONTEXT_SCHEMA_INVALID` | comparison context shape or format failure |
| `EXPECTED_CONTEXT_MISMATCH` | one immutable payload binding differs |
| `TIME_ORDER_INVALID` | issue/observation/expiry ordering is invalid |
| `MAXIMUM_EXPIRY_EXCEEDED` | payload expiry exceeds the context or 300-second proposal |
| `DIGEST_ROLE_COLLISION` | nonce and redemption-token digests are equal |

The full prefix is
`FOUNDRY_ACTIVATION_V1_GATEWAY_TOKEN_COMMITMENT_`.

The table order is the proposed first-error precedence. Shape is checked before
either schema; payload schema precedes context schema; exact context bindings
precede time ordering, expiry bounds and digest-role separation. A validator
returns only the first failure in that order.

## 7. Review and promotion gate

The adjacent JSON Schema and semantic vectors are review aids and carry
`contractStatus = proposed_not_frozen`. Before implementation:

1. the owner must approve or replace the purpose literal, queue grammar and
   300-second maximum;
2. the evidence, callable-API and schema/privilege contracts must be amended or
   explicitly reference the final companion contract;
3. the schema/vectors need an independent specification review;
4. a pure validator must be developed from failing vectors and return only the
   authority-none result above; and
5. database/currentness/redemption behavior remains a separate later gate.

Until those steps close, the existing byte verifier must continue to report
per-kind semantic validation as not performed.

The adjacent corpus is a minimal representative matrix, not an exhaustive
mutation of every binding leaf. It contains both gateway arms, an accepted
exact 300-second boundary, and 17 negative cases including carrier shape,
numeric/null leaves, calendar validity, context schema, queue scope, both
expiry caps and digest-role separation. Companion validation must also require
unique `caseId` values; JSON Schema `uniqueItems` alone compares whole cases.

Vector mutations apply to a deep data copy of the named positive base case.
`add` requires the member to be absent, `replace` requires it to be present,
and `remove` requires it to be present and carries no `value`. `replace_target`
replaces the complete named carrier with the non-object `value`, carries no
`member`, and exists only to represent JSON-encodable carrier-shape failures.
A mutation that does not meet those preconditions is an invalid vector, not a
validator case. Prototype, accessor and proxy cases are not JSON-encodable and
remain mandatory implementation tests if this proposal is ever promoted.
