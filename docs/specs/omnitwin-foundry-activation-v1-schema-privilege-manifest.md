# OmniTwin Foundry activation V1 schema and privilege manifest

Status: **DESIGN DRAFT / NO-GO — semantic integration delta, not yet the
catalog source manifest.**

Date: 2026-07-14

This manifest freezes the intended schema/ACL integration delta between the
disabled derivative-activation draft and the authenticated-evidence/callable-
API designs while retaining the explicitly enumerated catalog, grant,
semantic-verifier and executable-vector blockers. It does not edit or authorize
migration 0058, create migration 0059, enable generation 1, contact a provider
or object store, create credentials, or authorize signing, release,
publication, serving, promotion, runtime use, measured geometry, or generated
output.

The manifest is read together with:

- `docs/specs/omnitwin-foundry-derivative-activation-v1.md`;
- `docs/specs/omnitwin-foundry-authenticated-result-evidence-v1.md`;
- `docs/specs/omnitwin-foundry-activation-callable-api-v1.md`;
- `docs/specs/omnitwin-foundry-activation-v1-request-schemas.md`;
- `docs/specs/omnitwin-foundry-activation-v1-request-schemas.schema.json`; and
- `docs/specs/omnitwin-foundry-activation-v1-catalog-manifest-format.md`;
- `docs/specs/omnitwin-foundry-activation-v1-catalog-manifest.schema.json`;
- `docs/specs/omnitwin-foundry-activation-v1-workload-inclusion-proof.md`; and
- `docs/specs/omnitwin-foundry-activation-v1-workload-inclusion-proof.schema.json`.

For the existing 24 V1 relations, column order/type/constraints start from the
exact disabled 0058 draft whose SHA-256 is
`1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e`,
then apply every replacement/addition below. An omitted existing column is
unchanged; no omission silently removes a guard. This baseline reference is
only a compact schema-delta notation: no function, trigger, grant or positive
path in that NO-GO SQL is adopted unless this manifest explicitly retains it.

## 1. Exact integration replacements

When integrated, the amended activation contract must replace, not merely
supplement, its conflicting clauses as follows:

1. the table count is exactly 30, in the order in section 3;
2. the normal capability-role count is exactly eight, plus one NOLOGIN owner
   and one one-time NOLOGIN bootstrap role;
3. every `SECURITY DEFINER` entry point uses exactly
   `SET search_path = pg_catalog, pg_temp`, with every relation, function,
   operator and type schema-qualified; `public` is never on that path;
4. all evidence and custody fields are derived from the discriminated schemas
   below; the old caller-constructible success/failure interpretation is
   replaced; and
5. generation 1 remains the latest disabled epoch. No enabled epoch or positive
   external-action test is part of migration installation.

## 2. Global schema rules

All V1 relations/functions are in `public`. The sole non-catalog exception is
the pinned extension schema `omnitwin_fdv1_ext` described below. Identifiers are
lower-case ASCII, at most 63 UTF-8 bytes, and compared from a source identifier
manifest to the catalogs before deployment. `uuid` values have no caller-
visible default on planned evidence/receipt/result IDs. Every baseline
relation-1-through-24 `timestamptz` definition without a typmod is explicitly
replaced by `timestamptz(3)` in the repaired source; it is not an omitted,
unchanged column. Instants must equal their millisecond truncation. Prefixed digests
are `varchar(71)` matching `^sha256:[a-f0-9]{64}$`; raw SHA-256 values are
`char(64)` matching `^[a-f0-9]{64}$`.

One sequence exists:

```text
public.fdv1_action_sequence_v1 AS bigint MINVALUE 1
MAXVALUE 9223372036854775807 START 1 INCREMENT 1 CACHE 1 NO CYCLE
OWNED BY NONE
```

The sequence object is owned by `omnitwin_fdv1_owner`; `OWNED BY NONE` means it
is not attached to any one column because it serves all 30 relations. Each
table has one immutable non-null unique `action_sequence bigint`; relation 27
names that column `admission_sequence`. All 30 columns have no column default
(`atthasdef = false`). Every allocation is an explicit, schema-qualified
`pg_catalog.nextval('public.fdv1_action_sequence_v1'::pg_catalog.regclass)`
after exact replay/conflict checks and the complete root-first lock set. No V1
path uses `setval`, `ALTER SEQUENCE ... RESTART`, a literal action sequence, a
copied sequence from another row, or a column default. Gaps caused by rollback
are allowed; reuse or decrease is not, and exhaustion fails closed.

The raw sequence ACL in every lifecycle profile is exactly
`{omnitwin_fdv1_owner=U/omnitwin_fdv1_owner}`: the V1 owner receives only
`USAGE`, not ordinary `SELECT` or `UPDATE`, and `PUBLIC`, bootstrap, capability
roles and service LOGINs receive no sequence privilege. The migration-installed
relation-1 generation-1 bootstrap `disabled_sentinel` calls `nextval` exactly
once, after its root-first locks and in the same transaction as sequence
creation/insertion. Its `action_sequence` is 1 and the post-install and
bootstrap-open states are exactly `last_value = 1, is_called = true`; the next
runtime allocation is 2. `is_called` remains true in steady state. The verifier
unions all 30 sequence-backed columns, requires every stored value positive and
globally unique, the sentinel alone at 1, and the maximum stored value no
greater than observed `last_value`. Resetting to an uncalled state is forbidden.
The catalog has exactly one `origin = installation_seed`, `kind =
explicit_nextval` allocation naming that sentinel and column, with
`afterRootFirstLocks = true` and null `effectStepOrdinal`; every runtime arm is
also `explicit_nextval` and has a positive matching routine-effect step when it
inserts a managed row. Every fresh record-provider arm performs the guarded
four-column API-claim update on an already complete admission-time 0053 graph.
The nonterminal, later-same and later-different arms have zero allocation
records; only a first-terminal arm allocates and inserts R29. Evidence admission
always allocates R27 first and a later-different admission then allocates R24
and R22, in that order.

The sole approved cryptographic extension is relocatable `pgcrypto` version
`1.3` in schema `omnitwin_fdv1_ext`. V1 depends on exactly these two extension
members:

- `omnitwin_fdv1_ext.gen_random_bytes(pg_catalog.int4)`: C symbol
  `pg_random_bytes` from `$libdir/pgcrypto`, volatile, parallel-safe, strict,
  security-invoker, non-leakproof, returning `pg_catalog.bytea`; and
- `omnitwin_fdv1_ext.digest(pg_catalog.bytea,pg_catalog.text)`: C symbol
  `pg_digest` from `$libdir/pgcrypto`, immutable, parallel-safe, strict,
  security-invoker, non-leakproof, returning `pg_catalog.bytea`.

Extension owner, extension-schema owner and each member-routine owner are
separate environment facts and must not be inferred to be equal. The extension
schema owner has `USAGE, CREATE`; `omnitwin_fdv1_owner` has schema `USAGE` only;
all other managed identities and `PUBLIC` have neither. Installation revokes
`PUBLIC` EXECUTE from **all** routines in `omnitwin_fdv1_ext`, then grants the
V1 owner EXECUTE only on the two signatures above. The verifier enumerates the
full extension-schema routine surface and rejects any other PUBLIC or V1
identity EXECUTE path. Every call is schema-qualified; digest uses literal
algorithm `sha256`, never a caller-selected algorithm.

Every DB-issued evidence nonce and broker token is exactly one call to
`omnitwin_fdv1_ext.gen_random_bytes(32)` after locks. SQL hashes those 32 raw
bytes before insert; capability text is the canonical 43-character unpadded
base64url encoding. The target gateway's pre-admission claim token is the sole
non-DB-issued exception: its paired signer uses the pinned workload OS CSPRNG
and commits the hash before claim. `gen_random_uuid()` or concatenated UUIDs
are not a token/nonce substitute. Both CSPRNG paths, pgcrypto binary/package
identity and PostgreSQL/OpenSSL build identity are explicit TCB evidence.

Every path that inserts a managed V1 row resolves exact replay/conflict, takes
its complete root-first lock set and only then makes that row's explicit
sequence allocation. `fdv1_api_admit_evidence` allocates R27 after locks,
atomically commits the accepted provider-result row and its complete 0053 graph,
and, only for `later_different_terminal`, allocates and inserts R24 then R22.
Its numeric semantic preamble key `preamble:1` is distinct from accepted
mutation keys `accepted:1..13`; operation identity is the namespace and ordinal
together.
`fdv1_api_record_provider_result` never constructs or mutates that 0053 graph
and never inserts containment: every fresh arm only claims the existing
observation, first-terminal arms additionally allocate and insert R29, and all
other arms allocate no V1 sequence. Every arm returns the already allocated
selected R27 `admission_sequence`.
The catalog-format contract freezes the record path as seven exact branches and
nine operations: pre-root identity/membership/candidate effects, root-first
current-authority/replay locking and authorization, remaining ordered
graph enumeration, frozen-arm validation, post-lock claim-time/binding
derivation, the four-column observation claim, first-terminal-only R29
allocation and insert, read-only link/containment resolution, and exact write-
set closure/return. Its only write selectors are
`update:observation_api_claim` and, for first-terminal only,
`sequence_allocation:r29.action_sequence` plus
`insert:r29.first_terminal_link`. Each operation has an exact branch array and
closed unique guard array; guard IDs match by
`(operationNamespace,operationOrdinal,guardId)` and
may repeat across operations. Every
`(operationNamespace,operationOrdinal,branch)` must have one
semantic branch effect with exact applicability, AST, access, aggregate, write,
return and structured outcome bindings under `PR-R-001`. A continuation binds
the full non-null `(nextOperationNamespace,nextOperationOrdinal)` target;
return/error outcomes bind null for both target fields. A flat union fails.
ordinary `orderedSteps` remains the lock/sequence projection. The currently
absent expanded catalog and live routine make the frozen contract non-
authorizing.
There is no orphan allocation merely to mark a call. `action_sequence` is
ordering evidence, not signed external evidence: it is
included as `actionSequence`, a
canonical positive decimal string matching `^[1-9][0-9]*$`, in each SQL-
constructed canonical row/admission JSON and its domain-separated SHA, but
never in a signer-supplied payload. This includes the migration-installed
generation-1 bootstrap sentinel, whose canonical `actionSequence` is exactly
`"1"`. Existing canonical-shape and SHA guards are replaced where necessary to
include every column added by this manifest (including new UUID resource IDs,
authenticated caller/idempotency leaves and bounded custody values); no added
column is silently outside the row's closed canonical representation unless
this manifest explicitly calls it an integrity-only back-edge.

Every one of the 30 tables is owned by `omnitwin_fdv1_owner`, is append-only
except the explicitly frozen base-table projections in section 8, has
`UPDATE`, `DELETE`, and `TRUNCATE` denial triggers, and has no service-role or
`PUBLIC` table privilege. Canonical JSON columns are closed objects and are
paired with a domain-separated SHA. JSON is evidence/serialization, never a
substitute for a typed FK or authority predicate.

All composite FKs use `ON UPDATE RESTRICT ON DELETE RESTRICT`. FKs participating
in the one bootstrap cycle are `DEFERRABLE INITIALLY DEFERRED`; all others are
immediate unless the exact transaction graph requires a named deferred closure.
Every typed evidence projection references an `accepted` generic evidence row.
An `authenticated_structural_conflict` row cannot have a typed projection.

## 3. Exact relation set

1. `foundry_derivative_execution_activation_epochs_v1`
2. `foundry_derivative_candidate_relational_closures_v1`
3. `foundry_derivative_quarantine_storage_profiles_v1`
4. `foundry_derivative_quarantine_storage_profile_revocations_v1`
5. `foundry_derivative_executor_authorizations_v1`
6. `foundry_derivative_executor_authorization_revocations_v1`
7. `foundry_derivative_output_broker_authorizations_v1`
8. `foundry_derivative_output_broker_authorization_revocations_v1`
9. `foundry_derivative_output_custodian_authorizations_v1`
10. `foundry_derivative_custodian_auth_revocations_v1`
11. `foundry_derivative_execution_activations_v1`
12. `foundry_derivative_execution_activation_revocations_v1`
13. `foundry_derivative_prepared_request_sidecars_v1`
14. `foundry_derivative_provider_command_sidecars_v1`
15. `foundry_derivative_output_reservations_v1`
16. `foundry_derivative_submit_once_grants_v1`
17. `foundry_derivative_submit_once_redemptions_v1`
18. `foundry_derivative_recovery_authorities_v1`
19. `foundry_derivative_recovery_call_grants_v1`
20. `foundry_derivative_recovery_call_redemptions_v1`
21. `foundry_derivative_broker_object_uses_v1`
22. `foundry_derivative_execution_containment_events_v1`
23. `foundry_derivative_output_custody_v1`
24. `foundry_derivative_quarantine_security_events_v1`
25. `foundry_derivative_workload_authorizations_v1`
26. `foundry_derivative_workload_authorization_revocations_v1`
27. `foundry_derivative_authenticated_evidence_v1`
28. `foundry_derivative_runner_terminal_receipts_v1`
29. `foundry_derivative_terminal_result_links_v1`
30. `foundry_derivative_glb_verifier_receipts_v1`

## 4. Exact existing-table delta

`action_sequence bigint NOT NULL UNIQUE` is added to each relation 1-24. It is
the `database_sequence` returned for the action whose primary result is that
row. Derived sidecars/events receive their own later value but do not replace
the primary result sequence.

Every authorization reference below is a composite FK
`(authorization_id, authorization_sha256)` to relation 25. Every accepted
evidence reference carries `(evidence_id, payload_raw_sha256,
admission_sha256)` and uses that declared composite unique key on relation 27.
A named immediate CHECK or deferred arm guard separately fixes the required
`evidence_kind` and `disposition = 'accepted'`; PostgreSQL is never asked to FK
an implied literal. Typed-projection references use the projection's declared
`(id, receipt_sha256)` or `(id, link_sha256)` unique key. Any shorter evidence
reference in baseline 0058 is replaced by these columns, not treated as an
implicit FK.

### 4.1 Administrative and activation rows

- Relation 1 adds `id uuid NOT NULL UNIQUE`, `activation_caller_id uuid NULL`,
  `activation_caller_sha256 varchar(71) NULL`, `admin_evidence_id uuid NULL`,
  `admin_payload_raw_sha256 char(64) NULL`, and
  `admin_admission_sha256 varchar(71) NULL`. The five authorization/evidence
  columns (not the resource `id`) are null only for the
  exact migration-installed generation-1 disabled installation arm; every
  later disabled epoch requires an activation `db_caller` and accepted
  `admin_action`. Generation 1's UUID is a fixed literal in the source
  manifest; later epoch/profile UUIDs are DB-generated under locks and are the
  ordinary return record's `resource_id`. An enabled row cannot be installed
  by 0058. In both sentinel-only pre-bootstrap profiles this is the sole row
  across all 30 managed V1 tables. Its `action_sequence` is the sequence-
  allocated value 1, and its closed epoch JSON and digest include canonical
  `"actionSequence":"1"`; relations 2-30 contain zero rows. This exact policy
  is `v1ManagedRowsAreSentinelOnly = true`, not a claim that the PostgreSQL
  database, migration journal or projected external relations are empty.
- Relation 2 adds `activation_caller_id uuid NOT NULL`,
  `activation_caller_sha256 varchar(71) NOT NULL`,
  `predecessor_evidence_set_sha256 varchar(71) NOT NULL`,
  `api_request_sha256 varchar(71) NOT NULL`, and
  `api_idempotency_key varchar(160) NOT NULL`.
- Relation 3 adds `id uuid NOT NULL UNIQUE`,
  `maximum_result_custody_seconds integer NOT NULL`, `broker_caller_id uuid NOT
NULL`, `broker_caller_sha256 varchar(71) NOT NULL`,
  `storage_create_signer_id uuid NOT NULL`, `storage_create_signer_sha256
varchar(71) NOT NULL`, `custodian_caller_id uuid NOT NULL`,
  `custodian_caller_sha256 varchar(71) NOT NULL`, `storage_read_signer_id uuid
NOT NULL`, `storage_read_signer_sha256 varchar(71) NOT NULL`,
  `verifier_signer_id uuid NOT NULL`, `verifier_signer_sha256 varchar(71)
NOT NULL`, `infrastructure_evidence_id uuid NOT NULL`,
  `infrastructure_payload_raw_sha256 char(64) NOT NULL`, and
  `infrastructure_admission_sha256 varchar(71) NOT NULL`. The maximum is bounded from 1 through 86400 inclusive and covered
  by its profile JSON/SHA and infrastructure evidence. The three signer pairs
  are respectively the `storage_create`, `storage_read`, and `glb_verifier`
  evidence-signer arms and are paired in relation 25 to the exact broker or
  custodian caller named beside them. The infrastructure triple is accepted
  `predecessor_source` evidence for the complete profile material; baseline
  `infrastructure_receipt_sha256` is derived from that generic row's
  `receipt_sha256`, never accepted as digest-only proof. Relations 3, 5, and 11 add the activation caller pair plus
  `admin_evidence_id uuid NOT NULL`, `admin_payload_raw_sha256 char(64) NOT
NULL`, and `admin_admission_sha256 varchar(71) NOT NULL`. Relation 11 also
  adds `predecessor_evidence_set_sha256 varchar(71) NOT NULL`.
- Relations 4, 6, 8, 10, and 12 add the activation caller pair and the same
  accepted `admin_action` triple. Existing actor/user fields remain historical
  display facts and are not authentication.
- Relations 8 and 10 additionally add `compromise_not_before timestamptz(3)
  NULL` immediately after `reason_code`. Their exact reason union is
  `administrative_revocation|service_decommissioned` with a null compromise
  instant, or `security_compromise` with a required instant not later than
  `recorded_at`. Their only public writers are respectively
  `fdv1_api_revoke_broker_authorization(uuid,jsonb)` and
  `fdv1_api_revoke_custodian_authorization(uuid,jsonb)`. The effective boundary
  is `coalesce(compromise_not_before, recorded_at)`: exact typed-graph actions
  or admitted evidence at the boundary are affected, while rows strictly before
  a later boundary remain immutable historical evidence. Each source closure
  starts at the exact relation-7 or relation-9 authorization pair and cannot
  invoke workload/root fanout. With `B` equal to that boundary, the exact test
  is `B <= action_or_admission_time`. R8 tests only R7 `issued_at` (required to
  equal its `recorded_at`), R21 `authorized_at`, and accepted R27
  `storage_create.admitted_at`. R10 tests only R9 `valid_from` (required to
  equal its `recorded_at`) and accepted R27 `storage_read` or `glb_verifier`
  `admitted_at`; R30's copy equals its R27 parent. External observation/read
  times and later phase timestamps are not authorization-exercise clocks. The
  primary R8/R10 row receives the first action
  sequence and any derived relation-22 rows later values. Broker effects are
  `post_terminal_broker_deny` before accepted storage-create,
  `output_quarantine` after create/read/verifier work but before custody, and
  `post_custody_evidence_only` after relation 23. Custodian effects are
  `output_quarantine` before custody and `post_custody_evidence_only` after it.
  All have null `target_terminal_state`, create no provider stop intent and are
  unique for the exact attempt/fence/source. A valid revocation row is retained
  even when no historical graph row is affected; the authorization is still
  unusable for every future action. The existing unique target-authorization
  key is retained: a second key or caller for an already revoked target is
  `23505`, not an alternate replay path. Once any exact exercise is affected,
  the deepest locked graph state chooses the phase effect; later phase clocks do
  not retroactively affect a graph whose exercise clocks are all before `B`.
  Same-millisecond equality is affected without an action-sequence tie-breaker.
- Relation 5 additionally adds `submit_caller_id uuid NOT NULL`,
  `submit_caller_sha256 varchar(71) NOT NULL`, `runner_signer_id uuid NOT
NULL`, `runner_signer_sha256 varchar(71) NOT NULL`, `recovery_caller_id uuid
NOT NULL`, `recovery_caller_sha256 varchar(71) NOT NULL`,
  `provider_signer_id uuid NOT NULL`, and `provider_signer_sha256 varchar(71)
NOT NULL`, plus `predecessor_evidence_set_sha256 varchar(71) NOT NULL`. The caller pairs are the `db_caller/submit_gateway` and
  `db_caller/recovery_gateway` arms; the signer pairs are the corresponding
  `evidence_signer/runner_terminal` and `evidence_signer/provider_result` arms.
  Each signer is paired to the caller beside it in relation 25. The provider
  signer row's artifact/configuration digests equal this authorization's exact
  provider-adapter artifact/configuration digests. The activation therefore
  pins a provider signer rather than selecting an arbitrary current registry
  row during recovery. The predecessor-set SHA is SQL-derived from the complete
  accepted source-evidence set for the executor binding, adapter artifact/
  deployment, request profile and worker profile; caller-supplied digests are
  selectors, never proof.

### 4.2 Attempt, submit and recovery rows

- Relation 15 adds, in order, `planned_runner_receipt_id uuid NOT NULL`,
  `runner_challenge_id uuid NOT NULL`, `runner_nonce_sha256 varchar(71) NOT
NULL`, `runner_lease_issued_at timestamptz(3) NOT NULL`,
  `runner_lease_not_after timestamptz(3) NOT NULL`,
  `runner_phase_context_sha256 varchar(71) NOT NULL`, `runner_signer_id uuid
NOT NULL`, and `runner_signer_sha256 varchar(71) NOT NULL`. Receipt,
  challenge and nonce are each unique; issue is strictly before expiry.
- Relation 16 adds `claimer_caller_id uuid NOT NULL`,
  `claimer_caller_sha256 varchar(71) NOT NULL`, `target_gateway_caller_id uuid
NOT NULL`, `target_gateway_caller_sha256 varchar(71) NOT NULL`,
  `token_commitment_evidence_id uuid NOT NULL`,
  `token_commitment_payload_raw_sha256 char(64) NOT NULL`, and
  `token_commitment_admission_sha256 varchar(71) NOT NULL`. The evidence kind
  is `gateway_token_commitment`; one commitment is consumed by at most one
  grant. The locked base command's `claim_token uuid` and the grant's copied
  claim-token field both equal `token_commitment_evidence_id`; its secret-token
  SHA equals the evidence payload's `token_sha256`. `claimed_by` is derived from
  the target gateway binding, never the claimer.
- Relation 17 adds `submit_caller_id uuid NOT NULL` and
  `submit_caller_sha256 varchar(71) NOT NULL`.
- Relation 18 replaces the bare recovery workload as authority with
  `creator_caller_id uuid NOT NULL` and `creator_caller_sha256 varchar(71) NOT
NULL`; the old digest remains a derived historical copy.
- Relation 19 adds `claimer_caller_id uuid NOT NULL`,
  `claimer_caller_sha256 varchar(71) NOT NULL`,
  `target_recovery_caller_id uuid NOT NULL`,
  `target_recovery_caller_sha256 varchar(71) NOT NULL`,
  `provider_signer_id uuid NOT
NULL`, `provider_signer_sha256 varchar(71) NOT NULL`,
  `token_commitment_evidence_id uuid NOT NULL`,
  `token_commitment_payload_raw_sha256 char(64) NOT NULL`,
  `token_commitment_admission_sha256 varchar(71) NOT NULL`,
  `planned_provider_evidence_id uuid NOT NULL`, `planned_observation_id uuid
NOT NULL`, `planned_completion_event_id uuid NOT NULL`,
  `planned_classification_id uuid NOT NULL`, and `planned_terminal_link_id uuid
NOT NULL`. Each planned ID is globally unique in this relation. Its target
  recovery caller and provider signer are copied from the locked relation-5
  executor authorization; the signer's relation-25 paired caller must be that
  same target. The claim function has no signer selector and cannot substitute
  another current `provider_result` signer. Its locked base command and grant
  use the same commitment-evidence UUID as their non-secret claim handle and
  copy only the evidence-bound redemption-token SHA.
- Relation 20 copies those five planned IDs and adds `recovery_caller_id uuid
NOT NULL`, `recovery_caller_sha256 varchar(71) NOT NULL`,
  `provider_signer_id uuid NOT NULL`, `provider_signer_sha256 varchar(71) NOT
NULL`, `result_challenge_id uuid NOT NULL`, `result_nonce_sha256 varchar(71)
NOT NULL`, `result_challenge_issued_at timestamptz(3) NOT NULL`,
  `result_challenge_not_after timestamptz(3) NOT NULL`, and
  `result_phase_context_sha256 varchar(71) NOT NULL`. Planned IDs, challenge
  and nonce are unique; issue is strictly before expiry.

### 4.3 Broker, read, verifier and custody rows

- Relation 7 adds `broker_caller_id uuid NOT NULL`,
  `broker_caller_sha256 varchar(71) NOT NULL`, `runner_receipt_id uuid NOT
NULL`, `runner_receipt_sha256 varchar(71) NOT NULL`, `terminal_link_id uuid
NOT NULL`, and `terminal_link_sha256 varchar(71) NOT NULL`. Both referenced
  typed rows must be success arms for the same reservation/attempt/fence/slot.
  The broker caller is copied from the locked relation-3 storage profile via
  closure/reservation; issuance has no caller/signer selector. Its one sampled
  DB instant populates both legacy `issued_at` and `recorded_at`, which are
  constrained equal.
- Relation 21 adds `broker_caller_id uuid NOT NULL`,
  `broker_caller_sha256 varchar(71) NOT NULL`,
  `planned_storage_create_evidence_id uuid NOT NULL`,
  `storage_create_challenge_id uuid NOT NULL`,
  `storage_create_nonce_sha256 varchar(71) NOT NULL`,
  `storage_create_issued_at timestamptz(3) NOT NULL`,
  `storage_create_not_after timestamptz(3) NOT NULL`,
  `storage_create_context_sha256 varchar(71) NOT NULL`, `storage_signer_id uuid
NOT NULL`, and `storage_signer_sha256 varchar(71) NOT NULL`. Planned evidence,
  challenge and nonce are unique; issue is strictly before expiry.
  The broker caller and storage-create signer are copied from relation 3 and
  must equal its explicit cross-root pairing policy.
- Relation 9 replaces caller-supplied create/read proof as authority and adds
  `custodian_caller_id uuid NOT NULL`, `custodian_caller_sha256 varchar(71) NOT
NULL`, `storage_signer_id uuid NOT NULL`, `storage_signer_sha256 varchar(71)
NOT NULL`, `verifier_signer_id uuid NOT NULL`, `verifier_signer_sha256
varchar(71) NOT NULL`, `storage_create_evidence_id uuid NOT NULL`,
  `storage_create_payload_raw_sha256 char(64) NOT NULL`,
  `storage_create_admission_sha256 varchar(71) NOT NULL`, `runner_receipt_id
uuid NOT NULL`, `runner_receipt_sha256 varchar(71) NOT NULL`,
  `terminal_link_id uuid NOT NULL`, `terminal_link_sha256 varchar(71) NOT NULL`,
  `planned_storage_read_evidence_id uuid NOT NULL`, `storage_read_challenge_id
uuid NOT NULL`, `storage_read_nonce_sha256 varchar(71) NOT NULL`,
  `storage_read_issued_at timestamptz(3) NOT NULL`, `storage_read_not_after
timestamptz(3) NOT NULL`, `storage_read_context_sha256 varchar(71) NOT NULL`,
  `planned_verifier_evidence_id uuid NOT NULL`, `planned_verifier_receipt_id
uuid NOT NULL`, `verifier_challenge_id uuid NOT NULL`,
  `verifier_nonce_sha256 varchar(71) NOT NULL`, `verifier_issued_at
timestamptz(3) NOT NULL`, `verifier_not_after timestamptz(3) NOT NULL`,
  `verifier_context_sha256 varchar(71) NOT NULL`,
  `maximum_verification_seconds integer NOT NULL`,
  `maximum_result_custody_seconds integer NOT NULL`,
  `result_context_sha256 varchar(71) NOT NULL`, and
  `result_authority_not_after timestamptz(3) NOT NULL`. The two evidence IDs,
  receipt ID, challenge IDs and nonces are pairwise distinct and individually
  unique. Each issue time precedes its expiry.
  `maximum_verification_seconds` is from 1 through 300 inclusive;
  `maximum_result_custody_seconds` is from 1 through 86400 inclusive and equals
  the locked relation-3 value.
  Its one authorization DB instant populates both legacy `valid_from` and
  `recorded_at`, which are constrained equal.
  The custodian caller, storage-read signer and verifier signer are copied from
  relation 3; the authorize-read function accepts none of those identifiers.
  Its legacy `create_receipt_id` is a derived alias equal to
  `storage_create_evidence_id`; `create_receipt_sha256` equals the referenced
  generic row's `receipt_sha256`; `create_receipt_json` equals that row's closed
  `payload_json`; and `planned_read_receipt_id` equals
  `planned_storage_read_evidence_id`. Named equality guards reject two
  independent create/read identities.

The four challenge-context byte strings are SQL-constructed canonical JCS, not
caller input and not an unconstrained JSON return. Relation 20's
`result_phase_context_sha256`, relation 21's
`storage_create_context_sha256`, and relation 9's
`storage_read_context_sha256`/`verifier_context_sha256` equal the domain hashes
of their exact callable-API context schemas. Redeem/authorize returns the
nonsecret bytes/SHA with the one-time nonce. The two read-only context functions
reconstruct them under the same graph locks; provider context adds the uniquely
planned relation-28 arm, and final verifier context adds the uniquely planned
accepted storage-read triple. No service table SELECT or caller-supplied
evidence selector is involved.

- Relation 23 adds typed composites for `runner_receipt_id`,
  `runner_receipt_sha256`, `terminal_link_id`, `terminal_link_sha256`,
  `storage_create_evidence_id`, `storage_create_payload_raw_sha256`,
  `storage_create_admission_sha256`, `storage_read_evidence_id`,
  `storage_read_payload_raw_sha256`, `storage_read_admission_sha256`,
  `glb_verifier_receipt_id`, and `glb_verifier_receipt_sha256`. Existing
  custody evidence also adds `maximum_result_custody_seconds integer NOT NULL`,
  `terminal_link_db_time timestamptz(3) NOT NULL`, and
  `result_authority_not_after timestamptz(3) NOT NULL`. The maximum must equal
  the locked storage profile/custodian authorization and the horizon is the
  strict least boundary including `terminal_link_db_time +
maximum_result_custody_seconds * interval '1 second'`. Existing
  validity booleans, manifests, times and disposition remain only as values
  derived by the custody function from these FKs; no public input maps to them.
  Its legacy `create_receipt_id/create_receipt_sha256` are derived aliases of
  the referenced storage-create evidence ID/`receipt_sha256`; legacy
  `read_receipt_id/read_receipt_sha256/read_receipt_json` are derived aliases of
  the referenced storage-read evidence ID/`receipt_sha256`/closed
  `payload_json`. Deferred equality guards and the evidence triples make it
  impossible to carry a second receipt identity.
- Relation 22 adds `phase_effect varchar(40) NOT NULL`,
  `caller_authorization_id uuid NOT NULL`, `caller_authorization_sha256
varchar(71) NOT NULL`, and nullable `source_evidence_id uuid`,
  `source_payload_raw_sha256 char(64)`, `source_admission_sha256 varchar(71)`.
  The three source-evidence fields are all-null or all-non-null according to
  the exact source branch. `phase_effect` is one of `pre_submit_deny`,
  `provider_stop`, `post_terminal_broker_deny`, `output_quarantine`, or
  `post_custody_evidence_only`.
- Relation 24 adds `caller_authorization_id uuid NOT NULL` and
  `caller_authorization_sha256 varchar(71) NOT NULL`; evidence-origin events
  also add the same optional all-or-none source-evidence triple as relation 22.

Relation 13 adds `activation_caller_id uuid NOT NULL` and
`activation_caller_sha256 varchar(71) NOT NULL`. Relation 14 instead adds the
generic `caller_authorization_id uuid NOT NULL` and
`caller_authorization_sha256 varchar(71) NOT NULL`; its submit arm requires an
activation caller and its recovery arm a recovery caller. Their canonical
sidecars bind the reservation runner challenge and, for recovery commands, the
result plan.

### 4.4 Exact idempotency persistence

Every idempotency-bearing public mutator and the bootstrap call that commits has
one durable primary row containing its canonical `api_request_sha256`,
authenticated caller authorization pair (or the exact bootstrap discriminator)
and operation-scoped idempotency key. The unique key is
`(caller_authorization_id, api_idempotency_key)` when the relation represents
one function, and includes the stated operation discriminator when it
represents more than one. Exact replay compares the request SHA before returning
the original row; mismatch is `23505` and mutates nothing. The two read-only
context functions accept no idempotency key, insert no row and allocate no
sequence; their exact existing sequence sources are frozen in callable API
section 5.8.

The repair migration must remove every baseline key that scopes replay to a
display actor, administrator user, or globally shared provider key. Retaining
any of the following constraints alongside the caller-scoped replacement is a
catalog rejection because it can turn two independent authenticated callers
into an unintended cross-caller `23505` conflict:

| Relation | Drop baseline constraint | Install exact replacement |
| --- | --- | --- |
| 1 | `fdv1_epoch_actor_idem_uq` | partial unique index `fdv1_epoch_caller_idem_uq` on `(activation_caller_id, idempotency_key)` where `activation_caller_id IS NOT NULL` |
| 3 | `fdv1_storage_actor_idem_uq` | unique constraint `fdv1_storage_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 4 | `fdv1_storage_revoke_actor_uq` | unique constraint `fdv1_storage_revoke_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 5 | `fdv1_executor_actor_idem_uq` | unique constraint `fdv1_executor_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 6 | `fdv1_executor_revoke_actor_uq` | unique constraint `fdv1_executor_revoke_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 8 | `fdv1_broker_revoke_actor_uq` | unique constraint `fdv1_broker_revoke_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 10 | `fdv1_custodian_revoke_actor_uq` | unique constraint `fdv1_custodian_revoke_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 11 | `fdv1_activation_actor_idem_uq` | unique constraint `fdv1_activation_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 12 | `fdv1_activation_revoke_actor_uq` | unique constraint `fdv1_activation_revoke_caller_idem_uq` on `(activation_caller_id, idempotency_key)` |
| 17 | `fdv1_submit_redeem_external_uq` | unique constraint `fdv1_submit_redeem_caller_external_uq` on `(submit_caller_id, external_idempotency_key)` |
| 20 | `fdv1_recovery_redeem_provider_uq` | unique constraint `fdv1_recovery_redeem_caller_provider_uq` on `(recovery_caller_id, provider_idempotency_key)` |

Those are replacements, not additional uniqueness layers. The catalog verifier
must prove all eleven old constraint names absent, all eleven replacement
objects present with the exact key order/predicate above, and no equivalent
legacy unique index remaining under another name.

The required additions/source mappings are:

- relations 1, 3-6, 8, and 10-12 add `api_request_sha256 varchar(71) NOT NULL`;
  their existing `idempotency_key` is the API key, and the caller pair is the
  one already added above;
- relation 2's added `api_request_sha256` and `api_idempotency_key` are unique
  with its activation caller pair;
- relations 13 and 15 add `api_request_sha256 varchar(71) NOT NULL` and
  `api_idempotency_key varchar(160) NOT NULL`, unique with their activation
  caller;
- relation 14 adds `api_operation varchar(32) NOT NULL`,
  `api_request_sha256 varchar(71) NOT NULL`, and `api_idempotency_key
varchar(160) NOT NULL`, unique on `(caller_authorization_id, api_operation,
api_idempotency_key)`; operation is `enqueue_submit` or `enqueue_recovery`;
- relation 16 adds `api_request_sha256 varchar(71) NOT NULL` and
  `api_idempotency_key varchar(160) NOT NULL`, unique with its claimer;
- relation 17 adds `api_request_sha256 varchar(71) NOT NULL`; its existing
  `external_idempotency_key` is the API key and is unique with the submit
  caller;
- relation 18 adds `recovery_caller_id uuid NOT NULL`,
  `recovery_caller_sha256 varchar(71) NOT NULL`, `api_request_sha256
varchar(71) NOT NULL`, and `api_idempotency_key varchar(160) NOT NULL`, unique
  with the recovery caller;
- relation 19 adds `api_request_sha256 varchar(71) NOT NULL` and
  `api_idempotency_key varchar(160) NOT NULL`, unique with its claimer;
  a deferred cross-table guard rejects reuse of one claimer/key with a
  different request across relations 16 and 19 because both are arms of
  `fdv1_api_claim_command`;
- relation 20 adds `api_request_sha256 varchar(71) NOT NULL`; its existing
  `provider_idempotency_key` is the API key and is unique with the recovery
  caller;
- relations 7, 9, 21, and 23 add `api_request_sha256 varchar(71) NOT NULL` and
  `api_idempotency_key varchar(160) NOT NULL`, unique with their broker or
  custodian caller pair;
- relation 25 adds nullable `activation_caller_id uuid` and
  `activation_caller_sha256 varchar(71)` as specified in section 5.1. They are
  non-null for every runtime registration and a partial unique index covers
  `(activation_caller_id, api_idempotency_key)`; both are null on every
  bootstrap-enumerated secondary row, whose call replays through relation 27;
- relation 27's existing API request/key columns are unique with its admitter.
  Lookup by `(admitter_authorization_id, api_idempotency_key)` precedes the
  submission fingerprint: equal request SHA returns that row, changed request
  SHA is `23505`, and byte-identical content under a different key is also
  `23505` rather than an unpersisted alias. The bootstrap special arm instead
  looks up `(purpose = 'installation_seed', api_idempotency_key)` before the
  sentinel-only-state gate; equal request returns the original row, mismatch is
  `23505`, and only a genuinely new key is tested against the one-time
  precondition. Relations 28 and 30 replay through their parent relation-27
  row;
- evidence admission persists the caller pair, selected-evidence triple and
  frozen branch on the new 0053 observation; `fdv1_api_record_provider_result`
  later fills only API key/request, V1 API-binding SHA and API claim time in the
  dedicated nullable columns defined in section 4.5. A partial unique index on
  the dedicated caller ID/non-null API key implements replay. Existing
  0053 `actor_key`, deterministic internal `idempotency_key`, internal
  `request_digest`, their CHECK/unique constraint and guard derivation remain
  unchanged; none is repurposed as a public API field. The API's returned
  `database_sequence` is the processed evidence row's immutable
  `admission_sequence` and `database_time` is the observation's immutable
  `fdv1_api_claimed_at`; terminal relation 29 additionally copies
  `recovery_caller_id`, `recovery_caller_sha256`, `api_request_sha256`, and
  `api_idempotency_key`. Every accepted provider result already has its complete
  admission-materialized 0053 graph. Every fresh selected row claims that graph;
  first-terminal additionally creates relation 29, later-same creates no V1
  managed row, and later-different validates its mandatory existing security
  closure while returning only the conflict status and canonical link.
  Exact replay returns the originally stored branch without rescanning; and
- relation 24 adds `api_operation varchar(32) NULL`, `api_request_sha256
varchar(71) NULL`, `api_idempotency_key varchar(160) NULL`,
  `request_source_kind varchar(80) NULL`, `request_source_id text NULL`,
  `affected_count integer NULL`, `scan_limit integer NULL`,
  `scan_cutoff_at timestamptz(3) NULL`, `scanned_count
integer NULL`, `contained_count integer NULL`, and `conflict_count integer
NULL`. `fdv1_api_contain_source` always appends a
  `contain_source_receipt`; `fdv1_api_watchdog_scan` always appends a
  `watchdog_scan_receipt`, even when every count is zero. Registration namespace
  collision appends exactly one `register_storage_profile_denial_receipt`, which
  is both the committed security result and the API primary row; no second
  ordinary security event is inserted. Each request-receipt arm requires its
  exact fields below and is unique on `(caller_authorization_id, api_operation,
  api_idempotency_key)`. Ordinary security events require those fields null.
  Relation-22 containment rows use the applicable receipt UUID as correlation
  ID.

The baseline `fdv1_security_event_closed_ck` is removed and replaced by the
following four-arm CHECK; the baseline non-null columns remain non-null:

- `quarantine_security_event`: `event_kind` is that literal; severity is
  `high` or `critical`; state is `detected`, `contained`, or `retained`;
  `offending_table`, `reason_code`, caller pair and correlation ID are required,
  while `offending_row_id` remains nullable; all API/request/count/cutoff columns are
  null. Actor kind is `service`, `watchdog`, or `system` and is derived from the
  invoking authenticated plane or fixed internal branch.
- `contain_source_receipt`: severity is `info`, state is `retained`,
  `offending_table = 'foundry_derivative_execution_containment_events_v1'`,
  `offending_row_id = request_source_id`, `reason_code =
'contain_source_completed'`, actor kind is `watchdog`, and `correlation_id =
id`. API operation is `contain_source`; request SHA/key, source kind/source ID,
  and affected/contained/conflict counts are non-null; scan limit/scanned count,
  scan cutoff, phase identity columns and source-evidence triple are null. All counts are
  non-negative and `affected_count = contained_count + conflict_count`.
- `watchdog_scan_receipt`: severity is `info`, state is `retained`,
  `offending_table = 'foundry_derivative_quarantine_security_events_v1'`,
  `offending_row_id IS NULL`, `reason_code = 'watchdog_scan_completed'`, actor
  kind is `watchdog`, and `correlation_id = id`. API operation is
  `watchdog_scan`; request SHA/key, scan limit, millisecond
  `scan_cutoff_at` and scanned/contained/conflict counts are non-null;
  `scan_cutoff_at <= recorded_at`; source/affected, phase identity and
  source-evidence columns are null.
- `register_storage_profile_denial_receipt`: severity is `critical`, state is
  `retained`, `event_kind` is that literal, `reason_code =
  'quarantine_profile_namespace_overlap'`, `correlation_id = id`, and actor kind
  is `service`. API operation is `register_storage_profile`; caller pair,
  request SHA/key, matched public `offending_table`/`offending_row_id`, requested
  bucket/root-prefix `namespace_identity`, and the accepted `admin_action`
  source-evidence triple are non-null. Request-source, count, cutoff, custody
  and phase identity fields are null. Its actor key is the canonical activation-caller
  authorization identity derived from the authenticated session.

The contain-source and watchdog-scan receipt arms use the canonical watchdog
actor key and require
`namespace_identity`, `custody_id`, `activation_id`, `execution_id`,
`attempt_id`, and `fencing_token` null because one request can affect zero or
many subjects. Their closed `event_json` objects contain exactly schema version,
event kind, caller authorization ID/SHA, operation, request SHA, idempotency key,
the arm-specific source or scan-limit fields, watchdog-only `scanCutoffAt`, the three applicable counts,
correlation ID, action sequence, and DB-recorded time. The security arm's
`event_json` instead contains its exact typed security leaves and none of the
request-receipt leaves. The profile denial selects exactly one overlap ordered
by `(table_name COLLATE "C", row_identity COLLATE "C") LIMIT 1` and sets
`namespace_identity = bucket || '/' || root_prefix`. Its `event_json` uses
schema/hash domain `omnitwin.foundry.derivative-quarantine-security-event.v1`
and contains exactly, in canonical-object semantics,
`schemaVersion,eventKind,severity,state,offendingTable,offendingRowId,reasonCode,
namespaceIdentity,callerAuthorizationId,callerAuthorizationSha256,
sourceEvidenceId,sourcePayloadRawSha256,sourceAdmissionSha256,operation,
requestSha256,idempotencyKey,actorKind,actorKey,correlationId,actionSequence,
recordedAt`; `correlationId = id`. It has no custody, phase, request-source or
count leaf. The
existing broad dedupe key does not implement API replay; a separate unique
index covers `(caller_authorization_id, api_operation, api_idempotency_key)`
where `api_operation IS NOT NULL`.

A root-locked cross-table guard covers relation-3 success rows and only the
relation-24 profile-denial arm for one activation caller/idempotency key. It
resolves either arm before namespace scanning, compares the stored request SHA,
returns the stored result on equality and raises `23505` on changed reuse. A new
collision inserts the denial receipt without attempting the profile insert;
exact replay never rescans mutable external namespaces.

The scan limit is 1 through 1000. Scan counts are non-negative,
`scanned_count = contained_count + conflict_count`, and `scanned_count <=
scan_limit`. The counted unit for both APIs is the exact containment obligation
`(source_kind, source_id, source_sha256, activation_id, execution_id,
attempt_id, fencing_token, phase_effect)` plus its implied target state,
source-evidence binding, historically valid actor binding and stop closure.
`contained_count` means newly inserted;
`conflict_count` means an exact pre-existing closure re-read and fully matched,
not a semantic mismatch. A new closure uses the current watchdog caller; an
existing closure is checked against its own stored caller authorization and
that caller's validity at the original receipt time, never against the current
scanning caller. Any occupied unique key with different semantic closure facts
or invalid historical caller is
`23514` and rolls back the request receipt and all changes. Exact scan replay
returns the stored counts/sequence/time and does not rescan. Thus a zero-effect
call is not an unrecorded exception to the common protocol.

The watchdog scan readiness boundary uses callable-API section 5.7's frozen
four-row deepest-phase cursor intent/summary, two source classes, synthetic-
expiry object/digest, per-attempt winner and global ordering. Those four labels
are not executable cursor predicates or implementation authority. Replay
identity may be located first, but no replay returns before the common locked
current-authority check; the global root is locked; one
millisecond selection-only `scan_cutoff_at` is sampled and persisted; due
candidates are derived; selected source/attempt graphs are locked and rechecked
in the same canonical order; and only then is the distinct post-lock
`database_time = recorded_at` sampled and the final-count request receipt
inserted. `due_at <= scan_cutoff_at` is inclusive. The cutoff is not an action
time and satisfies `scan_cutoff_at <= recorded_at`.
There is no `SKIP LOCKED`. The initial query excludes already completely
satisfied obligations, so a fresh idempotency key cannot repeatedly count old
closures; `conflict_count` exists only for an exact final-lock reread race.
`scan_limit` bounds selected obligation tuples, not source rows or attempts
examined.

Only the watchdog may synthesize `derivative_authority_expired`. Its source ID
is `expiry:` plus the 64 lower-case hex characters of the exact domain-separated
source SHA, and its member/source objects contain decimal-string integer leaves
and the closed shape/order from callable section 5.7. An inline future
`foundry_rights_policy_versions.revoked_at` is instead a specific
`base_policy_revocation` subarm keyed by `policy_version:generation` with
`policy_evidence_sha256` as its source SHA; it is not passive expiry. Immediate
revocation/compromise/kill/security sources close synchronously and are never
scan candidates. The exact machine-readable passive-member and scheduled-
source relation/key/SHA/due-time/applicability matrices, executable cursor-state
predicates, two-clock catalog effects and historical-caller checks are still
absent and deliberate NO-GO blockers. The current R1 `fdv1_epoch_shape_ck` additionally
requires `effective_at <= recorded_at`, which makes the proposed future
derivative-epoch scheduled arm impossible without a new audited schema decision;
the new R1 UUID is not an implicit historical source ID. The catalog readiness
object records the complete gap set as `WD-B-001` through `WD-B-008`; WD-B-008
requires the executable predicates bound to the live routine AST/effects, a
live catalog match and the complete vector suite. It also names thirteen
mandatory `rejectWatchdog*` negatives. Neither this prose, an unfrozen matrix
nor a materialized `authority_not_after` permits an implementation to invent a
positive path.

The provider-result later-different branch is an ordinary
`quarantine_security_event`, not a fifth request-receipt arm. It requires
severity `critical`, reason code `provider_terminal_result_conflict`,
`offending_table = 'foundry_derivative_authenticated_evidence_v1'`,
`offending_row_id` equal to the current accepted relation-27 `ledger_row_id`,
the current provider-evidence ID/payload-raw/admission triple, the recovery
caller and exact activation/execution/attempt/fence, and `correlation_id = id`.
It is `contained` before custody and `retained` after custody. A later-sequenced
relation-22 row has `source_kind = 'quarantine_security_event'`, names that
exact event, retains the provider-evidence triple, has null target terminal
state and stop intent, and derives only `post_terminal_broker_deny`,
`output_quarantine`, or `post_custody_evidence_only` from the deepest locked
graph. When relation 29 already exists, `pre_submit_deny` and `provider_stop`
are forbidden. When relation 29 does not yet exist, the frozen
first-terminal owner R27 plus its complete 0053 graph is the terminal barrier;
no storage/custody chain can then exist, so the effect is exactly
`post_terminal_broker_deny` and those two pre-terminal effects remain forbidden.
The R24/R22 source and reverse closures are exact; a non-identical occupied key
is `23514` and rolls the entire evidence-admission transaction back. Admission
allocates R24 first and R22 next after the current R27 admission sequence. The
later result API claim allocates neither and still returns the selected R27
sequence.

The baseline `fdv1_containment_closed_ck` is removed and replaced. Relation
22's `target_terminal_state` becomes nullable. Its exact source-kind set is:

```text
derivative_policy_revocation
derivative_policy_generation_superseded
base_policy_revocation
base_policy_generation_superseded
registry_attestation_revocation
workload_authorization_revocation
executor_authorization_revocation
output_broker_authorization_revocation
output_custodian_authorization_revocation
quarantine_storage_profile_revocation
activation_revocation
activation_epoch_disabled
activation_epoch_replaced
derivative_authority_expired
global_or_scoped_kill
runner_terminal_failure
quarantine_security_event
```

`pre_submit_deny` and `provider_stop` require
`target_terminal_state = 'terminal_killed'`. `post_terminal_broker_deny`,
`output_quarantine`, and `post_custody_evidence_only` require
`target_terminal_state IS NULL`; they cannot rewrite an already terminal
attempt. The replacement CHECK retains ordinal/fence, digest, actor and
canonical-JSON checks and enforces the all-or-none source-evidence composite.
Named deferred source closures enforce the exact source-to-affected-set matrix;
`workload_authorization_revocation` is not a catch-all.

`runner_terminal_failure` is accepted only from the relation-28 `failed` arm
and requires its evidence ID/payload-raw/admission triple. In the same admission
transaction, after the projection is inserted, SQL appends the fixed
`quarantine_security_event` and exact relation-22 containment row. If no
terminal provider link exists, its phase effect is `provider_stop`; if a locked
terminal-failure link already exists, it is `post_terminal_broker_deny`. It can
never be pre-submit, success, output or custody evidence. A later authenticated
provider terminal-failure may reference this historical failed receipt, but
does not erase or replace the admission-derived containment.

The baseline `fdv1_custody_closed_ck` is also removed and replaced. Relation
23 adds `conflict_detected boolean NOT NULL`. Legacy `glb_magic`, `glb_version`
and `glb_declared_length` become nullable derived partial-witness columns;
their nullability follows the referenced verifier receipt. All exact object,
read, successful runner, terminal-link, manifest, lineage and policy fields
remain non-null and derived. `result_valid` is always true because a failed
runner/provider arm cannot reach custody. The four disposition arms, in strict
priority order, are:

1. `quarantined_invalid`: `content_valid = false`; structural validity may be
   false or semantic replay may be invalid, and authority/conflict values do
   not override invalidity;
2. `quarantined_conflict`: `content_valid = true` and `conflict_detected =
true`;
3. `quarantined_late_authority`: content/result valid, no conflict,
   `public_reverse_scan_clear = true`, and `authority_current = false`; and
4. `quarantined_current_authority`: content/result valid, no conflict, clear
   reverse scan, and current authority.

R23 is the primary row and receives the first action sequence.
`quarantined_invalid`, `quarantined_conflict`, and
`quarantined_late_authority` then insert exactly one R24
`quarantine_security_event` with reason code `custody_content_invalid`,
`custody_object_conflict`, or `custody_result_authority_late` respectively,
then one later-sequenced R22 row whose source is that exact R24 event and whose
phase effect is `post_custody_evidence_only`. Target terminal state and stop
intent are null. `quarantined_current_authority` inserts neither derived row.
The R24 custody/event/source closure and R22 source closure are unique and exact;
replay emits nothing, while a non-identical occupied key is `23514` and rolls
back. A missing/wrong input identity cannot reach this graph: malformed or
unauthenticated material creates no V1 row, and an authenticated relational
conflict was already retained by the relation-27 admission arm.

If valid content has no object conflict but the public reverse scan is not
clear, `conflict_detected` is derived true and arm 2 applies. For structure-
valid/semantic-invalid evidence, legacy magic/version/declared length are
non-null and exact; for structure-invalid evidence, each is populated only if
the deterministic partial witness established it. A named deferred guard
compares every boolean/partial field to relation 30 and the exact create/read/
runner/link graph. All release/sign/publication/redistribution/public-serving/
runtime flags remain false in every arm.

This is an explicit replacement of the activation draft section-12 rule that
classified every public reverse-scan match as `quarantined_invalid`. A reverse-
scan match does not make authenticated object bytes structurally/semantically
invalid; it is an external namespace/publication conflict and therefore takes
the higher-priority `quarantined_conflict` arm after actual content invalidity.
The same security event/containment and absolute release/public/runtime denials
remain mandatory.

### 4.5 Provider-result admission materialization and API claim/replay

Relation 27 stores four additional nullable columns immediately after
`result_tuple_sha256`:

```text
provider_result_branch varchar(40) NULL
terminal_owner_evidence_id uuid NULL
terminal_owner_payload_raw_sha256 char(64) NULL
terminal_owner_admission_sha256 varchar(71) NULL
```

They are non-null only as follows for an accepted `provider_result`. A
nonterminal row has branch `nonterminal` and a null owner triple. The earliest
accepted terminal row in one `(activation,attempt,fence,output-slot)` scope,
ordered by `(admission_sequence,evidence_id)` with UUID byte order, has branch
`first_terminal_success` or `first_terminal_failure` and a null owner triple.
Every later accepted terminal row has branch `later_same_terminal` or
`later_different_terminal` and an immediate composite FK owner triple naming
that exact earlier first-terminal relation-27 row. The later branch is equality
or inequality of their recomputed terminal tuples. The branch and owner triple
are included in the closed admission JSON/SHA; other evidence kinds and retained
conflict rows require all four columns null. Root-first serialization makes the
owner choice immutable even before relation 29 is materialized.

Before inserting an accepted provider-result row, evidence admission derives
the exact 0053 observation, command outcome/completion, completion event and
classification from the authenticated payload and locked command/invocation/
attempt graph. It also derives the result state/tuple, assigns the new R27
sequence, and freezes the branch and any first-terminal owner. Every accepted
typed graph, including a semantically nonterminal or later-different one,
requires the command-local prospective classification to be exactly
`already_authoritative` or `late_eligible`. Installed 0053
`terminal_conflict` means that this observation contradicts its own immutable
command completion; it is not the cross-command R27 tuple comparator.
`terminal_conflict`, `not_eligible`, or any other mismatch therefore takes
R27's retained `authenticated_structural_conflict` arm and creates no typed
0053 graph or R29. It follows the generic authenticated-structural-conflict
security/containment policy, not the accepted later-different provider-terminal
closure. Cross-command tuple inequality alone selects the accepted
`later_different_terminal` branch and its mandatory R24→R22 closure.

The only admissible recovery command kinds are `provider_reconcile`,
`provider_poll`, and `provider_stop`, and the exact claim must have an invocation
event. The minimal future V1-aware command policy has two arms. In the live arm,
evidence admission is the sole conclusive observation/completion owner: after
prelocking the complete installed-guard superset it inserts the planned
observation with all six admission fields, derives the exact 12-key command
outcome from that observation, completes the claimed command as `succeeded` or
`failed` with `completedBy = {service, command.claimed_by}`, inserts the planned
completion event and planned classification, and requires
`already_authoritative`. The installed completion expression is
`GREATEST(command_guard_clock, old_command.updated_at + interval '1
microsecond')` and must be strictly earlier than `claim_expires_at`; equality is
expired custody and cannot use the service arm.

The sole pre-existing arm is a separately authenticated V1-aware watchdog
closure for an invoked expired claim. It is immutable `uncertain/unknown`, uses
outcome code `claim_lease_expired_effect_unknown`, derives its internal evidence
SHA under `omnitwin.foundry.provider-command-internal-evidence.v0`, has
`provider_command_ref IS NOT DISTINCT FROM target_provider_ref`, records
`completedBy.actorKind = watchdog` and the authenticated watchdog caller's exact
`db_session_role`, and has `completed_at >= claim_expires_at`. Before R27
exists, the watchdog sources the completion-event ID through the exact locked
chain `command claim ↔ R19 grant ↔ R20 redemption/actual call event ↔
provider_invocation_started`; R19 and R20 must carry the same planned completion
event ID, and the event uses it explicitly. A later accepted R27 must copy that
same R19/R20 planned ID. No observation or classification may yet exist for the
command claim. Admission later inserts the planned observation/classification and
requires `late_eligible`; it validates the immutable completion event's
historical revision prefix rather than demanding that the current attempt or
execution still equal the old projection. An expired but still-open claim makes
admission roll back without R27 so the watchdog can close it before retry.

Installed baseline conclusive completion is not adoptable: it has already won
the unique command/claim observation, completion-event and classification keys
with database-generated IDs and all ten V1 observation columns null. There is no
permitted baseline→six-admission-field update. A pre-existing `succeeded` or
`failed` command, a random completion-event ID, any existing observation or
classification in the watchdog arm, or the baseline service-timeout arm is
therefore `23514`, with no accepted typed graph. The ordinary executor must not
run the baseline conclusive path for a V1 recovery claim.

For a candidate accepted arm, the intended top-level order is insert R27;
insert the preallocated observation; complete or validate the command and all
installed cascades; insert or validate the preallocated completion event;
insert the preallocated classification; then close the deferred R27↔0053 graph
guard. The installed observation, command and classification guards sample
their clocks before taking their own internal locks, so these clocks count as
post-lock only when the caller has already locked their complete superset.
Live order is observation `recorded_at <=` command `completed_at =`
completion-event `recorded_at <=` classification `classified_at`; the watchdog
arm retains command/event time `<=` the later observation time `<=`
classification time. All dependent digests use final stored values.

This top-level vector is not yet a complete mutation catalog. Installed 0053
may update attempt/execution projections, cancel a variable set of pending
commands and append their transition events, and require reconcile/stop
successor prepared-request, command and enqueued-event rows. Its cancellation
trigger uses `SKIP LOCKED` without deterministic row order. The semantic
preamble closes equal replay, two `23505` conflict outcomes, fresh authenticated
structural conflict and fresh accepted; fresh accepted expands to the exact five
result branches × two completion subarms. Every operation has a mandatory
semantic selector and guard array even where the ordinary lock/sequence selector
is null. Until a closed set-based cascade and generic-conflict contract, full
prelock/recheck rule and adversarial vectors `PR-A-001` through `PR-A-009` prove
that no row was skipped, every operation/subarm AST/access/write/return/outcome
is exact, the watchdog ID is not circular, and the live routine/catalog match,
provider-
result admission and activation V1 remain **NO-GO**. The result API may only be
implemented after this admission graph itself passes that gate.

For `later_different_terminal`, admission continues in that same transaction:
it derives the terminal barrier from the frozen owner R27 plus its complete 0053
graph, then inserts relation 24 and relation 22 in that sequence. Before the
owner's R29 exists, the only possible effect is `post_terminal_broker_deny`;
after R29, the deepest locked output graph may instead select
`output_quarantine|post_custody_evidence_only`. Target terminal state and stop
intent are always null. Thus recovery-gateway availability cannot leave an
authenticated terminal conflict uncontained. The later result API call only
claims the observation, validates this existing closure and returns
`denied_terminal_conflict` plus the canonical link; its OUT record does not
expose R24/R22 identifiers.

`foundry_provider_command_result_observations` adds these nullable columns:

```text
fdv1_recovery_caller_id uuid
fdv1_recovery_caller_sha256 varchar(71)
fdv1_api_request_sha256 varchar(71)
fdv1_api_idempotency_key varchar(160)
fdv1_provider_evidence_id uuid
fdv1_provider_payload_raw_sha256 char(64)
fdv1_provider_admission_sha256 varchar(71)
fdv1_result_branch varchar(40)
fdv1_api_binding_sha256 varchar(71)
fdv1_api_claimed_at timestamptz(3)
```

The ten columns form exactly three states. All ten are null on a baseline 0053
observation. On an admission-materialized, unclaimed V1 observation, the caller
pair, evidence triple and branch are non-null while API request SHA/key, binding
SHA and claim time are null. On a claimed V1 observation all ten are non-null.
The caller pair is an immediate FK to relation 25 and equals the accepted
relation-27 row's recovery-caller pair; the evidence triple is an immediate FK
to that R27 row whose `planned_observation_id` equals this observation ID; and
branch equals that R27 row. A partial unique
index covers `(fdv1_recovery_caller_id,fdv1_api_idempotency_key)` where
`fdv1_api_idempotency_key IS NOT NULL`.

SQL derives `sql_derived_api_request_sha256` from the exact scalar-only wrapper
under schema/domain
`omnitwin.foundry.fdv1.record-provider-result-api-request.v1`. The wrapper
identifies `public.fdv1_api_record_provider_result(uuid,text)`, contains ordered
`scalarArguments` exactly equal to the two-element array of closed objects
`[{name:"executionId",value:<lower-case UUID>},
{name:"apiIdempotencyKey",value:<exact nonempty UTF-8 text of at most 160
characters>}]`, exact empty-object request `{}`, and exactly
`schemaVersion,functionIdentity,scalarArguments,request`. Strict RFC 8785 JCS
uses no implicit coercion or Unicode normalization; the prefixed SHA-256 hashes
domain + LF + wrapper JCS bytes. The same caller/key with another execution is
therefore changed reuse `23505`.

The binding SHA uses domain
`omnitwin.foundry.fdv1.provider-result-api-binding.v1` and is exactly
`"sha256:" || lowerhex(SHA256(UTF8(domain || "\n") ||
UTF8(RFC8785_JCS(binding_object))))`. `apiClaimedAt` is the millisecond-precision
UTC rendering of `fdv1_api_claimed_at`. The closed object has exactly
`schemaVersion,observationId,recoveryCallerId,
recoveryCallerSha256,apiRequestSha256,apiIdempotencyKey,providerEvidenceId,
providerPayloadRawSha256,providerAdmissionSha256,resultBranch,apiClaimedAt`.
Evidence admission writes only the six admission fields while inserting the
0053 observation. `fdv1_api_record_provider_result` is the sole path allowed to
perform the guarded four-column null-to-non-null claim update, with
`fdv1_api_claimed_at` sampled after its complete fresh-graph lock set and only
after revalidating the R5-pinned recovery caller/provider signer, paired-caller
and interval/artifact equalities, plus every recursive parent/inclusion-root
R25/R26 row at that separate clock; it cannot change any installed 0053 field or an admission field. The
replacement guard validates the binding while retaining `actor_key =
claimed_by`, deterministic internal observation `idempotency_key`, internally
derived `request_digest` and original `recorded_at` unchanged.

Before the root the function derives `SESSION_USER`/`SYSTEM_USER`, checks exact
`pg_roles`/`pg_auth_members`, hashes the system identity with the pinned digest,
and resolves one identity-only R25 candidate without current-authority inference.
It then takes the global root and locks the R5-pinned recovery caller/provider
signer with both recursive parent/inclusion-root R25/R26 lineages, exact R1/
execution/R11/R5 preliminary subject/phase/current-containment eligibility, and any claimed caller/key
observation plus stored R27/R29. Later-different replay also locks and validates
the current-R27/ledger-linked R24 and exact R24-sourced R22. After that complete
set every call samples the common operation-1 authorization clock, validates the
entire pair/lineage, and compares the dedicated SHA to
`sql_derived_api_request_sha256`. Equal replay returns
status from the stored branch mapping; evidence/state/planned graph IDs and
sequence from the locked R27; the originally null or locked current/owner R29
link pair; time from the observation claim; and literal `newly_committed =
false`. A nonterminal replay therefore keeps a null link even if a link was
later created, while first/later terminal replay returns the correct immutable
relation-29 row. Later-different returns no containment ID despite validating
R24/R22. Changed reuse remains `23505`; a fresh key continues to operation 2
only after operation-1 authorization. Operation 4 separately samples the claim
clock and repeats the full pair/lineage check before mutation.

For a fresh key, operation 2—not operation 1—locks the selected attempt/R27
graph and proves exact R27-to-attempt/execution/fence/subject/phase equality
before operation 4 or any mutation.

This is non-positive historical materialization of an already accepted complete
R27/0053 graph, including after later containment. It does not require a current
enabled epoch and never establishes positive enabled-epoch authority. It binds
exact R1/R11, existing execution/attempt/fence, frozen subject/phase and current
containment; it may only claim the observation and conditionally add historical
R29. It cannot submit/invoke, create a new graph, broker, custody, release, or
add R24/R22. Generation-1 disabled or no eligible complete graph is `23514`
without mutation.

Fresh branches resolve exactly 11 return fields. Eight common sources are the
selected R27 evidence/state/planned IDs/sequence, claimed observation time and
literal true. Per-arm status/link overrides are pending/null; recorded/new R29
for either first-terminal arm; or recorded-same-terminal/denied-terminal-
conflict with the frozen-owner R29. Semantic branch effects must bind the exact
fresh and replay sources rather than a union.

## 5. New trust and generic-evidence relations

Column order below is normative. `NULL` is written explicitly; every other
column is `NOT NULL`.

### 5.1 Workload authorizations

```text
foundry_derivative_workload_authorizations_v1
  id uuid PRIMARY KEY
  action_sequence bigint UNIQUE
  authorization_sha256 varchar(71) UNIQUE
  registry_generation bigint
  registry_root_sha256 varchar(71)
  authorized_leaf_merkle_root_sha256 varchar(71) NULL
  authorized_leaf_merkle_policy_sha256 varchar(71) NULL
  binding_kind varchar(24)
  parent_root_id uuid NULL
  parent_root_sha256 varchar(71) NULL
  inclusion_authority_root_id uuid NULL
  inclusion_authority_root_sha256 varchar(71) NULL
  plane varchar(32) NULL
  evidence_kind varchar(32) NULL
  caller_binding_sha256 varchar(71) NULL
  paired_caller_id uuid NULL
  paired_caller_sha256 varchar(71) NULL
  paired_caller_binding_sha256 varchar(71) NULL
  pairing_policy_sha256 varchar(71) NULL
  db_role_oid oid NULL
  db_session_role varchar(63) NULL
  db_system_user_sha256 varchar(71) NULL
  spiffe_id text NULL
  trust_domain varchar(253)
  issuer text NULL
  subject text NULL
  audience text NULL
  credential_kind varchar(40) NULL
  workload_identity_sha256 varchar(71) NULL
  signer_key_id varchar(160) NULL
  signer_public_key_bytes bytea NULL
  signer_public_key_sha256 varchar(71) NULL
  trust_bundle_bytes bytea
  trust_bundle_sha256 varchar(71)
  trust_bundle_schema_sha256 varchar(71)
  trust_bundle_parser_artifact_sha256 varchar(71)
  trust_bundle_parser_configuration_sha256 varchar(71)
  identity_policy_json jsonb
  identity_policy_sha256 varchar(71)
  service_artifact_sha256 varchar(71) NULL
  service_configuration_sha256 varchar(71) NULL
  candidate_leaf_jcs_bytes bytea NULL
  candidate_leaf_json jsonb NULL
  candidate_leaf_jcs_sha256 varchar(71) NULL
  candidate_leaf_commitment_sha256 varchar(71) NULL
  proof_authority_id uuid NULL
  proof_authority_sha256 varchar(71) NULL
  proof_authority_merkle_root_sha256 varchar(71) NULL
  merkle_depth smallint NULL
  leaf_index bigint NULL
  leaf_count bigint NULL
  inclusion_proof_bytes bytea NULL
  inclusion_proof_sha256 varchar(71) NULL
  inclusion_verification_jcs_bytes bytea NULL
  inclusion_verification_json jsonb NULL
  inclusion_verification_sha256 varchar(71) NULL
  valid_from timestamptz(3)
  expires_at timestamptz(3)
  maximum_receipt_lag_seconds integer NULL
  origin_kind varchar(24)
  origin_evidence_id uuid
  origin_payload_raw_sha256 char(64)
  origin_admission_sha256 varchar(71)
  activation_caller_id uuid NULL
  activation_caller_sha256 varchar(71) NULL
  authorization_json jsonb
  api_request_sha256 varchar(71)
  api_idempotency_key varchar(160)
  recorded_at timestamptz(3)
```

`registry_generation` is from 1 through 9,007,199,254,740,991 inclusive so its
JCS integer is exact, `valid_from < expires_at`, `trust_bundle_bytes` has
`octet_length` from 1 through 16,384 inclusive, candidate-leaf JCS bytes are at
most 16,384 bytes, proof bytes are exactly
`28 + 32 * merkle_depth` and at most 1,052 bytes, and inclusion-verification
JCS bytes are at most 16,384 bytes. Every stored JCS byte field must equal the
strict encoder output for its parsed JSON and its prefixed SHA must hash those
exact bytes. Partial unique indexes cover non-null `db_role_oid`,
`db_session_role`, `db_system_user_sha256`, and `signer_key_id`. Runtime rows
also have a global unique `candidate_leaf_jcs_sha256` and a unique
`(proof_authority_id,proof_authority_sha256,
proof_authority_merkle_root_sha256,leaf_index)` path-consumption key. A
composite unique key exists on `(id, authorization_sha256)`.
Every runtime row has a non-null activation `db_caller` pair and a partial
unique key on `(activation_caller_id, api_idempotency_key)`. Every bootstrap-
enumerated row has both caller columns null because relation 27 is the bootstrap
call's primary replay row; no other arm may leave exactly one caller column
null.

The relational union is exact:

- `trust_root` requires distinct authorized-leaf Merkle root/policy plus root/
  bundle/policy/key material, forbids plane,
  evidence-kind, caller-binding, paired-caller/policy and DB-role leaves, and
  has no parent. An
  `admin_action`-origin runtime row requires the exact current
  `inclusion_authority_root_id`/SHA pair and a proof verified against that
  stored row's distinct authorized-leaf root; a `bootstrap_ceremony` trust root
  requires both authority pairs null while retaining its own child root/policy;
- `db_caller` requires one of the eight planes, parent root, OID/name/system
  user, transport identity, artifact/configuration and a freshly computed
  non-null `caller_binding_sha256`; it forbids the separate inclusion-authority
  pair, evidence kind, paired-caller binding/policy and signer-key leaves; and
- `evidence_signer` requires one of the eight normal evidence kinds, its exact
  semantic plane, a composite paired-caller authorization, parent
  root, transport identity, artifact/configuration, RFC 8410 Ed25519 key and a
  `maximum_receipt_lag_seconds` from 1 through 300 inclusive; it forbids DB-
  role/login and caller-binding leaves and the separate inclusion-authority
  pair. A runtime signer's candidate leaf contains only the selected caller's
  `pairedCallerBindingSha256`, never the caller authorization ID/SHA, pairing-
  policy SHA or a redundant paired-caller workload-identity selector. Before
  runtime leaf construction SQL selects and root-first locks the request-named caller,
  freshly recomputes its workload identity and closed caller-binding digest,
  requires exact selector equality, and enforces
  `signer.valid_from >= caller.valid_from` plus
  `signer.expires_at <= caller.expires_at`. A deferred self-FK/arm guard requires
  that row to be a `db_caller` with the named semantic plane; after runtime root
  equality, the verification record's interval-containment verdict MUST be true
  and its explicit pairing-policy digest binds
  its exact authorization pair, workload identity, both registry generations/
  lineages, cross-root trust, scope and delivery channel. Signer and caller may
  be distinct workloads (runner vs submit, provider adapter vs recovery,
  storage control plane vs broker/custodian, or verifier vs custodian); identity
  equality is not required. A signed payload nevertheless cannot name another
  caller in that plane.

The evidence-kind-to-plane mapping is exact: `admin_action` and
`predecessor_source` map to `activation`; `gateway_token_commitment` maps to
exactly one of `submit_gateway` or `recovery_gateway` as fixed by its signer
authorization; `runner_terminal` maps to `submit_gateway`; `provider_result`
maps to `recovery_gateway`; `storage_create` maps to `output_broker`; and
`storage_read` plus `glb_verifier` map to `output_custodian`. Admission requires
every payload caller/target-caller pair to equal this registry pair. In
particular, a token-commitment signer cannot name an arbitrary current gateway.

The composite self-FKs `(parent_root_id,parent_root_sha256)` and
`(inclusion_authority_root_id,inclusion_authority_root_sha256)` both reference
`(id,authorization_sha256)` and have deferred arm guards requiring the target
to be a `trust_root` with a strictly smaller immutable `action_sequence`;
the runtime trust-root arm selects only the inclusion-authority FK, each DB-
caller/evidence-signer arm selects only the parent-root FK, and the bootstrap-
special trust-root arm selects neither. The action-sequence rule and root-first
serialization make the authority graph acyclic rather than relying on a
recursion depth limit. The
runtime request names the authority ID, but the SQL-constructed candidate leaf
deliberately excludes that root-dependent ID as well as authority SHA, bundle,
registry snapshot/root and authorized-leaf root. The selected authority pair,
its exact stored Merkle root, proof, requested validity window, inherited
material and paired-caller pair/policy are instead bound into the atomic
`inclusion_verification_json`/SHA. That verification SHA plus candidate-leaf
and proof SHAs are bound into `authorization_json`/SHA; the verification record
never binds the new target authorization ID/SHA.

For every runtime arm, `proof_authority_id`/SHA equals the selected inclusion-
authority pair for `trust_root` or selected parent pair for the other arms;
`proof_authority_merkle_root_sha256` equals that locked trust root's
`authorized_leaf_merkle_root_sha256`. Those proof-authority columns have a
composite self-FK and deferred arm guard. `merkle_depth` is 0–32, `leaf_count`
is 1–4,294,967,296, `leaf_index` is 0 through `leaf_count - 1`, depth is the
minimal capacity for count, and proof header values equal the columns. The
decoded canonical proof reconstructs the stored authority root byte-for-byte
under the frozen policy. All candidate-leaf, proof-authority/path/proof and
verification columns are non-null together for every `admin_action` runtime
row and null together for every directly envelope-bound `bootstrap_ceremony`
authorization row. Runtime DB-caller/signer rows copy the exact parent
bundle only after proof equality; bootstrap DB-caller/signer rows copy the
manifest-enumerated parent bundle only after dual-envelope and exact-manifest
equality. A consumed leaf/path cannot create a second
authorization; only a byte-identical caller/idempotency replay returns the
first row.

The nullable composite self-FK
`(activation_caller_id,activation_caller_sha256)` also references
`(id,authorization_sha256)`. Its runtime guard requires an earlier, current
`db_caller/activation` row equal to the authenticated registrar; its bootstrap
guard requires both columns null. It is distinct from the signer-only paired-
caller relationship and cannot be inferred from `origin_evidence_id`.

`caller_binding_sha256` is non-null only for a DB caller and freshly hashes the
closed selector defined by the workload-inclusion contract. The same digest is
stored as `paired_caller_binding_sha256` only for an evidence signer. For a
runtime signer it must equal the request-selected DB-caller row after fresh
recomputation; for a bootstrap signer it must equal the manifest-named caller
after the same recomputation. Neither digest is globally unique. For a runtime
signer, the paired caller ID is a public-request selector
selected and locked before signer-leaf construction, but that ID, the caller
authorization SHA and the separately exposed caller workload-identity SHA are
not members of the immutable authorization set. They enter only the atomic
post-proof verification record and pairing policy.

`origin_kind` is `bootstrap_ceremony` or `admin_action` and its evidence FK
fixes that kind. Only the bootstrap transaction may use the first. The
`bootstrap_ceremony` arm requires the activation-caller pair null; the
`admin_action` arm requires the exact authenticated activation-caller pair
non-null. Parent/root and origin cycles are checked by named deferred closure.

The bootstrap origin is not a general proof bypass. The two identical offline
envelopes carry one canonical installation manifest that enumerates every
bootstrap authorization JSON/SHA one-for-one: all bootstrap trust roots,
exactly one activation DB caller, exactly one evidence-admitter DB caller and
the required administrator/source signers. SQL rejects any missing, extra,
duplicate, reordered or implicit row. Bootstrap callers/signers retain their
normal parent, caller-pair, freshly recomputed caller/paired-caller binding,
workload-identity and policy bindings. Only after dual-envelope and exact-
manifest equality does SQL copy their manifest-enumerated parent bundles,
resolve each manifest-named paired caller, and enforce
`signer.valid_from >= caller.valid_from` plus
`signer.expires_at <= caller.expires_at`; their complete proof tuple remains
null.

`authorization_json` and `authorization_sha256` contain `origin_kind`,
`origin_evidence_id`, `origin_payload_raw_sha256` and, for runtime rows, the
activation caller pair, but deliberately exclude `origin_admission_sha256`.
That last column is an immutable integrity-only back-edge checked by the
deferred evidence FK after both sides exist. Bootstrap evidence binds the
already-computable authorization SHA; its admission SHA can therefore bind
those authorization rows without a digest fixed point.

### 5.2 Workload authorization revocations

```text
foundry_derivative_workload_authorization_revocations_v1
  id uuid PRIMARY KEY
  action_sequence bigint UNIQUE
  revocation_sha256 varchar(71) UNIQUE
  authorization_id uuid UNIQUE
  authorization_sha256 varchar(71)
  reason_code varchar(80)
  compromise_not_before timestamptz(3) NULL
  admin_evidence_id uuid
  admin_payload_raw_sha256 char(64)
  admin_admission_sha256 varchar(71)
  activation_caller_id uuid
  activation_caller_sha256 varchar(71)
  api_request_sha256 varchar(71)
  api_idempotency_key varchar(160)
  revocation_json jsonb
  recorded_at timestamptz(3)
```

The caller is an activation `db_caller`; evidence is accepted `admin_action`;
`compromise_not_before` is null or not later than `recorded_at`. `(activation_
caller_id, api_idempotency_key)` is unique.

For a revoked evidence-signer leaf, the resolver selects only evidence/phase
rows storing that exact authorization pair. For a revoked DB-caller leaf, it
also selects every evidence signer whose immutable `(paired_caller_id,
paired_caller_sha256)` names that caller and those signers' exact evidence/
phase consumers. For `binding_kind = 'trust_root'`, the internal
resolver is a pair-exact recursive CTE whose seed is the revoked root itself and
whose `UNION ALL` step selects a trust-root row only when its
`(inclusion_authority_root_id,inclusion_authority_root_sha256)` equals the prior
member's `(id,authorization_sha256)`. Encountering an already visited pair is a
hard invariant failure, not truncation; the strictly increasing action sequence
must make that branch unreachable. The affected set therefore includes the
seed and all and only its inclusion-authority descendants. Caller/signer rows
join it through their exact parent-root pair; the resolver then follows the
same exact DB-caller-to-paired-signer edge even when the signer has a different
parent root, and evidence/phase rows join through any affected root/caller/
signer pair. That pairing hop never marks the signer's parent root, siblings or
unrelated consumers as affected.

The revocation boundary is exactly `coalesce(compromise_not_before,
recorded_at)`. A root pair is unusable at instant `T` when any trust-root
revocation's affected set contains it and `T` is at or after that boundary.
Every parent/inclusion-authority check in `fdv1_api_register_workload`, every
caller/signer-pair resolver, evidence admission, phase-authority predicate,
positive public entry point and watchdog scan must call the same root-first
locked resolver and recheck both signer and paired-caller lineages; checking
only the candidate row's direct revocation is forbidden.
Historical rows remain immutable, while live work selected by the boundary is
contained. Registry-wide, sibling-root, descendant-excluding-seed and digest-
only selectors are forbidden.

### 5.3 Generic authenticated evidence

```text
foundry_derivative_authenticated_evidence_v1
  ledger_row_id uuid PRIMARY KEY
  id uuid
  admission_sequence bigint UNIQUE
  evidence_kind varchar(32)
  purpose varchar(80)
  disposition varchar(48)
  authority varchar(16)
  environment_id varchar(120)
  tenant_id varchar(120)
  project_id varchar(120)
  planned_challenge_id uuid NULL
  nonce_sha256 varchar(71)
  signer_authorization_id uuid NULL
  signer_authorization_sha256 varchar(71) NULL
  secondary_signer_authorization_id uuid NULL
  secondary_signer_authorization_sha256 varchar(71) NULL
  trust_root_id uuid NULL
  trust_root_sha256 varchar(71) NULL
  secondary_trust_root_id uuid NULL
  secondary_trust_root_sha256 varchar(71) NULL
  admitter_authorization_id uuid NULL
  admitter_authorization_sha256 varchar(71) NULL
  signer_key_id varchar(160)
  secondary_signer_key_id varchar(160) NULL
  signer_public_key_sha256 varchar(71)
  secondary_signer_public_key_sha256 varchar(71) NULL
  signer_identity_sha256 varchar(71)
  transport_identity_sha256 varchar(71) NULL
  issued_at timestamptz(3)
  expires_at timestamptz(3)
  observed_at timestamptz(3)
  envelope_bytes bytea
  envelope_byte_length integer
  envelope_sha256 varchar(71)
  secondary_envelope_bytes bytea NULL
  secondary_envelope_byte_length integer NULL
  secondary_envelope_sha256 varchar(71) NULL
  payload_type varchar(255)
  payload_bytes bytea
  payload_byte_length integer
  payload_raw_sha256 char(64)
  receipt_sha256 varchar(71)
  payload_json jsonb
  verification_report_bytes bytea
  verification_report_byte_length integer
  verification_report_sha256 varchar(71)
  verification_report_json jsonb
  auxiliary_bytes bytea
  auxiliary_byte_length integer
  auxiliary_sha256 varchar(71)
  admission_artifact_sha256 varchar(71)
  admission_configuration_sha256 varchar(71)
  key_registry_snapshot_sha256 varchar(71)
  canonicalizer_sha256 varchar(71)
  parser_sha256 varchar(71)
  crypto_implementation_sha256 varchar(71)
  subject_kind varchar(80)
  subject_id text
  subject_sha256 varchar(71)
  activation_id uuid NULL
  execution_id uuid NULL
  attempt_id uuid NULL
  fencing_token bigint NULL
  reservation_id uuid NULL
  source_table varchar(63) NULL
  source_row_key text NULL
  source_row_sha256 varchar(71) NULL
  source_system varchar(120) NULL
  verification_method varchar(80) NULL
  action_code varchar(80) NULL
  request_sha256 varchar(71) NULL
  administrator_user_id uuid NULL
  auth_session_id varchar(160) NULL
  auth_method varchar(80) NULL
  auth_assurance varchar(80) NULL
  auth_issuer text NULL
  auth_audience text NULL
  admin_evidence_id uuid NULL
  admin_evidence_payload_raw_sha256 char(64) NULL
  admin_evidence_admission_sha256 varchar(71) NULL
  target_plane varchar(32) NULL
  target_caller_id uuid NULL
  target_caller_sha256 varchar(71) NULL
  queue_scope varchar(160) NULL
  token_sha256 varchar(71) NULL
  provider_command_id uuid NULL
  claim_token uuid NULL
  claimed_by varchar(160) NULL
  grant_id uuid NULL
  redemption_id uuid NULL
  call_event_id uuid NULL
  planned_observation_id uuid NULL
  planned_completion_event_id uuid NULL
  planned_classification_id uuid NULL
  planned_terminal_link_id uuid NULL
  recovery_caller_id uuid NULL
  recovery_caller_sha256 varchar(71) NULL
  planned_runner_receipt_id uuid NULL
  runner_receipt_id uuid NULL
  runner_receipt_sha256 varchar(71) NULL
  provider_reference varchar(240) NULL
  provider_result_state varchar(32) NULL
  result_tuple_sha256 varchar(71) NULL
  provider_result_branch varchar(40) NULL
  terminal_owner_evidence_id uuid NULL
  terminal_owner_payload_raw_sha256 char(64) NULL
  terminal_owner_admission_sha256 varchar(71) NULL
  result_output_raw_sha256 char(64) NULL
  result_output_byte_length bigint NULL
  broker_object_use_id uuid NULL
  upload_operation_id uuid NULL
  custodian_authorization_id uuid NULL
  storage_create_evidence_id uuid NULL
  storage_create_payload_raw_sha256 char(64) NULL
  storage_create_admission_sha256 varchar(71) NULL
  storage_provider varchar(80) NULL
  storage_account varchar(160) NULL
  bucket varchar(255) NULL
  object_key text NULL
  object_version varchar(240) NULL
  etag varchar(240) NULL
  object_raw_sha256 char(64) NULL
  object_byte_length bigint NULL
  media_type varchar(80) NULL
  suffix varchar(16) NULL
  range_start bigint NULL
  range_end_exclusive bigint NULL
  read_started_at timestamptz(3) NULL
  read_completed_at timestamptz(3) NULL
  conflict_reason_code varchar(80) NULL
  submission_fingerprint_sha256 varchar(71)
  conflict_fingerprint_sha256 varchar(71) NULL
  conflict_against_admission_sha256 varchar(71) NULL
  api_request_sha256 varchar(71)
  api_idempotency_key varchar(160)
  admitted_at timestamptz(3)
  admission_json jsonb
  admission_sha256 varchar(71) UNIQUE
```

Every `claim_token uuid` or `submit_claim_token uuid` column in relations
27–29 is the immutable non-secret base-command claim handle and equals the
accepted `gateway_token_commitment` evidence ID for that claim. The distinct
32-byte redemption token never enters these columns; only its prefixed SHA is
stored in the commitment/grant/redemption graph.

The closed kinds are `bootstrap_ceremony`, `admin_action`,
`predecessor_source`, `gateway_token_commitment`, `runner_terminal`,
`provider_result`, `storage_create`, `storage_read`, and `glb_verifier`.
`authority = 'none'`; disposition is `accepted` or
`authenticated_structural_conflict`. `ledger_row_id` is the DB-generated
forensic-row identity; `id` is the semantic evidence ID signed in the payload
and may repeat only across retained conflict rows. `admission_sha256` and
`submission_fingerprint_sha256` are unique. The submission fingerprint is a
domain-separated SHA over the exact envelope, verification-report and
auxiliary bytes plus claimed ID/kind. Same-key/equal-request replay returns the
immutable row; a duplicate fingerprint under another key is `23505` and creates
no unpersisted alias. Payload/envelope/receipt digests are indexed but are not
global uniqueness keys. Composite unique keys exist on `(ledger_row_id,
admission_sha256)` and `(id, payload_raw_sha256, admission_sha256)`.

Accepted-only partial unique indexes cover `id`, `(signer_authorization_id,
evidence_kind, purpose, nonce_sha256)`, and non-null `planned_challenge_id`.
Conflict rows do not compete for those accepted keys; they require
`conflict_fingerprint_sha256`, which binds the exact violated relational leaves
plus `conflict_against_admission_sha256` when an accepted row already exists,
and are deduplicated by submission fingerprint. This permits an accepted row
and every distinct authenticated changed replay to be retained without
allowing a second accepted consumer.

The normal arm requires exactly one signer/root/admitter, one single-signature
DSSE envelope, no secondary fields, and the kind-specific nullable-column arm
below. Bootstrap requires distinct primary/secondary signer and root pairs,
two separate one-signature envelopes with byte-identical decoded payloads, no
admitter, zero auxiliary bytes, and is insertable only by the one-time
bootstrap function. No two-signature DSSE envelope is accepted.

The bootstrap row is not implied by the normal arm; its exact special arm is:

- `evidence_kind = 'bootstrap_ceremony'`, `purpose = 'installation_seed'`,
  `disposition = 'accepted'`, `authority = 'none'`, and
  `planned_challenge_id IS NULL`;
- primary and secondary signer IDs/SHAs, trust-root IDs/SHAs, key IDs, public-
  key SHAs and envelope bytes/lengths/SHAs are all non-null and pairwise
  distinct by side; `signer_authorization_id = trust_root_id` and the same
  equality holds on the secondary side;
- both referenced authorization rows have `binding_kind = 'trust_root'`, carry
  the two frozen offline Ed25519 keys, and use deferred composite FKs because
  their `origin_evidence_id` points back to this row;
- `admitter_authorization_id`, `admitter_authorization_sha256`,
  `transport_identity_sha256`, every runtime activation/provider/storage/admin
  union column, and all auxiliary bytes are null/zero as appropriate;
- the decoded payload type and bytes are identical across the two envelopes,
  primary/secondary key IDs are sorted by unsigned ASCII order for the
  bootstrap receipt digest, and the SQL-constructed verification report binds
  the frozen offline-verifier artifact/configuration plus the ephemeral
  deployment session without pretending PostgreSQL verified Ed25519; and
- one unique replay key covers `(payload_raw_sha256, nonce_sha256,
signer_key_id, secondary_signer_key_id)`, and a separate partial unique index
  permits exactly one `bootstrap_ceremony` row in the database.

The bootstrap API idempotency lookup by `(purpose = 'installation_seed',
api_idempotency_key)` and request SHA occurs under the root lock before testing
that partial one-row precondition or the sentinel-only state. Thus equal replay
can return the committed row; only a new key can reach the one-time gate.

No normal single-signer uniqueness/FK is used to erase the secondary side;
every normal row instead requires all secondary fields null and the admitter/
transport fields non-null.

The kind-specific CHECK matrix is:

- `admin_action`: admin/action/request/auth fields required; predecessor,
  token, provider and storage fields null;
- `predecessor_source`: source/verifier fields plus accepted admin-evidence
  composite
  required; admin-detail, token, provider and storage fields null;
- `gateway_token_commitment`: target plane, exact current target DB-caller
  authorization pair, pending `provider_command_id`, immutable command-sidecar
  SHA in `subject_sha256`, queue scope and token SHA required; the signer
  authorization's paired caller equals the target. Admin/source/result/storage
  fields are null;
- `provider_result`: execution/attempt/fence, provider command/claim/grant/
  redemption/call, recovery caller, planned result IDs, planned runner-receipt
  ID, provider reference and the SQL-derived `provider_result_state` required.
  Its exact CHECK set is `nonterminal|terminal_success|terminal_failure`. The
  recovery caller and signer equal the relation-20/5 pinned pair.
  `result_tuple_sha256` is null exactly for `nonterminal` and non-null exactly
  for either terminal state; SQL recomputes the evidence-contract section-6
  tuple from verified payload plus locked typed rows and never accepts a
  signer-supplied tuple digest. Nonterminal results require the runner receipt
  pair and output fields null. Terminal success requires a typed
  `(runner_receipt_id, runner_receipt_sha256)` FK to the same planned successful
  relation-28 receipt plus exact output SHA/length. Terminal failure forbids
  output and either references that same planned relation-28 receipt in its
  failed arm or uses the finalized `absent_final` arm. The latter is valid only
  when the locked evidence-admission time is at or after the runner challenge/
  lease `not_after`, no accepted relation-28 row exists and strict runner
  admission before that boundary makes future acceptance impossible. Before
  the boundary an absent terminal-failure payload cannot enter the accepted
  typed arm. Every accepted provider result also requires
  `provider_result_branch`. `nonterminal` requires branch `nonterminal` and a
  null terminal-owner triple. The first accepted terminal by
  `(admission_sequence,evidence_id)` UUID-byte order requires branch
  `first_terminal_success|first_terminal_failure` matching its state and a null
  owner triple. Every later terminal requires branch
  `later_same_terminal|later_different_terminal` and an immediate composite FK
  owner triple to the accepted first-terminal relation-27 row in the same
  activation/attempt/fence/output-slot scope. Equality or inequality of the two
  SQL-recomputed tuple digests fixes that later branch. Every other evidence
  kind and every retained structural-conflict row requires the branch and owner
  columns null;
- `storage_create`: broker use/upload and exact object identity required; the
  storage-create evidence-reference triple plus read authorization/range/times
  is null;
- `storage_read`: custodian authorization, the full referenced create-evidence
  `(id,payload_raw_sha256,admission_sha256)` triple, exact
  object identity, half-open range and read times required; `range_start = 0`,
  `range_end_exclusive = object_byte_length`, and response bytes bind exactly
  `[0, object_byte_length)`. This represents an empty object as `[0,0)` without
  a negative JSON integer;
- `runner_terminal`: common activation/execution/attempt/fence/reservation
  bindings required, all admin/source/token/provider/storage union fields null,
  and its detailed proof projected into relation 28;
- `glb_verifier`: common activation/execution/attempt/fence/reservation plus
  broker use, custodian authorization, the full referenced create-evidence
  triple and exact
  object identity required; admin/source/token/provider/range/read-time fields
  null, with detailed proof projected into relation 30; and
- `bootstrap_ceremony`: all runtime subject/action/provider/storage columns
  null; its frozen manifest is the subject.

The three storage-create reference columns are all-null or all-non-null. For
`storage_read` and `glb_verifier` they form an immediate composite FK to
relation 27's declared `(id,payload_raw_sha256,admission_sha256)` unique key,
with a separate guard requiring the target kind `storage_create` and disposition
`accepted`. Every other evidence kind requires all three null.

For every normal evidence-signer authorization,
`admitted_at - observed_at <= maximum_receipt_lag_seconds`; issue, observation,
expiry, key validity, root validity, revocation and compromise checks use the
post-lock DB time and immutable action sequence. Byte lengths and auxiliary
allowance exactly match the authenticated-evidence contract.

## 6. New typed evidence projections

### 6.1 Runner terminal receipts

```text
foundry_derivative_runner_terminal_receipts_v1
  id uuid PRIMARY KEY
  action_sequence bigint UNIQUE
  evidence_id uuid UNIQUE
  evidence_kind varchar(32)
  payload_raw_sha256 char(64)
  admission_sha256 varchar(71)
  disposition varchar(48)
  signer_authorization_id uuid
  signer_authorization_sha256 varchar(71)
  challenge_id uuid UNIQUE
  challenge_nonce_sha256 varchar(71) UNIQUE
  candidate_id uuid
  candidate_sha256 varchar(71)
  closure_id uuid
  closure_sha256 varchar(71)
  activation_id uuid
  activation_sha256 varchar(71)
  execution_id uuid
  execution_subject_sha256 varchar(71)
  attempt_id uuid
  attempt_ordinal integer
  fencing_token bigint
  stage_id varchar(120)
  submit_command_id uuid
  submit_claim_token uuid
  submit_claimed_by varchar(160)
  submit_grant_id uuid
  submit_redemption_id uuid
  invocation_event_id uuid
  source_asset_id varchar(120)
  source_raw_sha256 char(64)
  source_byte_length bigint
  source_version varchar(240)
  source_read_receipt_sha256 varchar(71)
  reservation_id uuid
  reservation_sha256 varchar(71)
  output_slot varchar(40)
  spool_root_sha256 varchar(71)
  spool_identity_sha256 varchar(71)
  recipe_sha256 varchar(71) NULL
  recipe_report_sha256 varchar(71) NULL
  before_snapshot_sha256 varchar(71) NULL
  after_snapshot_sha256 varchar(71) NULL
  worker_profile_sha256 varchar(71)
  worker_artifact_sha256 varchar(71)
  worker_image_sha256 varchar(71)
  runner_artifact_sha256 varchar(71)
  runner_configuration_sha256 varchar(71)
  transcript_raw_sha256 char(64)
  transcript_byte_length bigint
  transcript_frame_count integer
  transcript_terminal_frame_sha256 varchar(71)
  outcome varchar(16)
  exit_disposition varchar(24)
  exit_code integer NULL
  signal varchar(32) NULL
  spool_state varchar(32)
  failure_code varchar(80) NULL
  failure_stage varchar(48) NULL
  failure_error_sha256 varchar(71) NULL
  failure_last_frame_sha256 varchar(71) NULL
  failure_recipe_state varchar(32) NULL
  failure_output_state varchar(32) NULL
  failure_manifest_state varchar(32) NULL
  failure_recipe_sha256 varchar(71) NULL
  partial_file_identity_sha256 varchar(71) NULL
  partial_raw_sha256 char(64) NULL
  partial_byte_length bigint NULL
  quarantine_handle_sha256 varchar(71) NULL
  failure_manifest_sha256 varchar(71) NULL
  output_file_identity_sha256 varchar(71) NULL
  output_link_count integer NULL
  output_raw_sha256 char(64) NULL
  output_prefixed_sha256 varchar(71) NULL
  output_byte_length bigint NULL
  output_media_type varchar(80) NULL
  output_suffix varchar(16) NULL
  worker_manifest_sha256 varchar(71) NULL
  runner_started_at timestamptz(3)
  output_closed_at timestamptz(3) NULL
  manifest_captured_at timestamptz(3) NULL
  worker_exited_at timestamptz(3) NULL
  spool_frozen_at timestamptz(3) NULL
  terminal_observed_at timestamptz(3)
  receipt_json jsonb
  receipt_sha256 varchar(71) UNIQUE
  admitted_at timestamptz(3)
```

The evidence composite fixes kind `runner_terminal`, disposition `accepted`.
Composite FKs bind closure, activation, execution, attempt, reservation and the
full submit graph. `(activation_id, attempt_id, fencing_token, output_slot)` and
`reservation_id` are unique. `(id, receipt_sha256)` is a declared composite
unique key for broker/link/custody references.

The exact success/failure relational union is the one in evidence section 5.
Success requires exit 0, no signal, frozen spool, complete recipe/report/
snapshots, accepted output, one complete manifest and the full ordered
transcript. Failure requires closed failure fields and forbids every accepted-
output column; partial diagnostics use only the failure-prefixed columns.
The CHECK plus deferred transcript guard implement the exact signal allowlist
and failure-code/stage/exit/reached-state matrix in evidence section 5; those
fields are never validated as independent enums alone.

### 6.2 Terminal-result links

```text
foundry_derivative_terminal_result_links_v1
  id uuid PRIMARY KEY
  action_sequence bigint UNIQUE
  link_sha256 varchar(71) UNIQUE
  authority varchar(16)
  verdict varchar(40)
  activation_id uuid
  activation_sha256 varchar(71)
  closure_id uuid
  closure_sha256 varchar(71)
  execution_id uuid
  attempt_id uuid
  fencing_token bigint
  output_slot varchar(40)
  provider_evidence_id uuid UNIQUE
  provider_payload_raw_sha256 char(64)
  provider_admission_sha256 varchar(71)
  submit_redemption_id uuid
  invocation_event_id uuid
  recovery_authority_id uuid
  recovery_grant_id uuid
  recovery_redemption_id uuid
  recovery_call_event_id uuid
  provider_command_id uuid
  claim_token uuid
  claimed_by varchar(160)
  result_observation_id uuid UNIQUE
  provider_command_outcome_sha256 varchar(71)
  completion_event_id uuid UNIQUE
  result_classification_id uuid UNIQUE
  terminal_outcome_sha256 varchar(71)
  planned_runner_receipt_id uuid
  runner_receipt_id uuid NULL
  runner_receipt_sha256 varchar(71) NULL
  output_raw_sha256 char(64) NULL
  output_byte_length bigint NULL
  provider_reference varchar(240)
  provider_observed_at timestamptz(3)
  observation_recorded_at timestamptz(3)
  completion_recorded_at timestamptz(3)
  linked_at timestamptz(3)
  recovery_caller_id uuid
  recovery_caller_sha256 varchar(71)
  api_request_sha256 varchar(71)
  api_idempotency_key varchar(160)
  link_json jsonb
```

`authority = 'none'`; verdict is `terminal_success_exact_output` or
`terminal_failure`; no nonterminal row exists. `(activation_id, attempt_id,
fencing_token, output_slot)` is unique. A partial unique index covers non-null
`runner_receipt_id`. Success requires a successful runner receipt and exact
output equality. Failure permits no runner only for the finalized
`absent_final` arm or the same planned failed runner receipt and requires output
columns null. The provider-evidence ID/payload-raw/admission triple is an
immediate composite FK to the accepted relation-27 row. `link_json` includes
that row's exact `resultTupleSha256`; a named deferred guard recomputes the
terminal tuple and requires equality with both relation 27 and the closed link
JSON/SHA. No duplicate relation-29 tuple column is added. The linked relation-
27 row must have branch `first_terminal_success|first_terminal_failure`
matching the link verdict and a null terminal-owner triple. `linked_at` equals
the claimed observation's `fdv1_api_claimed_at`, and the four recovery/API
columns copy that observation's dedicated caller/request/key fields. A
post-terminal containment row does not forbid this historical link insert, but
continues to deny every positive broker/custodian/public-output predicate.
Later-same and
later-different branches can never insert relation 29; they join the canonical
link only when relation 29's exact provider-evidence triple equals their frozen
first-terminal owner triple and resolves to that owner relation-27 row. A
conflict cannot supersede it.
`(id, link_sha256)` is a declared composite unique key for broker/verifier/
custody references.

### 6.3 GLB verifier receipts

```text
foundry_derivative_glb_verifier_receipts_v1
  id uuid PRIMARY KEY
  action_sequence bigint UNIQUE
  evidence_id uuid UNIQUE
  evidence_kind varchar(32)
  payload_raw_sha256 char(64)
  admission_sha256 varchar(71)
  disposition varchar(48)
  verifier_signer_id uuid
  verifier_signer_sha256 varchar(71)
  challenge_id uuid UNIQUE
  challenge_nonce_sha256 varchar(71) UNIQUE
  verifier_artifact_sha256 varchar(71)
  verifier_image_sha256 varchar(71)
  verifier_configuration_sha256 varchar(71)
  parser_policy_sha256 varchar(71)
  read_policy_sha256 varchar(71)
  activation_id uuid
  activation_sha256 varchar(71)
  closure_id uuid
  closure_sha256 varchar(71)
  execution_id uuid
  attempt_id uuid
  fencing_token bigint
  stage_id varchar(120)
  source_asset_id varchar(120)
  source_raw_sha256 char(64)
  source_byte_length bigint
  reservation_id uuid
  reservation_sha256 varchar(71)
  output_slot varchar(40)
  runner_receipt_id uuid
  runner_receipt_sha256 varchar(71)
  terminal_link_id uuid
  terminal_link_sha256 varchar(71)
  broker_authorization_id uuid
  broker_object_use_id uuid
  upload_operation_id uuid
  storage_create_evidence_id uuid
  storage_create_payload_raw_sha256 char(64)
  storage_create_admission_sha256 varchar(71)
  custodian_authorization_id uuid
  storage_read_evidence_id uuid
  storage_read_payload_raw_sha256 char(64)
  storage_read_admission_sha256 varchar(71)
  bucket varchar(255)
  object_key text
  object_version varchar(240)
  etag varchar(240)
  object_raw_sha256 char(64)
  object_prefixed_sha256 varchar(71)
  object_byte_length bigint
  media_type varchar(80)
  suffix varchar(16)
  verdict varchar(16)
  invalidity_kind varchar(16) NULL
  glb_magic_hex char(8) NULL
  glb_version integer NULL
  glb_declared_length bigint NULL
  glb_actual_length bigint NULL
  chunk_count integer NULL
  json_chunk_offset bigint NULL
  json_chunk_length bigint NULL
  json_chunk_raw_sha256 char(64) NULL
  bin_chunk_offset bigint NULL
  bin_chunk_length bigint NULL
  bin_chunk_raw_sha256 char(64) NULL
  coverage_end bigint NULL
  structural_proof_json jsonb NULL
  structural_proof_sha256 varchar(71) NULL
  structural_failure_code varchar(80) NULL
  structural_failure_offset bigint NULL
  structural_partial_witness_sha256 varchar(71) NULL
  semantic_replay_state varchar(40)
  semantic_proof_json jsonb NULL
  semantic_proof_sha256 varchar(71) NULL
  semantic_failure_code varchar(80) NULL
  semantic_failure_step varchar(80) NULL
  recipe_invocation_sha256 varchar(71) NULL
  recipe_report_sha256 varchar(71) NULL
  before_snapshot_sha256 varchar(71) NULL
  after_snapshot_sha256 varchar(71) NULL
  validator_report_sha256 varchar(71) NULL
  receipt_json jsonb
  receipt_sha256 varchar(71) UNIQUE
  admitted_at timestamptz(3)
```

The evidence composite fixes kind `glb_verifier`, disposition `accepted`.
Composite FKs bind the successful runner/link and exact create/read chain.
`(activation_id, attempt_id, fencing_token, output_slot)` is unique.
The create/read triples use relation 27's declared composite unique key, and
`(id, receipt_sha256)` is a declared composite unique key for custody.

The result is a three-arm relational union:

- valid: `invalidity_kind` and failure columns null; full operation-specific
  two-chunk structural proof and semantic `exact_match` proof required; all
  typed GLB/chunk/coverage columns are non-null and equal the proof;
- invalid structure: `invalidity_kind = 'structure'`, structural failure
  required, semantic proof/failure absent and `semantic_replay_state =
'not_run_structure_invalid'`; and
- invalid semantics: `invalidity_kind = 'semantics'`, full structural proof and
  one closed semantic failure required; exact-match proof absent and all typed
  GLB/chunk/coverage columns are non-null.

For invalid structure, a typed GLB/chunk field is non-null only when the parser
had deterministically completed that field before the first failure; every
non-null value must equal the partial witness. `semantic_replay_state` is
`exact_match`, `not_run_structure_invalid`, or `failed_semantics` in the three
arms respectively. Recipe/report/snapshot/validator fields are null for invalid
structure, all non-null for valid, and present exactly through the recorded
first semantic-failure step for invalid semantics.

The closed failure-code/order sets are exactly those in evidence section 7.

## 7. Public function, owner and role manifest

The exact input signatures and ordered OUT records are those in callable-API
sections 5 and 5.8. Every entry point is `VOLATILE`, `PARALLEL UNSAFE`, not
leakproof, `SECURITY DEFINER`, has zero defaults/variadic arguments/overloads,
is owned by `omnitwin_fdv1_owner`, has fixed `pg_catalog, pg_temp` search path,
and is revoked from `PUBLIC` in the same transaction.

The exact NOLOGIN roles are:

```text
omnitwin_fdv1_owner
omnitwin_fdv1_bootstrap
omnitwin_api_activation
omnitwin_foundry_claimer
omnitwin_foundry_submit_gateway
omnitwin_foundry_recovery_gateway
omnitwin_foundry_output_broker
omnitwin_foundry_output_custodian
omnitwin_foundry_watchdog
omnitwin_foundry_evidence_admitter
```

All ten listed roles are exactly `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS NOINHERIT`, have no password, no role-level
configuration, no object membership except as explicitly stated, and no
service-role membership. Service LOGINs are infrastructure evidence, not
created here. Each is exactly `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS INHERIT`, owns no object, has no role-level
configuration, and has exactly one direct `INHERIT TRUE, SET FALSE, ADMIN
FALSE` edge to one capability role. It has no nested, cross-plane, owner,
bootstrap or migration membership. Each login name/OID, credential validity,
connection limit and authenticated `system_user` digest is frozen in the
environment installation evidence and checked against relation 25.

The ephemeral bootstrap deployment LOGIN has the same negative security
attributes and, only during the disabled sentinel-only ceremony, exactly one direct
membership edge to `omnitwin_fdv1_bootstrap` and no service role. After COMMIT
that edge is revoked and the LOGIN is dropped; catalog acceptance requires no
remaining bootstrap member or bootstrap LOGIN. Evidence signers have no
database LOGIN.

Exact EXECUTE grants are:

- bootstrap: only `fdv1_bootstrap_seed_v1(bytea,bytea,bytea,text)` during the
  disabled sentinel-only ceremony, then permanent revocation;
- activation: the 15 functions in callable API section 5.1;
- claimer: only `fdv1_api_claim_command(uuid,uuid,text)`;
- submit gateway: only `fdv1_api_redeem_submit(uuid,text,text)`;
- recovery gateway: only the five functions in section 5.3, including the
  read-only provider-result-context function;
- evidence admitter: only
  `fdv1_api_admit_evidence(uuid,text,bytea,bytea,bytea,text)`;
- output broker: only the two functions in section 5.5;
- output custodian: only the three functions in section 5.6, including the
  read-only verifier-context function; and
- watchdog: only the two functions in section 5.7.

No service role can execute a V1 trigger/internal helper or another plane's entry
point. Catalog proof rejects any existing service-callable `SECURITY DEFINER`
helper with mutation authority over the touched base tables. `USAGE` but never
`CREATE` is granted on `public`; no service role owns
an object or receives table, sequence, policy, role-management, grant or admin
option.

The exact `public` schema profile retains ambient `PUBLIC USAGE` for PostgreSQL
16 application compatibility but revokes `PUBLIC CREATE`. The V1 owner and all
eight capability roles also have direct `USAGE`, never `CREATE`; service LOGINs
have no direct schema grant. The environment-specific catalog freezes the
actual `public` schema owner/grantor/OID and every pre-existing non-V1 grant
rather than assuming a fresh-cluster owner. The one-time bootstrap role receives
a direct `USAGE` grant only in `bootstrap_open`; that bootstrap-specific grant
is revoked after the ceremony, while ambient `PUBLIC USAGE` remains. Choosing
to remove ambient `PUBLIC USAGE` would be a database-wide compatibility change
outside this activation contract.

The exact steady-state table/routine privilege set for each capability role is
its listed function EXECUTEs and nothing else. It has zero direct `SELECT`,
`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege
on every V1 and base relation and zero sequence privilege. LOGINs receive no
direct object grant and inherit only their one group's steady-state set.

The extension schema has a separate matrix: its environment-recorded schema
owner has `USAGE, CREATE`; `omnitwin_fdv1_owner` has `USAGE` only; `PUBLIC`,
bootstrap, capability roles and service LOGINs have neither. `PUBLIC` EXECUTE
is revoked from every routine in that schema before the two exact owner grants
in section 2 are installed.

The migration explicitly revokes schema `CREATE` from `PUBLIC`, all ten managed
roles and every service LOGIN. The owner's default-privilege hardening is global
and deliberately omits `IN SCHEMA`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE omnitwin_fdv1_owner
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE omnitwin_fdv1_owner
  REVOKE USAGE ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE omnitwin_fdv1_owner
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE omnitwin_fdv1_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
```

The expected `pg_default_acl` projection therefore has a global routine row
`{omnitwin_fdv1_owner=X/omnitwin_fdv1_owner}` and global type row
`{omnitwin_fdv1_owner=U/omnitwin_fdv1_owner}`, no per-schema routine/type rows,
and normally no table/sequence rows because their hard-wired defaults already
grant `PUBLIC` nothing. Default privileges follow the object creator's
`current_role`; every V1 object is created with `current_role =
omnitwin_fdv1_owner`, or the actual creator and its equally strict global
defaults must be frozen explicitly. A later owner change is not a substitute.
Every object is also explicitly revoked at creation; defaults are defense in
depth, not the grant source. `PUBLIC` receives no V1 function EXECUTE, table or
sequence privilege.

## 8. Exact function-owner base privileges

The V1 owner owns the 30 V1 tables and one V1 sequence. It receives no base-
table ownership and no base `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`,
schema `CREATE`, checkpoint, release, public, runtime, user-update or role
privilege.

It receives column `SELECT (id, platform_role)` on `users`. It receives no
table-wide base `SELECT`. The final repaired routine bodies and expanded
catalog must enumerate the exact additional `(relation,column)` SELECT grants
and exact helper-routine EXECUTEs. The following is the closed relation-level
dependency inventory from which that column projection may be drawn; it is not
a grant and may not be translated to `GRANT SELECT ON TABLE`:

```text
foundry_execution_policies
foundry_provider_adapter_artifacts
foundry_provider_deployments
foundry_provider_request_profiles
foundry_trusted_worker_profiles
foundry_jobs
foundry_job_worker_profiles
foundry_rights_policy_versions
foundry_rights_policy_revocations
foundry_rights_approvals
foundry_compute_approvals
foundry_execution_confirmations
foundry_executions
foundry_attempts
foundry_stop_intents
foundry_prepared_provider_requests
foundry_kill_switches
foundry_kill_switch_events
foundry_execution_events
foundry_provider_commands
foundry_provider_command_result_observations
foundry_provider_command_result_classifications
foundry_verified_checkpoints
foundry_derivative_rights_policy_versions
foundry_derivative_rights_policy_revocations
foundry_derivative_rights_approvals
foundry_derivative_terms_evidence_custody_v1
foundry_derivative_rights_reviews_v1
foundry_derivative_rights_registry_attestations_v1
foundry_derivative_rights_registry_attestation_revocations_v1
foundry_derivative_execution_authorization_candidates_v1
venues
spaces
asset_definitions
configurations
configuration_sheet_snapshots
photo_references
files
website_embed_configs
asset_versions
runtime_packages
reconstruction_releases
reconstruction_release_qa_runs
reconstruction_release_reviews
reconstruction_review_evidence_artifacts
reconstruction_release_attestations
reconstruction_release_publications
reconstruction_release_channels
reconstruction_release_channel_events
```

The last eighteen relations are the exact read-only section-12 reverse-scan
surface. The owner receives only the columns the closed internal scan actually
reads to test every frozen URL/key/hash/manifest/nested reference; it receives
no table-wide SELECT, mutation or function execution in those release/public/runtime domains. The repaired scan
helper is owned by `omnitwin_fdv1_owner`, `SECURITY INVOKER`, schema-qualifies
every relation/function, is revoked from `PUBLIC` and every service role, and
is reachable only from the custodian entry point under the root lock. Catalog
proof enumerates this helper and its zero public/service EXECUTE grants.

This unresolved column projection is an integration blocker. Static analysis
of the frozen SQL bodies must emit ordered read/write/call dependencies, reject
`SELECT *`, compare them byte-for-byte with the catalog manifest and fail on an
extra or missing column/helper grant. It may not replay a failure and broaden a
grant as a remedy.

It receives no table-wide base `INSERT`. It receives column `INSERT` on exactly
the following closed sets (catalog comparison expands every list; `...` is not
permitted in the machine-readable source):

- `foundry_executions(id, job_id, project_id, execution_envelope_sha256,
execution_subject_sha256, execution_subject_json, job_spec_sha256,
provider_plan_sha256, reviewed_ingest_manifest_sha256,
intake_admission_result_sha256, intake_staging_index_sha256,
execution_policy_sha256, pricing_snapshot_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256,
trusted_worker_profile_set_sha256, trusted_worker_profile_count,
pricing_currency, pricing_snapshot_expires_at, budget_cap_micro_usd,
cost_warning_micro_usd, cost_hard_stop_micro_usd,
termination_reserve_micro_usd, absolute_cost_cap_micro_usd,
max_wall_clock_seconds, orchestration_overhead_seconds,
cancel_grace_seconds, termination_grace_seconds,
worker_self_deadline_seconds, termination_confirmation_timeout_seconds,
provider_maximum_execution_ttl_seconds, dispatch_deadline,
rights_approval_id, rights_approval_sha256, rights_policy_version,
rights_policy_definition_sha256, rights_policy_evidence_sha256,
rights_policy_generation, rights_policy_maximum_approval_ttl_seconds,
compute_approval_id, compute_approval_sha256,
compute_approval_maximum_cost_micro_usd, confirmation_id,
confirmation_sha256, admitted_by_user_id, idempotency_key,
request_digest)`;
- `foundry_attempts(id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256,
attempt_ordinal, fencing_token, created_by_user_id, idempotency_key,
request_digest)`;
- `foundry_prepared_provider_requests(id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256, attempt_id,
attempt_ordinal, fencing_token, command_kind, provider_command_id,
command_sequence, stop_intent_id, provider_request_sha256,
provider_request_json, provider_request_profile_id,
provider_request_profile_version, provider_request_profile_sha256,
provider_adapter_configuration_sha256, provider_idempotency_key,
provider_client_request_id, stage_ids, maximum_api_call_seconds,
prepared_by_actor_kind, prepared_by_actor_key, prepared_by_user_id,
idempotency_key, request_digest)`;
- `foundry_provider_commands(id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256, attempt_id,
attempt_ordinal, fencing_token, command_sequence, command_kind,
prepared_provider_request_id, stop_intent_id, payload, payload_sha256,
provider_request_sha256, provider_request_profile_id,
provider_request_profile_version, provider_request_profile_sha256,
provider_adapter_configuration_sha256, provider_idempotency_key,
provider_client_request_id, stage_ids, maximum_api_call_seconds,
target_provider_ref, originating_submit_command_id,
originating_submit_provider_request_sha256,
originating_submit_provider_idempotency_key, created_by_actor_kind,
created_by_actor_key, created_by_user_id, idempotency_key, causation_id,
correlation_id, request_digest)`;
- `foundry_execution_events(id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256, attempt_id,
attempt_ordinal, fencing_token, provider_command_id,
provider_command_kind, claim_token, provider_command_payload_sha256,
provider_request_sha256, provider_idempotency_key,
maximum_api_call_seconds, provider_command_state,
provider_command_outcome_sha256, provider_lifecycle_state,
provider_was_invoked, sequence, event_kind, advances_projection, payload,
actor_kind, actor_key, actor_user_id, idempotency_key, causation_id,
correlation_id, expected_revision, resulting_revision, request_digest)`;
- `foundry_provider_command_result_observations(id, provider_command_id,
invocation_event_id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_adapter_configuration_sha256,
provider_deployment_sha256, prepared_provider_request_id,
provider_request_profile_id, provider_request_profile_version,
provider_request_profile_sha256, provider_request_sha256,
provider_idempotency_key, provider_client_request_id,
maximum_api_call_seconds, command_payload_sha256, attempt_id,
attempt_ordinal, fencing_token, command_sequence, command_kind, claim_token,
claimed_by, adapter_outcome_json, adapter_outcome_sha256,
  worker_observed_at, actor_kind, actor_key, idempotency_key, causation_id,
  correlation_id, request_digest, fdv1_recovery_caller_id,
  fdv1_recovery_caller_sha256, fdv1_api_request_sha256,
  fdv1_api_idempotency_key, fdv1_provider_evidence_id,
  fdv1_provider_payload_raw_sha256, fdv1_provider_admission_sha256,
  fdv1_result_branch, fdv1_api_binding_sha256, fdv1_api_claimed_at)`;
- `foundry_provider_command_result_classifications(id, observation_id,
provider_command_id, completion_event_id, terminal_outcome_sha256,
disposition, actor_kind, actor_key, idempotency_key, causation_id,
correlation_id, request_digest)`; and
- `foundry_stop_intents(id, execution_id, project_id, job_id,
execution_envelope_sha256, execution_subject_sha256, provider_kind,
provider_adapter_id, provider_adapter_version,
provider_adapter_artifact_sha256, provider_deployment_sha256, attempt_id,
attempt_ordinal, fencing_token, reason_code, priority,
target_terminal_state, source_kind, source_id, source_digest,
source_recorded_at, actor_kind, actor_key, actor_user_id, idempotency_key,
causation_id, correlation_id, request_digest)`.

Those are the only base insert paths. In particular there is no insert/update
privilege on `foundry_verified_checkpoints`, costs, policies, approvals,
confirmations, kills, release/public/runtime relations or users.

It receives column `UPDATE` on exactly:

- `foundry_executions(state, last_attempt_ordinal, fencing_token,
cancel_requested, revision, updated_at)`;
- `foundry_attempts(state, provider_execution_ref, cancel_requested, revision,
  updated_at, submitted_at, started_at, finished_at,
  wall_clock_deadline, cancel_deadline, termination_deadline,
  worker_self_deadline, termination_confirmation_deadline,
  provider_ttl_deadline)`; and
- `foundry_provider_commands(cancelled_by_stop_intent_id,
  cancelled_by_provider_command_id, state, provider_command_ref, claimed_by,
  claim_token, claimed_at, claim_expires_at,
  outcome_json, outcome_sha256, provider_lifecycle_state,
  completed_by_actor_kind, completed_by_actor_key, completed_at, revision,
  updated_at)`; and
- `foundry_provider_command_result_observations(fdv1_api_request_sha256,
  fdv1_api_idempotency_key, fdv1_api_binding_sha256, fdv1_api_claimed_at)`.

These updates are used only by the closed functions and the already-installed
0053 projection triggers reached by the eight insert paths. The observation
claim columns have one guard-enforced use: the result function performs their
single all-null-to-all-non-null claim update after validating the complete
admission-materialized graph; no installed 0053 or admission-binding column can
change. No direct entry point accepts any of those values as an authority
decision. No runtime EXECUTE
grant on a base trigger function is assumed; the disposable full replay must
prove PostgreSQL's installed trigger call graph works with exactly this ACL.
If it requires one additional base privilege, the test fails and this frozen
manifest must be amended/re-audited rather than broadening the grant in place.

## 9. Catalog and acceptance proof

Integration additionally requires a checked-in machine-readable catalog source
manifest enumerating every role, schema, extension, relation, column in order,
sequence, function input/OUT signature, constraint, index, trigger and policy,
including every new/replaced object name and complete CHECK/FK/index/trigger
definition. This Markdown does not yet supply that exhaustive object inventory;
its absence is an explicit NO-GO blocker, not permission to invent names or
translate a phrase such as "named deferred guard" during implementation. The
required representation and comparison rules are frozen in
`docs/specs/omnitwin-foundry-activation-v1-catalog-manifest-format.md` and its
strict Draft 2020-12 JSON Schema. Schema validation is structural only: the
mandatory semantic verifier must dereference/hash/recursively validate a
content-addressed catalog, enforce exact set equality and generated-dependent
coverage, recompute summaries/digests and compare routine bodies/effects/ACLs.
A clean
installation must compare it to `pg_roles`, `pg_auth_members`, `pg_namespace`,
`pg_extension`, `pg_depend`, `pg_proc`, `pg_class`, `pg_attribute`,
`pg_attrdef`, `pg_sequence`, live sequence state, `pg_constraint`, `pg_index`,
`pg_trigger`, `pg_policy`, `pg_default_acl` and expanded ACL catalogs. It
enumerates the full `omnitwin_fdv1_ext` routine surface, each member's binary/
symbol/behavior/owner/ACL, the object creator/default-ACL scope and every
`public`/extension-schema effective grant. It fails on an extra or missing
object, truncated/colliding identifier, unexpected owner, RLS/force-RLS bit,
privilege, default, overload, variadic argument, search path, membership edge,
nullable column, dropped column or type/typmod/order drift. Sequence acceptance
also proves all 30 columns have no default, every body/migration allocation is
the exact explicit `nextval`, the raw USAGE-only ACL, global stored-value
uniqueness, steady `is_called = true` and `max(stored value) <= last_value`.

Mandatory live tests include full 0000-0058 replay, one positive transaction
for every function only in a disposable network-isolated enabled-test epoch,
all cross-plane/direct-DML/role/search-path attacks, every discriminated union
arm, idempotent replay, rollback and lock race, lost one-time secret, bootstrap
same-key/equal-request replay before state gating, changed-key reuse and fresh-
key second-use denial, all three workload-inclusion positive vectors and every malformed/
substituted/reused proof/bundle/leaf case, PostgreSQL `pgcrypto` byte-for-byte
agreement for both approved signatures, denial of every unapproved extension-
schema execution path, `nextval` success plus `setval` denial under the frozen
sequence ACL, global/per-schema default-ACL negatives, and exact source
containment in both commit orders. Provider-result tests additionally reject a
same-caller/key different execution, missing later-different replay R24/R22,
fresh operation 2 before common authorization, incomplete caller/provider-
signer recursive lineage, expanded historical-result authority, concatenated
guards, missing operation/branch effects, flat unions and non-exact 11-field
return sources. The disposable
enabled-test database is destroyed afterward. None of this authorizes 0059 or
production enablement.

The structural catalog JSON Schema now exists; the fully expanded
`expectedCatalog` instance and mandatory semantic verifier do not. This design
is eligible for activation-contract integration only after both exist, the
instance validates and verifies, and an independent exact-byte audit reports no
P0/P1/P2 finding across every content-addressed contract. Integration itself
remains a new audited change; the current 0058 draft and generation 1 remain
NO-GO.
