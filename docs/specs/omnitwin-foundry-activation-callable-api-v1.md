# OmniTwin Foundry activation callable API V1

Status: **DESIGN DRAFT / NO-GO — callable-boundary design only.**

Date: 2026-07-14

This contract defines the smallest PostgreSQL mutation surface that may sit in
front of the derivative-activation V1 tables. It closes the frozen 0058-A
finding that direct table DML was revoked while no role-authenticating positive
path existed. It also makes containment source-scoped and defines a custody
horizon that does not reuse dispatch/pricing authority.

Nothing in this document enables migration 0059 or authorizes execution,
provider contact, object-store access, credential use, signing, release,
publication, promotion, measured geometry, or generated output. All
activation-capable entry points must install under generation 1 disabled and
must reject their positive path until a separately audited enabled epoch
exists.

This document depends on the authenticated-result-evidence V1 contract, the
activation V1 schema/privilege manifest, the administrative request-schema
appendix and JSON Schema, the catalog-manifest format and JSON Schema, and the
workload-inclusion-proof contract and JSON Schema. All nine artifacts must be
frozen and audited together before the second-amended activation contract or
0058 changes.

## 1. Security boundary

Application roles receive no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES`, `TRIGGER`, sequence, ownership, schema-creation, role-management,
or bypass-RLS privilege on the V1 tables or the nine existing control tables.
All mutations cross a closed `SECURITY DEFINER` entry point. V1 trigger
functions and V1 internal helpers are not directly executable by service roles;
the catalog proof separately rejects any service-callable existing
`SECURITY DEFINER` helper with authority over the touched base tables.

PostgreSQL's `SECURITY DEFINER` runs with the function owner's privileges,
while `session_user` remains the authenticated connection user and
`current_user` changes to the function owner. PostgreSQL also grants function
`EXECUTE` to `PUBLIC` by default unless it is revoked. The implementation must
therefore follow the current PostgreSQL 16 guidance for
[session identity](https://www.postgresql.org/docs/16/functions-info.html),
[safe `SECURITY DEFINER` functions](https://www.postgresql.org/docs/16/sql-createfunction.html),
and [privilege revocation](https://www.postgresql.org/docs/16/ddl-priv.html).

## 2. Roles and ownership

### 2.1 Function owner

`omnitwin_fdv1_owner` is a dedicated `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`,
`NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, `NOINHERIT` role. It owns the
V1 entry points and the V1 tables. It is not a member of a service role and no
service role is a member of it. Migration/bootstrap administration is outside
the application boundary and is recorded separately.

The base-table owner grants this role only the exact column/table privileges
needed to create the closed 0053 execution/attempt/request/command/event/result/
classification/stop graph. It receives no checkpoint, release, public,
runtime, user/role administration or arbitrary-schema privilege. Catalog tests
enumerate those positive base grants and every negative one; absent base grants
make the positive path impossible, while a broad owner grant is a failure.

RLS is not relied on to repair unsafe SQL: table privileges, exact entry-point
grants, constraints, row/deferred guards and source closures remain mandatory.
The owner/superuser residual is explicitly inside the trusted computing base.

### 2.2 One-plane group roles

The exact NOLOGIN capability roles are:

1. `omnitwin_api_activation`;
2. `omnitwin_foundry_claimer`;
3. `omnitwin_foundry_submit_gateway`;
4. `omnitwin_foundry_recovery_gateway`;
5. `omnitwin_foundry_output_broker`;
6. `omnitwin_foundry_output_custodian`;
7. `omnitwin_foundry_watchdog`;
8. `omnitwin_foundry_evidence_admitter`.

Each database-calling workload has a unique LOGIN role bound to one workload
identity authorization and exactly one capability role. A generic
pooler/shared login is forbidden. Login roles are non-superuser, non-owner,
non-replication, non-bypass-RLS and have no cross-plane membership or admin
option. The one direct membership is `INHERIT TRUE`, `SET FALSE`, `ADMIN
FALSE`; no nested membership is allowed. Connection pooling is permitted only
within one exact login identity; transaction pooling that loses `session_user`
identity is denied.

`foundry_derivative_workload_authorizations_v1` is the referencable trust and
principal registry. Its closed `binding_kind` is `trust_root`, `db_caller`, or
`evidence_signer`. A `db_caller` plane is exactly one of `activation`,
`claimer`, `submit_gateway`, `recovery_gateway`, `output_broker`,
`output_custodian`, `watchdog`, or `evidence_admitter`; an
`evidence_signer` has one exact evidence kind and semantic plane, no database
login, and one exact paired `db_caller` authorization in that plane. Signer and
caller are joined by an explicit pairing-policy digest covering their registry
generations, roots, trust domains, scope and channel; they may be separate workloads connected by the pinned
authenticated delivery channel. Admin/source signers pair to activation; token signers to one fixed
submit or recovery gateway; runner/provider signers to submit/recovery;
storage-create to broker; and storage-read/verifier to custodian. A signer
cannot name another current caller merely because it is in the same plane.

The row stores the exact issuer, subject, audience, credential kind, public
key bytes and digest, trust-bundle bytes and digest, validation-policy JSON and
digest, service artifact/configuration digests, validity interval and closed
registry-generation material. A digest naming an external registry is not
enough: SQL must be able to compare the admitted key/bundle/policy material or
verify the exact `OTFDMP01` SHA-256 Merkle proof defined by the frozen workload-
inclusion contract against the selected row's distinct authorized-leaf root.
The transaction persists the SQL-constructed candidate-leaf JCS bytes/SHA,
position-bound commitment, proof bytes/path/SHA and root-dependent verification
record bytes/SHA; a boolean or opaque proof digest is not sufficient. Runtime
trust-root registration names that exact inclusion-authority authorization and
supplies the new root's distinct child-authorization Merkle root; DB-caller and
signer registration use their exact parent-root authorization. Candidate leaves
exclude root-dependent authority ID/SHA/bundle/registry/root values. Before
constructing a runtime signer leaf, SQL selects and locks the request-named DB-caller
row, freshly recomputes its workload-identity SHA and closed root-independent
`caller_binding_sha256`, and requires the leaf's sole caller selector
`pairedCallerBindingSha256` to equal that binding. The binding preimage covers
the caller workload identity, plane, validity/origin and stable parent-root
profile; the leaf does not repeat the broader workload-identity selector. The
exact paired-caller ID/SHA, workload-identity SHA, both root lineages and
pairing-policy SHA are bound only in the post-proof verification record. The
runtime signer interval MUST satisfy `signer.valid_from >= caller.valid_from`
and `signer.expires_at <= caller.expires_at`, and the verification record's
paired-caller interval-containment verdict MUST be true.
Every bootstrap-special authorization row has a null candidate-leaf/proof/
verification tuple. Bootstrap roots additionally have neither parent nor
inclusion authority, while bootstrap callers/signers retain their exact parent,
caller-binding, paired-caller and pairing-policy relations. Only after both
envelopes and the exact installation manifest compare equal does SQL copy each
manifest-enumerated bootstrap caller/signer's parent bundle, resolve each
manifest-named caller for a signer, enforce the same interval containment and
freshly compute both binding digests; the complete proof tuple remains null.
The append-only
revocation table supports rotation and an optional conservative
`compromise_not_before`. Phase-specific executor/broker/custodian rows
reference exact caller and signer bindings; they do not substitute a bare
workload SHA.

The function derives and checks `session_user`, non-null authenticated
`system_user`, direct membership options and the authorization's
login-role OID/name and system-user digests. It ignores caller GUCs, headers,
actor strings and JSON identity claims as sources of authentication. Service
logins cannot `SET ROLE`; superuser `SET SESSION AUTHORIZATION` is a
trusted-administrator action and cannot be presented as a closed application
guarantee.

The evidence-admitter is an independent, pinned raw-byte parser and
DSSE/Ed25519 verifier. It is not the runner, provider gateway, storage signer,
GLB verifier, activation service or auth gateway. Its LOGIN may inherit only
`omnitwin_foundry_evidence_admitter`; that role can append the generic evidence
ledger through the exact admission functions and has no semantic control-table
or custody authority. A holder of a runner, recovery, broker or custodian
credential cannot call evidence admission. If a later reviewed PostgreSQL
extension performs the exact signature verification internally this separate
role may be removed only by a newly frozen contract; stock 0058 has no such
verifier.

### 2.3 Current repository state is not this boundary

The current API has one generic database connection setting and one generic
pool construction path:

- `packages/api/src/env.ts:16` exposes only `DATABASE_URL`;
- `packages/api/src/index.ts:273` passes that value to `createDb`; and
- `packages/api/src/db/client.ts:20` constructs one `Pool` from the connection
  string.

That architecture cannot give the eight planes distinct authenticated
`session_user` identities and therefore does not implement this contract.
Every positive callable path remains **NO-GO** until the application uses
separate credentials and identity-preserving pools per exact workload login,
the authenticated `system_user` binding is demonstrated, and connection reuse
cannot cross a plane. A router, header, GUC, `SET ROLE`, actor string, or JSON
field layered over the current shared pool is not a substitute.

The checked-in code does not prove the live connection role's ownership,
superuser, `BYPASSRLS` or membership attributes. That configuration is an
unclosed deployment fact and is denial for every positive path until catalog
evidence proves the required negative attributes.

### 2.4 One-time disabled-state bootstrap

Normal registration cannot authenticate the first registrar. Bootstrap is
therefore an explicit offline ceremony, not an undocumented owner insert and
not an enabled epoch:

1. the amended disabled migration freezes an environment installation-manifest
   SHA and two distinct offline bootstrap public-key digests; the canonical
   manifest enumerates byte-for-byte every bootstrap authorization JSON/SHA,
   each trust root's distinct child authorized-leaf root/policy and exact
   bundle/schema/parser material, exactly one activation caller, exactly one
   evidence-admitter caller and all required administrator/source signers;
   absent real values are a hard denial, never placeholders;
2. an ephemeral deployment LOGIN is temporarily a direct member of the
   `NOLOGIN`, non-owner `omnitwin_fdv1_bootstrap` role and of no service role;
3. a pinned offline bootstrap verifier checks both signatures before its
   ephemeral deployment LOGIN calls the separately ACLed
   `fdv1_bootstrap_seed_v1(bytea,bytea,bytea,text)` with the exact canonical
   manifest, two separate one-signature DSSE envelopes over that identical
   manifest, and idempotency key; the function is callable only through the
   temporary bootstrap grant while generation 1 is the latest disabled epoch;
4. under the root lock SQL first resolves relation 27 by
   `(purpose = 'installation_seed', api_idempotency_key)` before applying the
   one-time state gate. Equal request SHA returns the original bootstrap result
   with `newly_committed = false`; changed reuse is `23505`. Only when no such
   row exists does SQL require the exact sentinel-only managed state—relation
   1's generation-1 bootstrap sentinel and no row in relations 2–30—and then
   require no trust, principal or bootstrap-evidence row. It re-parses the raw
   canonical bytes and both envelopes, requires identical decoded manifest bytes
   plus two distinct frozen key/root identities, and verifies the already-created
   LOGIN OID/name/attributes/direct memberships (it never creates or grants a
   role), then inserts exactly that enumerated authorization set and one immutable
   `bootstrap_ceremony` evidence row. SQL requires one-to-one equality: no
   missing, extra, duplicate, reordered or implicitly synthesized row. Every
   bootstrap authorization is direct envelope-bound and has null candidate-
   leaf/proof/verification fields; callers/signers retain the exact manifest-
   named parent/pairing relations, freshly recomputed caller/paired-caller
   binding SHAs and normal workload-identity material; and
5. the deployment membership is removed. Before any enabled epoch can exist,
   catalog proof must show no bootstrap members, zero bootstrap LOGINs,
   `PUBLIC` denial and permanent revocation of bootstrap-function execution.

The bootstrap role/function grants no execution, provider, storage, custody,
release or enablement authority. The deployment principal and the two frozen
offline roots are TCB assumptions recorded in the installation evidence.
The bootstrap role/deployment LOGIN has zero direct table/sequence/schema DML
or ownership and receives only the one exact bootstrap-function EXECUTE during
the ceremony.
After this seed, the activation and evidence-admission services may register
additional inert bindings while generation 1 remains disabled. The future
enablement transaction must bind the exact resulting registry generation and
cannot create or repair it opportunistically.

## 3. Function construction rules

Every public entry point is:

- schema-qualified, `LANGUAGE plpgsql`, `VOLATILE`, `PARALLEL UNSAFE`, not
  leakproof, and `SECURITY DEFINER`;
- owned by `omnitwin_fdv1_owner`;
- declared with `SET search_path = pg_catalog, pg_temp`;
- written with fully qualified relation/function/type names and no dynamic
  SQL, unqualified caller-controlled identifier, `reg*` text cast, variadic
  argument, default argument, or overload;
- revoked from `PUBLIC` in the same migration transaction in which it is
  created, then granted only to its one listed group role; and
- bounded in input size, row count and lock acquisition.

The bootstrap function follows the same owner, fixed-search-path, static-SQL,
size, `PUBLIC`-revocation and no-overload rules; only its one-time caller/
disabled sentinel-only-state protocol differs.

`CREATE` on schema `public` is revoked from `PUBLIC` and every service/login
role; ambient PostgreSQL-compatible `PUBLIC USAGE` remains, while the owner and
eight capability roles also have direct `USAGE`. No application schema is on
the function search path and `pg_temp` is explicitly last; adversarial
temporary and public shadow objects must not alter behavior. The owner's global
`ALTER DEFAULT PRIVILEGES` (with no `IN SCHEMA`) revokes future routine EXECUTE
and type USAGE from `PUBLIC`, and revokes all PUBLIC defaults for tables and
sequences. Objects are created with that owner as `current_role`; each exact
object is still explicitly revoked before its closed grant is installed.

Arguments and returned records use schema-qualified scalar types. Complex
requests may use one `jsonb` object only when its exact key set, depth, size,
types and canonical digest are checked before mutation. Requests contain
selection IDs, idempotency keys and opaque evidence only. Actor, DB time,
authority decision, current policy generation, horizon, claim identity,
disposition and canonical result receipts are always derived.

## 4. Common caller and transaction protocol

Every service entry point except the separately ACLed one-time bootstrap begins
in this order:

1. reject a null/unknown `session_user` or null `system_user`;
2. verify the exact service group and absence of membership in every other
   service plane;
3. resolve the sole candidate workload/login authorization identity and compare
   its database role, authenticated-system-user digest, workload identity,
   audience and artifact, without yet treating an unlocked validity interval as
   current authority;
4. take the global root advisory lock, then the exact ordered authorization,
   revocation, advisory and row locks from the activation contract;
5. sample one millisecond-truncated `clock_timestamp()` after all locks;
6. validate the locked authorization interval and absence of an effective
   revocation at that clock, then resolve the latest effective epoch and
   policies from stored state, never a caller generation, except for the narrow
   historical-result materialization rule below;
7. parse and compare all exact subject/phase leaves; and
8. perform one atomic mutation graph or no mutation.

The exception is non-positive historical materialization of an already
accepted, complete R27/0053 graph, including after later containment. It does
not require a current enabled epoch and never establishes positive
enabled-epoch authority. Only
`fdv1_api_record_provider_result` may finish that graph
for the exact locked R1/R11 activation, existing execution/attempt/fence and
frozen subject/phase. It locks current containment and may only claim that
observation and, for a first terminal result, add its historical R29 link. It
cannot submit/invoke work, create a new execution or evidence graph, or enable
broker/custody/release. Generation-1 disabled or no eligible complete graph is
`23514` without mutation. Its R5-pinned recovery caller and provider signer,
including recursive parent/inclusion-root authority, remain current under the
ordinary clock rule. Historical materialization changes neither that current-
authority requirement nor containment's denial of every positive path.

`fdv1_api_watchdog_scan` has one narrow two-clock selection exception. After
the global root authority-serialization lock it samples and persists
`scan_cutoff_at` solely to define the finite due set. It then locks and rechecks
all selected source/phase rows, and only after those locks samples the ordinary
`database_time`/receipt `recorded_at` required by step 5. Thus the cutoff is not
an authorization-action time or returned DB time; all mutations still use a
post-lock clock, and `scan_cutoff_at <= database_time`.

Every service mutation runs as the sole logical operation in a read-write
`SERIALIZABLE` transaction and rejects any other isolation level. A zero-row update, serialization
failure, uniqueness conflict, deferred-closure failure or horizon failure
returns no capability. Applications reveal any separately generated plaintext
token only after COMMIT. PostgreSQL stores token SHA-256 only; the trusted
function computes that SHA from the presented plaintext. The gateway never
logs the plaintext or sends it to another plane.

Exact replay of an idempotency-bearing call returns the immutable original
result. Reuse of the
same actor/idempotency key with any different canonical request returns a
conflict and changes nothing. Suggested SQLSTATE classes are:

| Condition | SQLSTATE |
| --- | --- |
| malformed/oversized/unknown request | `22023` |
| unauthenticated or wrong-plane caller | `42501` |
| closed invariant or authority denial | `23514` |
| conflicting idempotent replay/uniqueness | `23505` |
| retryable serializable conflict | `40001` |

Errors contain no token, credential, raw receipt, object URL, private key or
secret-bearing parameter.

The result taxonomy is closed. Malformed, unauthenticated, authority/horizon,
zero-row and relational-closure failures raise before mutation. Exact replay
returns the existing row; changed key reuse raises `23505` without mutation.
A committed domain-negative result is not an exception and therefore requires
one durable primary row. Namespace collision during storage-profile
registration is the sole activation-plane domain-negative arm: it commits the
exact denial receipt defined below and returns that receipt rather than raising.

Every capability token is 32 CSPRNG bytes represented to SQL as exactly 43
unpadded RFC 4648 base64url ASCII characters. SQL rejects non-canonical text,
decodes it to exactly 32 bytes and hashes the raw bytes. Every evidence
challenge nonce is raw `bytea` of exactly 32 bytes; SQL stores only its SHA-256.
One-time secret output is non-null only on the newly committed logical result,
must not be observed or used by application code before transaction COMMIT,
and is null on exact idempotent replay. Lost plaintext after commit causes the
phase-specific containment path; no function reissues, regenerates or
retokenizes it. Recovery carries the committed result nonce into the exact
provider-response adapter request, the broker carries the create nonce into
the exact PUT control-plane request, and the custodian carries its distinct
read and verifier nonces only to their corresponding signers.

For DB-issued broker tokens and evidence nonces, the primitive is exactly the
schema-qualified pgcrypto 1.3
`omnitwin_fdv1_ext.gen_random_bytes(32)`, with extension binary/version/schema/
ACL in the catalog proof. Workload-inclusion hashing uses only
`omnitwin_fdv1_ext.digest(bytea,text)` with literal algorithm `sha256`. After
extension installation, `PUBLIC` EXECUTE is revoked from every routine in
`omnitwin_fdv1_ext`; among managed/non-administrative identities, only
`omnitwin_fdv1_owner` can execute those two exact signatures and it cannot
execute another extension routine. The extension owner, schema owner and C
member owners remain separately frozen environment facts. Core UUID generation
and concatenated UUIDs are never substitutes. The target gateway's
32-byte redemption token is the sole pre-admission exception: its pinned workload uses the
pairing-policy OS CSPRNG, retains the plaintext, and has the signer commit its
hash before SQL claim; it is not presented as DB-issued randomness.

## 5. Exact public entry points

The signatures below are normative names and semantic input sets. No other
service-granted mutator is allowed. Each name is below PostgreSQL's 63-byte
identifier limit.

The eleven entry points that accept `jsonb` use the closed schemas in
`docs/specs/omnitwin-foundry-activation-v1-request-schemas.md` and its adjacent
Draft 2020-12 JSON Schema; the appendix's
key/type/literal/omission/size rules and call-wrapper digest are normative.
PostgreSQL `jsonb` is the semantic value boundary for these unsigned
administrative requests. Signed evidence and verification reports continue to
enter as raw canonical `bytea` so duplicate keys or noncanonical bytes cannot
be erased before verification.

### 5.1 Activation/admin plane

| Function | Caller | Caller-supplied selection/material | Atomic derived mutation |
| --- | --- | --- | --- |
| `fdv1_api_register_storage_profile(jsonb)` | activation | closed profile selectors, accepted infrastructure `predecessor_source`, exact broker/custodian callers and storage-create/read/verifier signer pairs, admitted `admin_action` evidence ID, idempotency key | evidence equality + namespace pre-scan, then exactly one profile or one `register_storage_profile_denial_receipt`; no credential |
| `fdv1_api_revoke_storage_profile(uuid,jsonb)` | activation | exact profile reference, admitted action evidence and idempotency | revocation plus phase-scoped containment/stop in the same transaction |
| `fdv1_api_register_workload(jsonb)` | activation | one closed runtime trust-root, DB-caller or evidence-signer binding, exact inclusion-authority/parent root, exact `OTFDMP01` proof, target child root for a new trust root, admitted action evidence and idempotency | one inert registry row with persisted candidate leaf, proof and atomic verification record after equality to the selected authority's authorized-leaf Merkle root; permitted while disabled but grants no positive execution |
| `fdv1_api_revoke_workload(uuid,jsonb)` | activation | exact binding, reason, optional compromise-not-before, admitted action evidence and idempotency | revocation plus phase-scoped containment for affected current work |
| `fdv1_api_revoke_broker_authorization(uuid,jsonb)` | activation | exact broker authorization, closed non-compromise or security-compromise reason, optional compromise-not-before, admitted action evidence and idempotency | broker revocation plus phase-scoped containment for only its exact reservation/output graph |
| `fdv1_api_revoke_custodian_authorization(uuid,jsonb)` | activation | exact custodian authorization, closed non-compromise or security-compromise reason, optional compromise-not-before, admitted action evidence and idempotency | custodian revocation plus phase-scoped containment for only its exact reservation/object/read/verifier graph |
| `fdv1_api_register_executor(jsonb)` | activation | exact executor, submit/recovery caller and runner/provider signer binding IDs plus provider/worker artifacts, admitted action evidence and idempotency | exact phase authorization row only |
| `fdv1_api_revoke_executor(uuid,jsonb)` | activation | exact authorization, admitted action evidence and idempotency | revocation plus phase-scoped containment/stop |
| `fdv1_api_record_closure(uuid,text)` | activation | candidate ID and idempotency key | complete closure derived from candidate, immutable job/worker, current rights and stored profile |
| `fdv1_api_activate(jsonb)` | activation | candidate/closure/executor/profile IDs, preallocated activation/execution IDs, admitted action evidence and idempotency | activation + exact execution + admission genesis, or full rollback |
| `fdv1_api_open_attempt(uuid,uuid,text)` | activation | activation ID, preallocated attempt ID, idempotency | one attempt + reservation + planned runner receipt/challenge; DB generates/stores nonce hash and returns raw nonce once, unusable until commit |
| `fdv1_api_prepare_submit(uuid,uuid,bytea,text)` | activation | activation/attempt IDs, returned 32-byte runner nonce and idempotency | verifies the nonce hash, embeds the raw challenge into the exact sealed provider request, then creates request + immutable sidecar |
| `fdv1_api_enqueue_submit(uuid,uuid,text)` | activation | prepared request ID, preallocated command ID, idempotency | one pending `provider_submit` command + sidecar |
| `fdv1_api_revoke_activation(uuid,jsonb)` | activation | activation ID, admitted action evidence and idempotency | one revocation plus phase-scoped containment/stop |
| `fdv1_api_disable_epoch(jsonb)` | activation | only reason `containment`, exact prior/source/admitted action evidence/idempotency | next contiguous disabled epoch; never an enabled epoch |

Storage-profile namespace collision is a committed, replayable security result,
not a rolled-back trigger side effect. Under the root lock the registration
function checks both its success relation and the denial-receipt arm before it
rescans. On collision it inserts exactly one relation-24
`register_storage_profile_denial_receipt`; it does not attempt the profile
insert and does not append a second ordinary security event. Success and denial
share one cross-relation caller/idempotency guard. Exact replay returns the
stored arm without rescanning; changed request reuse is `23505`.

The broker and custodian revocation boundary is exactly
`coalesce(compromise_not_before, recorded_at)`. An action or admitted evidence
at the boundary is affected; one strictly before a later boundary remains
immutable historical evidence. Each resolver begins at the exact authorization
pair and follows only its typed graph. Neither callable invokes workload/root
lineage fanout, and neither accepts an activation, attempt, evidence row,
phase effect or containment selector from the caller.

Let that boundary be `B`. The inclusive predicate is always `B <=
action_or_admission_time`; historical means strictly `action_or_admission_time
< B`. Broker exercise times are exactly R7 `issued_at` (which must equal its
`recorded_at`), R21 `authorized_at`, and accepted R27 `storage_create`
`admitted_at`. Custodian exercise times are exactly R9 `valid_from` (which must
equal its `recorded_at`) and accepted R27 `storage_read` or `glb_verifier`
`admitted_at`; R30's copied admission time must equal its parent R27 row. Signed
observed/issued times, read-start/read-complete times and storage-create time do
not substitute for those DB clocks.

If no exercise satisfies the predicate, the revocation still commits and bars
future use but creates no historical relation-22 effect. Otherwise the deepest
locked graph state chooses the effect: broker uses `post_custody_evidence_only`
when R23 exists, else `output_quarantine` when accepted storage-create exists
(regardless of later read/verifier work), else `post_terminal_broker_deny`;
custodian uses `post_custody_evidence_only` when R23 exists and otherwise
`output_quarantine`. Later phase timestamps determine depth but do not
retroactively turn an authorization exercised strictly before `B` into an
affected one. Because DB instants are millisecond-truncated and the boundary is
inclusive, an action in the same millisecond as revocation is conservatively
affected; no hidden action-sequence tie-breaker exists.

Each revocation inserts its relation-8 or relation-10 primary row first; every
derived relation-22 row receives a later action sequence. Broker revocation
uses `post_terminal_broker_deny` before an accepted storage-create row,
`output_quarantine` after create/read/verifier work but before custody, and
`post_custody_evidence_only` after relation 23. Custodian revocation necessarily
starts after create and uses `output_quarantine` before custody or
`post_custody_evidence_only` after it. All these effects require a null target
terminal state, create no provider stop intent, and are unique per exact
attempt/fence/source. A valid revocation commits even when the affected set is
empty and always denies future use. Reuse of the target under a different key
or caller is `23505`, never a redirected replay.

The runner nonce is not an authority token, but it is replay-sensitive. The
application may pass it to `prepare_submit` only after the attempt transaction
commits and may never log it. Exact replay of `open_attempt` does not return the
nonce again; committed loss contains the attempt and never regenerates or
retokens it. The prepared provider request is the sole persistent raw-nonce
copy and exposes it only to the exact sealed runner request path.

An administrator ID or receipt SHA is not accepted as proof of human
authentication. The activation function consumes an admitted `admin_action`
evidence row binding the exact environment, tenant/project, action, request
digest/idempotency key, subject IDs/SHAs, administrator, auth session/method,
issuer/audience, nonce, issue/expiry interval and signer/root. SQL also verifies
that the stored user currently has platform administrator status. Replay under
a different action, subject, tenant or request is denial.

The immutable 0053-0057 rows also do not become authenticated merely because
they contain a platform-admin user ID. The generic authenticated-evidence
ledger stores one closed `predecessor_source` record for every approval, policy
generation, review, registry attestation, execution confirmation, compute
approval, candidate/reservation and worker/profile record consumed by
activation. Each record binds exact row material, admitted admin action,
authoritative source/verifier method and signed source response. Activation
requires the complete expected set. A restatement of the row with no
independent source evidence is denial, not provenance.

### 5.2 Claim and submit planes

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_claim_command(uuid,uuid,text)` | claimer | pending command ID, admitted one-use target-gateway `token_commitment` evidence ID, idempotency | immutable first claim plus exactly one submit or recovery grant; returns only closed grant metadata |
| `fdv1_api_redeem_submit(uuid,text,text)` | submit gateway | grant ID, redemption-token plaintext and external idempotency key | SQL computes/compares the token SHA, then creates the exact `provider_invocation_started` event at planned ID plus one redemption |

After the enqueue transaction commits, its authenticated caller publishes a
bounded `fdv1_command_ready_v1` message to the exact target gateway's durable
private queue. It contains the immutable API-returned command ID/SHA, kind,
target plane/caller pair and queue scope; exact enqueue replay reproduces those
non-secret fields if delivery must be retried. It is a selection hint and
confers no authority. The
target gateway generates a 32-byte CSPRNG redemption token, retains the plaintext and
has the independent evidence service admit a signed commitment binding its
hash, exact command ID/sidecar SHA, target caller, plane, queue scope, nonce and
maximum expiry. The claimer sees only the
admitted commitment ID/hash. The existing
`foundry_provider_commands.claim_token uuid` is a non-secret immutable claim
handle, not that plaintext: SQL sets it exactly to the accepted token-
commitment evidence UUID. Under locks SQL derives `claimed_by` from the
commitment's target submit/recovery gateway evidence-signer binding and its
payload-bound current target DB-caller authorization, and requires exact equality to the
existing 0053 actor-key representation; the claimer principal is never stored
as the target gateway. SQL atomically consumes the commitment into one grant.
A commitment and grant are unique and
non-reissuable even if expired or lost. The submit gateway cannot claim, create
a grant, issue recovery, upload, read, verify or classify custody.
The derivative claim guard also forbids the fixed V0 reaper/retry paths from
clearing, expiring back to pending, or retokenizing a derivative command. A
later recovery observation uses a new recovery command ID.

The non-secret metadata handoff is exact. The target gateway preallocates the
commitment evidence UUID, retains the redemption-token plaintext in a private local secret
store keyed by that UUID, and submits the signed commitment to evidence
admission. The admission service returns only the non-secret accepted evidence
ID/admission SHA on that authenticated request channel. After acceptance the
target gateway places one bounded `fdv1_claim_offer_v1` message
on the claimer's authenticated private queue containing only the commitment
evidence ID/admission SHA, exact command ID, target plane, queue scope and claim
idempotency key. Command ID/sidecar, target and scope must equal the signed
commitment and locked sidecar; the claimer cannot pair a commitment with a
different pending command.
The message is a selection hint, not authority; SQL re-derives every binding
from the admitted evidence and claimer session. The claimer acknowledges that
message only after its claim transaction commits, then places one bounded
`fdv1_grant_ready_v1` message on the exact target gateway's authenticated
private queue containing only command ID, commitment evidence ID, grant
kind/ID/SHA and expiry. The target gateway correlates it to its retained
redemption token by commitment ID and redeems under its own DB session. SQL authenticates that
session against the grant's target-caller binding, so substitution or routing
to another gateway denies. Neither message carries redemption-token plaintext
or its digest.

Both queues are durable at-least-once TCB components. Until acknowledgement,
the offer remains replayable; the claimer repeats the same DB idempotency key
and receives the immutable original grant metadata. `grant_ready` delivery is
also idempotent and may be repeated. No table SELECT, shared DB login,
redemption-token reissue or cross-plane secret fetch is permitted. Committed
redemption-token loss at the
target gateway contains the grant/attempt.

### 5.3 Recovery/result plane

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_open_recovery(text,uuid,text)` | recovery gateway | closed source kind (`submit_redemption` or `containment_event`), exact source ID, idempotency | historically bounded recovery authority; creator is historical while every call remains restricted to the activation-pinned caller/signer pair |
| `fdv1_api_enqueue_recovery(uuid,text,text,text)` | recovery gateway | recovery authority ID, literal call kind, bounded target/stop-intent selector, idempotency | pending recovery command + sidecar; never submit/checkpoint |
| `fdv1_api_redeem_recovery(uuid,text,text)` | recovery gateway | recovery grant ID, redemption-token plaintext, provider idempotency key | actual planned call event plus one redemption and DB-issued provider-evidence challenge at preallocated IDs; returns the raw 32-byte result nonce once |
| `fdv1_api_read_provider_result_context(uuid)` | recovery gateway | recovery redemption ID | read-only exact canonical provider-evidence context, including the currently admitted planned runner-receipt arm; no evidence selection or mutation |
| `fdv1_api_record_provider_result(uuid,text)` | recovery gateway | execution ID and idempotency | validates and claims the earliest accepted admission-materialized but unclaimed R27/0053 graph by `(admission_sequence,evidence_id)`; first-terminal also creates R29, while later branches follow the frozen owner and existing containment |

The record routine must match the catalog contract's exact seven-branch/nine-
operation vector. Every operation carries an exact branch array and closed
unique `guardIdentifiers`; operation 5 has two separate guards, while the same
guard may recur at another operation ordinal. Every fresh arm has the one
`update:observation_api_claim` effect; only a first-terminal arm additionally
has `sequence_allocation:r29.action_sequence` followed by
`insert:r29.first_terminal_link`. Replay returns after the locked current-
authority preamble but before any fresh mutation, and no arm may write the
installed 0053 graph, R24, or R22. The semantic guard IDs are not SQL object
names or implementation authority: `PR-R-001` must map every selector one-to-
one and every guard by `(operationNamespace,operationOrdinal,guardId)`. Each exact
`(operationNamespace,operationOrdinal,branch)` needs its own applicability predicate, AST nodes,
accesses, aggregate effects, writes, return-field sources and structured
continuation/return/error outcomes; a `continue` binds the full non-null
`(nextOperationNamespace,nextOperationOrdinal)` target, while `return` and
`error` bind null for both target fields. A flat union fails. The ordinary
`orderedSteps` array remains only the lock/sequence-order projection.

Recovery remains structurally unable to create an execution, attempt,
`provider_submit`, checkpoint, broker/custodian authorization, evidence row,
runner/verifier projection, or caller-selected authoritative-success decision.

Each recovery claim/grant references the recovery-plane caller and provider
signer pair pinned by the activation's exact executor authorization, and both
must be current for that call. Rotation creates a new workload authorization
without changing historical recovery-authority rows, but future calls under the
new pair require a newly admitted executor authorization/activation. An
in-flight activation pinned to a revoked, expired or compromise-effective pair
is contained and cannot silently migrate to another signer.
For result recording, that means R5's provider signer must be the current
`evidence_signer/provider_result` row paired to the same recovery caller, its
validity interval must be contained by the caller interval, its adapter artifact/
configuration must equal R5, and neither row nor any recursive parent/inclusion-
authority ancestor may have an effective R26 revocation or compromise. The same
complete closure is checked at operation 1 and again at the fresh claim clock.
The admitted provider evidence must bind the exact challenge, raw
response/channel, adapter artifact, provider reference and observed result
bytes. The record function accepts no evidence ID, observation/outcome/
classification IDs, actor, provider time, outcome JSON, request SHA or state.
Before the root it derives `SESSION_USER`/`SYSTEM_USER`, reads exact `pg_roles`
and `pg_auth_members` state, hashes the system identity with the pinned digest
routine, and resolves one identity-only R25 candidate without treating its
unlocked interval as current. It then takes the global root lock and locks the
R5-pinned recovery caller and provider signer plus each row's recursive parent/
inclusion-root R25/R26 lineage and preliminary R1/execution/R11/R5 subject/
phase/current-containment eligibility. A claimed caller/key observation is locked and its
stored R27 and branch-specific R29 are followed. Later-different replay also
locks and validates the current-evidence/ledger-linked R24 and its exact R22
source ID/SHA, execution/attempt/fence and phase. Only after that complete set
does every call sample one operation-1 authorization clock and validate both
current activation-pinned workload identities. Equal replay may return, changed
reuse is `23505`, and only an authorized fresh key may continue to operation 2.
A fresh key retains those locks and enumerates accepted provider-result R27 rows for the locked
execution/attempt/fence in immutable DB admission-sequence/UUID-byte order, and
locks the remaining graph. It validates the selected R27 against the locked
attempt/execution/fence/subject/phase and each earlier row's exact preallocated
observation, command completion, completion event and classification before
treating a claimed row as processed, then selects the first complete unclaimed
graph. Missing/mismatched graph state is `23514`; no inner join or predicate may
skip it. At a separate post-complete-lock claim clock, it revalidates the same
caller/provider-signer recursive R25/R26 closure and fills
only the selected observation's API request SHA, API key, API-binding SHA and
`fdv1_api_claimed_at`. It cannot change installed 0053 fields, the six
admission-binding fields, command outcome or attempt/execution projection.
The API-binding SHA is exactly `"sha256:" || lowerhex(SHA256(UTF8(
"omnitwin.foundry.fdv1.provider-result-api-binding.v1\n") || UTF8(
RFC8785_JCS(B))))`; `B.schemaVersion` is the same domain literal,
`B.apiClaimedAt` is the millisecond-precision UTC form of the stored claim time,
and the other fields copy the selected observation's final ten-column state.

The stored and compared request SHA is `sql_derived_api_request_sha256`. SQL
constructs the exact scalar-only wrapper for
`public.fdv1_api_record_provider_result(uuid,text)` under schema/domain
`omnitwin.foundry.fdv1.record-provider-result-api-request.v1`.
`scalarArguments` is exactly a two-element array of closed `{name,value}`
objects: `{name:"executionId",value:<lower-case UUID>}` then
`{name:"apiIdempotencyKey",value:<exact nonempty UTF-8 text of at most 160
characters>}`. `request` is exactly `{}`. The wrapper contains exactly
`schemaVersion,functionIdentity,scalarArguments,request`, uses strict RFC 8785
JCS with no implicit coercion or Unicode normalization, and hashes the
concatenation of domain UTF-8, LF and wrapper JCS UTF-8 to the prefixed SHA-256.
Same caller/key with another
execution therefore raises `23505` without mutation.

`fdv1_api_redeem_recovery` returns raw canonical JCS provider-challenge context
bytes (at most 64 KiB) and their SHA beside the one-time nonce. The context contains exactly the
stored challenge ID, planned evidence/result IDs, issue/not-after interval,
execution/attempt/fence, command/claim/grant/
redemption/call tuple, provider/adapter artifact and configuration tuple,
recovery caller/signer pair and planned runner-receipt ID; it excludes the raw
nonce and its own digest. The signer binds each typed leaf and the returned
context SHA.

Because a runner receipt may be admitted after redemption,
`fdv1_api_read_provider_result_context` authenticates the exact recovery caller,
locks that redemption graph, and returns a canonical context containing the
same immutable leaves plus `runnerOutcome = absent|succeeded|failed` and, when
present, the exact accepted relation-28 receipt ID/SHA and success output SHA/
length. An absent receipt is representable for nonterminal or terminal-failure
evidence; terminal-success admission requires the succeeded pair. The function
cannot accept or choose a receipt ID. Its bytes contain no secret and it has no
table-SELECT substitute or cross-execution read path.

Every accepted row already has its complete admission-materialized 0053 graph.
A fresh key atomically claims that graph and writes the dedicated hashed API
binding without repurposing 0053's `actor_key`, internal `idempotency_key`,
`request_digest`, or `recorded_at`. A nonterminal claim creates no V1 managed
row. The admission-frozen first terminal claim creates the unique relation-29
link. A later terminal follows its frozen owner triple and the tuple comparison
already fixed at admission. Equality claims and returns the existing link;
inequality claims, validates the relation-24/relation-22 closure already
committed synchronously by admission, and returns the existing link plus
`denied_terminal_conflict`; no closure identifier is an OUT field. Every
accepted graph requires command-local 0053 classification
`already_authoritative|late_eligible`, irrespective of its semantic result
branch. A command-local `terminal_conflict` or `not_eligible` instead takes the
retained R27 structural-conflict path, creates no typed 0053 graph or R29, and
uses the generic authenticated-structural-conflict security/containment policy
rather than the accepted later-different closure; neither disposition is the
cross-command tuple comparator. Provider diagnostics,
0053 command-outcome/classification digests and processing times are excluded
from equality. Nonterminal rows do not consume the terminal key. Withholding a
claim can delay first-link availability but cannot select evidence or delay
terminal-conflict containment. Before either later branch returns, R29's provider-evidence triple must
equal the frozen terminal-owner triple and resolve to that same owner R27 row;
a mismatch is `23514` and commits nothing.

Admission of later-different first appends one
`quarantine_security_event` with severity `critical`, reason code
`provider_terminal_result_conflict`, `offending_table =
'foundry_derivative_authenticated_evidence_v1'`, `offending_row_id` equal to the
current accepted relation-27 `ledger_row_id`, the current provider-evidence
ID/payload-raw/admission triple, the recovery caller and exact activation/
execution/attempt/fence, and `correlation_id = id`. Its state is `contained`
for a pre-custody phase and `retained` after custody. One later-sequenced
relation-22 row uses that event as `source_kind =
'quarantine_security_event'`, retains the same provider-evidence triple, has a
null target terminal state and no stop intent, and derives exactly one phase
effect: `post_terminal_broker_deny` before accepted storage creation,
`output_quarantine` after creation but before custody, or
`post_custody_evidence_only` after custody. `pre_submit_deny` and
`provider_stop` are impossible. If R29 does not yet exist, the frozen owner R27
plus its complete 0053 graph is already the terminal barrier and the effect is
exactly `post_terminal_broker_deny`; no storage/custody graph can yet exist. A
mismatched occupied security/containment key is `23514` and rolls the entire
evidence-admission transaction back. The later result call only validates this
closure and returns its status plus the canonical link, never R24/R22 IDs.

### 5.4 Evidence-admission plane

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_admit_evidence(uuid,text,bytea,bytea,bytea,text)` | evidence admitter | payload evidence ID, closed kind, raw canonical DSSE envelope bytes, raw canonical verification-report bytes, bounded kind-specific auxiliary bytes, idempotency | one generic immutable evidence row; typed projection where applicable; accepted provider-result atomically closes its exact 0053 graph and any later-different R24→R22 containment |

The closed normal kind set is `admin_action`, `predecessor_source`,
`gateway_token_commitment`, `runner_terminal`, `provider_result`,
`storage_create`, `storage_read`, and `glb_verifier`; `bootstrap_ceremony` is accepted only by
the offline bootstrap function as two distinct one-signature DSSE envelopes
over one byte-identical frozen manifest and is never accepted here. The normal
admission function first authenticates the
evidence-admitter DB caller, then validates byte-for-byte canonical envelope
and payload forms, exact one-signature DSSE shape, the admission service's
verification report, signer/root/key validity at DB admission time, nonce and
planned-ID uniqueness, and the complete relational binding. It accepts no
`signatureValid`, actor, DB time, authority verdict or parsed identity field.

Auxiliary bytes are required only for the bounded runner transcript,
authoritative predecessor-source response, raw provider response, and signed
storage-create/read response/header blocks defined by their schemas; all other kinds
require zero length. Their bytes/length/SHA are payload-bound and stored
outside the worker spool in the evidence row. An unbound URI or caller-supplied
digest cannot substitute for them.

Runner/provider/storage-create/storage-read/verifier evidence IDs and nonces must equal their
locked DB plans. Admin/source/token-commitment IDs and nonces are signer-
generated but unique by signer/kind/purpose and are one-use; their payloads
must bind the exact request/row/scope later consumed by the semantic function.
While the latest epoch is disabled, normal admission permits only
`admin_action` and `predecessor_source`; token, runner, provider, storage and
GLB kinds require the separately audited enabled test/runtime predicate.

Runner, recovery, broker and custodian roles cannot execute this function.
The evidence-admitter cannot activate, claim a provider-result API record,
create relation 29, authorize storage, classify custody or call an arbitrary
containment entry point. For accepted `provider_result` only, the admission
function itself performs one closed derived effect: it freezes the branch/owner,
inserts R27 and atomically creates or validates the complete preallocated 0053
observation/command-completion/event/classification graph under the installed
lease/revision/projection guards. A named deferred closure forbids the accepted
row without that graph. For `later_different_terminal` only, it then inserts
the exact R24→R22 security closure before commit. No caller chooses any graph,
classification, phase effect or outcome value.

That provider-result effect is a target contract, not a currently executable
positive path. It is limited to invoked recovery commands
`provider_reconcile|provider_poll|provider_stop`. For a live claim, admission
must be the sole conclusive V1 observation/completion owner, explicitly use the
planned observation/event/classification IDs, prelock the complete installed-
guard superset before those guards sample their entry clocks, and complete as
the claimed service only when
`GREATEST(command_guard_clock, old_command.updated_at + 1 microsecond) <
claim_expires_at`. Equality belongs to expired custody.

The only permitted pre-existing command arm is an authenticated V1-aware
watchdog's invoked `uncertain/unknown` expiry closure with outcome code
`claim_lease_expired_effect_unknown`. Before R27 exists, the planned event ID is
resolved from the exact command/claim→R19 grant→R20 redemption/actual-call→
invocation chain; R19 and R20 must agree and the later R27 must copy it. No
observation or classification may already exist. Baseline succeeded/failed
completion and random IDs cannot be adopted because they have already consumed
the installed unique rows and no permitted update fills the six V1 admission
columns.

The installed completion cascade can update attempts/executions, cancel a
variable pending-command set with nested transition events, and require
reconcile/stop successors; its cancellation trigger uses `SKIP LOCKED`. The
current catalog does not close those nested effects or prove the full prelock/
recheck set. Admission's semantic preamble closes equal replay, changed-key
`23505`, duplicate-content/different-key `23505`, fresh authenticated structural
conflict and fresh accepted outcomes. The accepted outcome expands to exactly
five result branches × two command-completion subarms. Every operation has a
mandatory semantic selector and guard array even when its ordinary lock/sequence
`routineEffectStepSelector` is null. The numeric semantic preamble key
`preamble:1` is distinct from accepted mutation keys `accepted:1..13`;
operation identity is the namespace and ordinal together. Tests `PR-A-001`
through `PR-A-009` are mandatory; PR-A-009 requires an exact per-operation/
subarm AST, guard, access,
write, return and error/continuation mapping plus live routine/catalog match.
The current cascade and generic structural-conflict vectors remain incomplete,
so provider-result admission and activation V1 remain **NO-GO**.

The admission function has exactly three closed derived containment branches:
an authenticated structural conflict, an accepted failed-runner projection and
an accepted `later_different_terminal` provider result. Those effects are
selected solely from verified payload and locked phase state, not admission-
caller input. Its exact artifact, canonicalizer, parser, crypto
implementation and key-registry snapshot are pinned TCB leaves in every
admission row.

Bad schema/canonical bytes/signature/untrusted key creates no evidence or typed
receipt row. A cryptographically authenticated but relationally conflicting
payload is retained in the generic ledger with disposition
`authenticated_structural_conflict`, appends the exact security and phase-
scoped containment rows, creates no typed projection, and returns a committed
`denied_structural` result. The function must not raise an exception that
rolls those forensic rows back.

Evidence admission resolves `(admitter authorization, idempotency key)` before
the submission fingerprint. Equal request SHA returns that exact row; changed
request SHA is `23505` and commits nothing. A byte-identical submission under a
different key is also `23505`, not an unrecorded alias to the first row; the
caller must retry the original key. Only a genuinely changed, cryptographically
authenticated submission under a fresh key and colliding semantic identity may
create the forensic structural-conflict row.

### 5.5 Broker plane

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_issue_broker(uuid,text)` | output broker | output reservation ID and idempotency | derives the successful frozen-spool runner receipt and canonical terminal-success link, generates one token, and creates one short-lived one-key create-only authorization; returns the canonical token plaintext once |
| `fdv1_api_redeem_broker(uuid,text,text)` | output broker | broker authorization ID, token plaintext, idempotency | one immediate-pre-PUT object-use row, derived `put_not_after`, and preallocated storage-create evidence challenge; returns the raw 32-byte create nonce once |

Issuance requires the one authenticated successful runner receipt, frozen
exact spool and canonical terminal-success link; the caller cannot choose any
of them. Because the broker itself calls
issuance, SQL may generate the capability with a CSPRNG, store only its hash
and return plaintext once; application code cannot use or expose it before
COMMIT. Use does not prove PUT. A separately admitted post-use storage-create
receipt is required. The broker streams from the runner's sealed immutable
snapshot/open-handle transfer, hashes that same stream while uploading, and
records the local digest/length in object use; reopening a mutable pathname,
copying from another file or accepting an ETag as a digest is denied. The
broker cannot list/read/overwrite/copy/delete, authorize a custodian, verify
GLB, classify custody or publish.

### 5.6 Custodian/verifier plane

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_authorize_read(uuid,text)` | output custodian | admitted `storage_create` evidence ID and idempotency | derives its broker use and creates one exact-version read-only authorization plus separate DB-issued storage-read and verifier challenges/planned evidence IDs; returns the two distinct raw 32-byte nonces once |
| `fdv1_api_read_verifier_context(uuid)` | output custodian | custodian authorization ID | read-only exact verifier context after the uniquely planned storage-read evidence is accepted; no caller-selected evidence |
| `fdv1_api_classify_custody(uuid,text)` | output custodian | output reservation ID and idempotency | derives the one canonical runner receipt, terminal-result link, create/read authorization and GLB receipt; then emits the custody/security/containment graph and disposition |

The custodian cannot create, overwrite, copy, delete or list objects; invoke a
provider; admit evidence; mutate result observations; or set any validity,
current-authority or disposition field. Malformed, unauthenticated,
signature-invalid, wrong-key or wrong-identity evidence is rejected before DB
mutation; any external security telemetry is outside this transaction and is
not claimed as a V1 row. A cryptographically authenticated relational conflict
is retained in relation 27 with its exact security/containment graph.
Authenticated GLB content invalidity is projected to relation 30 and then
classified in relation 23. One unique terminal-result link exists per
activation/attempt/fence/output slot; a later contradictory terminal
observation is conflict/containment evidence, never a caller-selectable
favorable alternative.

`fdv1_api_redeem_broker` returns canonical JCS storage-create challenge context
bytes/SHA (each at most 64 KiB) with the raw nonce; `fdv1_api_authorize_read` returns separate
storage-read and verifier-seed context bytes/SHAs with their distinct nonces.
Each context contains exactly its challenge ID, planned evidence/receipt ID,
issue/not-after interval, exact caller/signer pair,
locked activation/attempt/fence/reservation/link/object-use/create tuple and
the object selector known at that phase; it excludes the raw nonce and its own
digest. The paired broker/custodian workload passes each context only to its
registry-paired signer.

The verifier additionally needs the admitted storage-read identity, which does
not exist at read authorization. `fdv1_api_read_verifier_context` succeeds only
after the uniquely planned accepted read exists, derives it under locks, and
returns canonical bytes/SHA containing the seed context plus the accepted
storage-read evidence ID, payload-raw SHA, admission SHA, object identity,
half-open full range and read observations. Before that row exists it raises
`23514` and returns no context. The caller supplies no evidence or object ID.

Custody classification always inserts its R23 primary row first. The invalid,
conflict and late-authority dispositions then append exactly one R24 event with
reason `custody_content_invalid`, `custody_object_conflict`, or
`custody_result_authority_late`, followed by one R22
`post_custody_evidence_only` closure sourced from that event; both sequences are
later than R23, target terminal state is null and no stop intent exists. The
current-authority disposition appends neither row. Replay returns the original
graph without new side effects. This newer boundary supersedes the old draft's
no-R23/durable-security branch: malformed/wrong identity fails before V1
mutation, while an authenticated relational conflict was already retained by
evidence admission.

### 5.7 Watchdog/containment plane

| Function | Caller | Input | Mutation/result |
| --- | --- | --- | --- |
| `fdv1_api_contain_source(text,text,text)` | watchdog | closed source kind, exact source identity, idempotency | derives all and only affected live attempts; containment + exact stop closure |
| `fdv1_api_watchdog_scan(integer,text)` | watchdog | bounded scan limit and idempotency | root-first scan of scheduled/expired authorities; per-source exact containment |

Neither function accepts activation, execution, attempt, fence, actor,
terminal state, priority or stop digest from the caller. Those values are
derived from the authoritative source and locked live rows.

Each call first appends one closed relation-24 request receipt binding caller,
operation, request SHA and idempotency key. `watchdog_scan` records its bounded
limit and scanned/contained/conflict counts even when all counts are zero;
`contain_source` records the selected authoritative source and affected count.
Newly inserted containment rows correlate to that receipt; an exact pre-existing
row counted as a benign conflict retains its original receipt correlation.
Exact replay returns its original counts/sequence/time without rescanning, so a
zero-effect call is still durable and conflicting key reuse is detectable.

The counted unit is one containment obligation, exactly
`(source_kind, source_id, source_sha256, activation_id, execution_id,
attempt_id, fencing_token, phase_effect)`, together with the one implied target
terminal state, exact source-evidence binding, historically valid actor binding
and required existing/new stop closure. For `contain_source`, `affected_count` is the locked
obligation-set cardinality; `contained_count` is the number for which this
transaction inserts the relation-22 row and any required stop closure; and
`conflict_count` is the number whose unique key was already occupied by a row
that is re-read and proved byte-semantically identical, including the required
existing/reused stop intent or required absence of provider stop. A newly
inserted closure uses the current watchdog caller; an exact existing closure is
validated against its own stored caller authorization and that caller's
validity at the original receipt time, never against the current scanning
caller. Legitimate watchdog rotation therefore neither changes the obligation
identity nor creates a false conflict. Therefore
`affected_count = contained_count + conflict_count`.

For `watchdog_scan`, the bounded scan unit is that same obligation, not a source
row: `scanned_count = contained_count + conflict_count <= scan_limit`. A source
with no affected obligation contributes zero. “Conflict” is only the benign
exact-pre-existing case. A mismatched source SHA, phase effect, target state,
source-evidence binding, stored historical-caller validity, attempt graph or
stop closure is invariant corruption:
raise `23514` and roll back the receipt and every mutation. `ON CONFLICT DO
NOTHING` without re-reading and comparing the complete closure is forbidden.

After locating replay identity without returning, `watchdog_scan` takes the
global root/current-authority lock set required by section 4. Exact replay may
return only after that locked authorization succeeds. A fresh scan samples one
millisecond `scan_cutoff_at`, derives its immutable due set, takes canonical
source/attempt locks in the same selection order, and re-derives and
preclassifies every selected obligation from those locked rows at that cutoff.
It then samples the distinct post-lock `database_time`, inserts the R24 receipt
with both times and final counts, inserts only newly contained obligations and
closes deferred source/stop guards. `contain_source` instead takes its complete
root/source/attempt lock set first, samples only the ordinary post-lock
`database_time`, and requires its R24 `scan_cutoff_at` null. A failure at any
step rolls back the whole call.

The frozen watchdog cursor intent/summary says that a future implementation
would derive one deepest open V1 phase graph per exact attempt/fence; “open”
includes post-terminal output phases and is not the 0053 nonterminal-attempt
predicate. The table is not executable SQL or positive implementation authority:

| Phase code | Locked graph state | Required effect | Target / stop |
| --- | --- | --- | --- |
| `dispatch_open` | attempt state is one of `authorized`, `submit_pending`; no R17 or R29 | `pre_submit_deny` | `terminal_killed`; provider stop forbidden |
| `invocation_open` | R17 exists; neither R29 nor an accepted first-terminal R27 with its exact complete 0053 graph exists; attempt state is one of `submit_pending`, `provider_unknown`, `queued`, `running`, `checkpointing`, `stop_pending`, `terminating`, `termination_unconfirmed`, `validating` | `provider_stop` | `terminal_killed`; exact containment-sourced recovery authority/stop intent |
| `broker_open` | either successful R29 or an accepted `first_terminal_success` R27 with its exact complete 0053 graph is the terminal barrier; no accepted R27 `storage_create`; attempt state is one of `validating`, `terminal_succeeded` | `post_terminal_broker_deny` | null target; provider stop forbidden |
| `custody_open` | the same successful R29/reservation/attempt/fence has accepted R27 `storage_create`; no R23; attempt state is one of `validating`, `terminal_succeeded` | `output_quarantine` | null target; provider stop forbidden |

There is no due obligation after R23, after an accepted first-terminal-failure
R27 with its exact complete 0053 graph (whether or not R29 has been claimed),
or when an existing exact containment already denies the remaining phase. Nor is there a
due V1 phase for base attempt state `terminal_failed`, `terminal_cancelled`,
`terminal_killed`, `terminal_budget_exceeded`, `terminal_validation_failed`, or
`terminal_provider_lost` without R29, provided the complete causal 0053 event/
command/stop/containment closure required for that state is present.
`terminal_succeeded` without either the same successful R29 or the exact
accepted pre-link first-terminal-success graph is corruption. R29 may later be
inserted as historical evidence despite a post-terminal containment row, but
that containment continues to deny broker/custodian/public output. A graph that
cannot match exactly one row of this table is invariant corruption and raises
`23514`; it is not silently skipped. In particular, accepted failed R28 before
R29 must already have its admission-derived containment/stop closure and cannot
enter `invocation_open`; a missing closure or a storage-create row without the
same successful R29 graph is corruption.

For each open phase the scanner constructs due candidates from two source
classes. Class 0 is only a specific transition recorded before its future due
instant: a selected policy-generation or epoch transition uses its exact
`effective_at`; a future
`foundry_derivative_rights_policy_revocations` row uses its exact `revoked_at`,
UUID source ID and `revocation_sha256`; and an inline non-null
`foundry_rights_policy_versions.revoked_at` uses that exact `revoked_at`. The
inline `base_policy_revocation` source ID is
`policy_version:generation` and its source SHA is the row's exact
`policy_evidence_sha256`, which commits the definition SHA and revocation
boundary. If delayed scanning sees several elapsed selected-row transitions,
the first transition that invalidated the stored activation is causal; at one
effective instant, only the row selected by the authoritative current-row rule
is eligible. Revocation rows effective no later than their recording time,
compromise boundaries, kills,
quarantine events and admission-derived security sources are never watchdog
candidates: their own transaction must already have committed exact closure,
and its absence is `23514`, not repair work. An inline revocation is a specific
revocation and can never be mislabeled passive expiry.

Class 1 is one synthetic `derivative_authority_expired` phase envelope for
passive finite-horizon passage with no specific transition. It contains every
still-unconsumed finite authority member applicable to the next phase action;
already consumed submit/recovery/runner/broker/create/read/verifier evidence is
historical and excluded. Materialized `authority_not_after` values are
recomputation assertions, not duplicate members. Each member object contains
exactly:

```text
{
  kind,
  relation,
  key: [canonical primary-key components in declared order],
  rowSha256,
  notAfter
}
```

Keys are lower-case UUID, canonical positive decimal or exact stored text
strings. Times use the contract's exact millisecond UTC form. Members sort by
`kind COLLATE "C"`, `relation COLLATE "C"`, RFC-8785/JCS bytes of `key`,
`rowSha256`, then `notAfter`; duplicate member identities are forbidden.
`authorityNotAfter` is the strict minimum member time, equality with
`scan_cutoff_at` is due, and the
member-array digest uses domain
`omnitwin.foundry.fdv1.derivative-authority-expiry-members.v1`. PostgreSQL then
constructs this exact closed source object (all integer-valued JSON leaves are
canonical decimal strings):

```text
{
  schemaVersion: "omnitwin.foundry.fdv1.derivative-authority-expiry-source.v1",
  sourceKind: "derivative_authority_expired",
  activationId, activationSha256, closureId, closureSha256,
  executionId, attemptId, attemptOrdinal, fencingToken,
  phaseCode, phaseEffect, targetTerminalState,
  authorityNotAfter, authorityMemberCount, authorityMemberSetSha256
}
```

`source_sha256` is its domain-separated JCS SHA under
`omnitwin.foundry.fdv1.derivative-authority-expiry-source.v1`; `source_id` is
exactly `expiry:` followed by the digest's 64 lower-case hex characters. The
reverse guard reconstructs the locked member set and object. Caller-selected
`derivative_authority_expired` is forbidden to `contain_source`; only
`watchdog_scan` may synthesize it.

For one phase/attempt/fence, candidates rank by `(due_at ASC, source_class ASC,
source_kind COLLATE "C" ASC, source_id COLLATE "C" ASC, source_sha256 COLLATE
"C" ASC)` and only rank 1 survives. Thus an earlier passive expiry beats a
later transition, while a specific transition wins an exact-time tie. Global
winners sort by that prefix, then `(activation_id, execution_id, attempt_id,
fencing_token, phase_effect COLLATE "C")`; the first `scan_limit` obligations
are locked and processed in that order without `SKIP LOCKED`. The limit counts
obligations, so one source affecting 300 attempts consumes 300 units. The
initial candidate query excludes already fully satisfied exact obligations;
`conflict_count` is only the defensive final-lock reread case, preventing fresh
scan keys from recounting old closure forever and starving later work.

The remaining watchdog implementation blockers are machine-readable closed
catalogs for both classes: every passive `(phase_code, member_kind, relation,
primary-key projection, row-SHA expression, not-after expression, consumption
rule)` and every scheduled `(source_kind, subarm, relation, source-ID
expression, source-SHA expression, due-at expression, applicability rule)` must
be enumerated with vector tests. The expanded catalog must also encode the
two-clock order, executable cursor-state predicates corresponding to the frozen
intent/summary, historical-caller validation and winner/limit predicates. In
particular, the current derivative epoch table's
`fdv1_epoch_shape_ck` requires `effective_at <= recorded_at`, so it cannot
physically represent the future recorded transition assumed by that scheduled
source arm; its new R1 UUID also cannot silently stand in for a pre-existing
authority's source identity. The catalog schema records these as `WD-B-001`
through `WD-B-008`; WD-B-008 expressly requires those executable predicates
bound to the live routine AST/effects, a live catalog match and the complete
vector suite. The schema freezes thirteen `rejectWatchdog*` decisive negatives.
The prose classes above do not authorize inventing those matrices or declaring
those tests passed. Until every blocker is closed under a new audited contract,
`watchdog_scan` and activation V1 remain NO-GO.

### 5.8 Exact return records

No public mutator returns an unconstrained `jsonb` result. The OUT column names,
order and SQL types below are normative and are compared through `pg_proc` and
its OUT-argument arrays (`proallargtypes`, `proargmodes`, and `proargnames`). Unless an explicit arm
below permits null, every result column is non-null. `database_time` is a
millisecond-normalized post-lock DB time. For a mutator, `database_sequence` is
the immutable sequence assigned to its primary result; the two read-only
context functions use the exact existing context-version rows specified below.

The following ordinary functions return, in order,
`status text, resource_kind text, resource_id uuid, resource_sha256 varchar(71),
database_sequence bigint, database_time timestamptz, newly_committed boolean`:

- `fdv1_api_register_storage_profile`, `fdv1_api_revoke_storage_profile`,
  `fdv1_api_register_workload`, `fdv1_api_revoke_workload`,
  `fdv1_api_revoke_broker_authorization`,
  `fdv1_api_revoke_custodian_authorization`,
  `fdv1_api_register_executor`, `fdv1_api_revoke_executor`,
  `fdv1_api_record_closure`, `fdv1_api_activate`,
  `fdv1_api_prepare_submit`, `fdv1_api_enqueue_submit`,
  `fdv1_api_revoke_activation`, and `fdv1_api_disable_epoch`;
- `fdv1_api_redeem_submit`, `fdv1_api_open_recovery`,
  `fdv1_api_enqueue_recovery`, and `fdv1_api_contain_source`.

The exact ordinary-result arms are below. `R1`–`R30` mean the numbered
relations in the schema/privilege manifest. `database_sequence` is the named
primary row's action/admission sequence and `database_time` is its named time
column; a later secondary mutation never replaces either value.

| Function/arm | `status` | `resource_kind` | Primary resource ID / SHA | Primary time |
| --- | --- | --- | --- | --- |
| register storage profile / success | `registered` | `quarantine_storage_profile` | R3 `id` / `profile_sha256` | `registered_at` |
| register storage profile / namespace collision | `denied_namespace_conflict` | `register_storage_profile_denial_receipt` | R24 `id` / `event_sha256` | `recorded_at` |
| revoke storage profile | `revoked` | `quarantine_storage_profile_revocation` | R4 `id` / `revocation_sha256` | `recorded_at` |
| register workload | `registered` | `workload_authorization` | R25 `id` / `authorization_sha256` | `recorded_at` |
| revoke workload | `revoked` | `workload_authorization_revocation` | R26 `id` / `revocation_sha256` | `recorded_at` |
| revoke broker authorization | `revoked` | `output_broker_authorization_revocation` | R8 `id` / `revocation_sha256` | `recorded_at` |
| revoke custodian authorization | `revoked` | `output_custodian_authorization_revocation` | R10 `id` / `revocation_sha256` | `recorded_at` |
| register executor | `registered` | `executor_authorization` | R5 `id` / `authorization_sha256` | `recorded_at` |
| revoke executor | `revoked` | `executor_authorization_revocation` | R6 `id` / `revocation_sha256` | `recorded_at` |
| record closure | `recorded` | `candidate_relational_closure` | R2 `id` / `closure_sha256` | `recorded_at` |
| activate | `activated` | `execution_activation` | R11 `id` / `activation_sha256` | `activated_at` |
| prepare submit | `prepared` | `prepared_request_sidecar` | R13 `prepared_request_id` / `sidecar_sha256` | `recorded_at` |
| enqueue submit | `enqueued` | `provider_submit_command_sidecar` | R14 `provider_command_id` / `sidecar_sha256` | `recorded_at` |
| revoke activation | `revoked` | `execution_activation_revocation` | R12 `id` / `revocation_sha256` | `recorded_at` |
| disable epoch | `disabled` | `execution_activation_epoch` | R1 `id` / `epoch_sha256` | `recorded_at` |
| redeem submit | `redeemed` | `submit_once_redemption` | R17 `id` / `redemption_sha256` | `redeemed_at` |
| open recovery | `opened` | `recovery_authority` | R18 `id` / `authority_sha256` | `created_at` |
| enqueue recovery | `enqueued` | `provider_recovery_command_sidecar` | R14 `provider_command_id` / `sidecar_sha256` | `recorded_at` |
| contain source | `contained` | `contain_source_receipt` | R24 `id` / `event_sha256` | `recorded_at` |

The prepare/enqueue resource ID deliberately exposes the selector consumed by
the next API (`prepared_request_id` or `provider_command_id`), while the SHA is
the immutable derivative sidecar SHA. The returned pair is therefore useful
without exposing an otherwise unusable sidecar-row UUID. Epoch result time is
`recorded_at`, not its policy `effective_at`.

After the common locked current-authority check, exact replay returns the
original result fields with `newly_committed = false`; it never replaces the
stored result time/sequence or turns a historical row into current authority.

The remaining exact return records are:

| Function | Ordered OUT columns |
| --- | --- |
| `fdv1_bootstrap_seed_v1` | `status text, registry_generation bigint, bootstrap_evidence_id uuid, bootstrap_evidence_sha256 varchar(71), database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_open_attempt` | `status text, attempt_id uuid, reservation_id uuid, reservation_sha256 varchar(71), planned_runner_receipt_id uuid, runner_lease_not_after timestamptz, runner_nonce bytea, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_claim_command` | `status text, command_id uuid, grant_kind text, grant_id uuid, grant_sha256 varchar(71), grant_not_after timestamptz, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_redeem_recovery` | `status text, redemption_id uuid, redemption_sha256 varchar(71), call_event_id uuid, planned_provider_evidence_id uuid, result_challenge_not_after timestamptz, provider_challenge_context bytea, provider_challenge_context_sha256 varchar(71), provider_result_nonce bytea, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_read_provider_result_context` | `status text, planned_provider_evidence_id uuid, provider_result_context bytea, provider_result_context_sha256 varchar(71), runner_outcome text, runner_receipt_id uuid, runner_receipt_sha256 varchar(71), database_sequence bigint, database_time timestamptz` |
| `fdv1_api_record_provider_result` | `status text, provider_evidence_id uuid, result_state text, observation_id uuid, completion_event_id uuid, classification_id uuid, terminal_link_id uuid, terminal_link_sha256 varchar(71), database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_admit_evidence` | `status text, evidence_id uuid, evidence_kind text, payload_raw_sha256 char(64), admission_sha256 varchar(71), disposition text, admission_sequence bigint, admitted_at timestamptz, newly_committed boolean` |
| `fdv1_api_issue_broker` | `status text, broker_authorization_id uuid, broker_authorization_sha256 varchar(71), authorization_not_after timestamptz, broker_token text, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_redeem_broker` | `status text, broker_object_use_id uuid, broker_object_use_sha256 varchar(71), planned_storage_create_evidence_id uuid, create_challenge_not_after timestamptz, storage_create_challenge_context bytea, storage_create_challenge_context_sha256 varchar(71), storage_create_nonce bytea, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_authorize_read` | `status text, custodian_authorization_id uuid, custodian_authorization_sha256 varchar(71), planned_storage_read_evidence_id uuid, storage_read_not_after timestamptz, storage_read_challenge_context bytea, storage_read_challenge_context_sha256 varchar(71), storage_read_nonce bytea, planned_verifier_evidence_id uuid, planned_verifier_receipt_id uuid, verifier_not_after timestamptz, verifier_seed_context bytea, verifier_seed_context_sha256 varchar(71), verifier_nonce bytea, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_read_verifier_context` | `status text, planned_verifier_evidence_id uuid, planned_verifier_receipt_id uuid, verifier_context bytea, verifier_context_sha256 varchar(71), storage_read_evidence_id uuid, storage_read_payload_raw_sha256 char(64), storage_read_admission_sha256 varchar(71), database_sequence bigint, database_time timestamptz` |
| `fdv1_api_classify_custody` | `status text, custody_id uuid, custody_sha256 varchar(71), disposition text, result_authority_not_after timestamptz, database_sequence bigint, database_time timestamptz, newly_committed boolean` |
| `fdv1_api_watchdog_scan` | `status text, scanned_count integer, contained_count integer, conflict_count integer, database_sequence bigint, database_time timestamptz, newly_committed boolean` |

The closed status/primary-row rules for those custom records are:

| Function/arm | Exact status (and discriminator) | Primary/version sequence and time |
| --- | --- | --- |
| bootstrap seed | `seeded` | R27 bootstrap row `admission_sequence`, `admitted_at` |
| open attempt | `opened` | R15 reservation `action_sequence`, `reserved_at` |
| claim submit command | `claimed`, `grant_kind = 'submit_once'` | R16 grant `action_sequence`, `issued_at` |
| claim recovery command | `claimed`, `grant_kind = 'recovery_call'` | R19 grant `action_sequence`, `issued_at` |
| redeem recovery | `redeemed` | R20 redemption `action_sequence`, `redeemed_at` |
| read provider context | `ready` | context-version sequence from the rule below; fresh post-lock DB clock |
| record nonterminal provider result | `pending`, `result_state = 'nonterminal'` | claimed R27 `admission_sequence`; observation `fdv1_api_claimed_at` |
| record first terminal success | `recorded`, `result_state = 'terminal_success'` | claimed R27 `admission_sequence`; observation `fdv1_api_claimed_at` |
| record first terminal failure | `recorded`, `result_state = 'terminal_failure'` | claimed R27 `admission_sequence`; observation `fdv1_api_claimed_at` |
| record later same terminal | `recorded_same_terminal`, current evidence's result state is `terminal_success` or `terminal_failure` | claimed R27 `admission_sequence`; observation `fdv1_api_claimed_at` |
| deny later different terminal | `denied_terminal_conflict`, current evidence's result state is `terminal_success` or `terminal_failure` | claimed R27 `admission_sequence`; observation `fdv1_api_claimed_at` |
| admit accepted evidence | `accepted`, `disposition = 'accepted'` | R27 `admission_sequence`, `admitted_at` |
| admit authenticated structural conflict | `denied_structural`, `disposition = 'authenticated_structural_conflict'` | R27 `admission_sequence`, `admitted_at` |
| issue broker authorization | `issued` | R7 `action_sequence`, `recorded_at` |
| redeem broker authorization | `redeemed` | R21 `action_sequence`, `authorized_at` |
| authorize read | `authorized` | R9 `action_sequence`, `recorded_at` |
| read verifier context | `ready` | accepted storage-read R27 `admission_sequence`; fresh post-lock DB clock |
| classify custody | `classified` | R23 `action_sequence`, `committed_at` |
| watchdog scan | `scanned` | R24 request receipt `action_sequence`, `recorded_at` |

The bootstrap physical primary key is R27 `ledger_row_id`, but its public
record returns the semantic `evidence_id` and `admission_sha256`; the admission
SHA/sequence disambiguate a retained conflict row that may share a semantic ID.
Broker `database_time` is `recorded_at`, not `issued_at`. Provider-result API
replay is keyed by the dedicated V1 columns on the 0053 observation row, but
its returned sequence deliberately identifies the processed admitted evidence
while its time is that observation's `fdv1_api_claimed_at`.

The exhaustive fresh-key provider-result branch table is:

| Selected accepted unclaimed graph | Required 0053 state | New V1 managed rows in result call | Returned link | `newly_committed` |
| --- | --- | --- | --- | --- |
| nonterminal | complete admission-materialized graph; no installed 0053-field mutation; four V1 API-claim columns update | none | null pair | `true` |
| first terminal success | complete admission-materialized graph; no installed 0053-field mutation; four V1 API-claim columns update | one new R29 | new R29 | `true` |
| first terminal failure | complete admission-materialized graph; no installed 0053-field mutation; four V1 API-claim columns update | one new R29 | new R29 | `true` |
| later terminal, equal tuple | complete admission-materialized graph; no installed 0053-field mutation; four V1 API-claim columns update | none | existing R29 | `true` |
| later terminal, unequal tuple | complete admission-materialized graph plus existing R24→R22; no installed 0053-field mutation; four V1 API-claim columns update | none | existing R29 | `true` |

Exact API replay occurs only after the pre-root identity-only work and the
global-root/current-authority preamble described above. It locks the dedicated observation
`(fdv1_recovery_caller_id,fdv1_api_idempotency_key)` row and its stored
`fdv1_api_request_sha256`, follows and locks that row's R27 evidence triple and
branch-specific R29, and for later-different also locks the exact current-R27-
linked R24 and R24-sourced R22. It samples the common operation-1 clock only
after the complete set and revalidates the R5-pinned recovery caller/provider
signer plus recursive R25/R26 lineage. It compares the stored SHA to the exact
`sql_derived_api_request_sha256`.
It then returns every original field: status from the stored branch mapping;
provider evidence, result state, planned observation/completion/classification
IDs and sequence from that locked R27; the originally null or locked current/
owner R29 link pair; time from observation `fdv1_api_claimed_at`; and literal
`newly_committed = false`. It never acquires a link created after an original
nonterminal call and never returns R24/R22 IDs. The existing 0053 `actor_key`, internal `idempotency_key`, and
`request_digest` retain their installed meanings. Changed reuse of that caller/
key is `23505`; the same key with another execution necessarily differs because
execution ID is in the SQL-derived wrapper. A fresh key with no unclaimed accepted complete graph, a
missing/incomplete admission graph, or a rechecked impossible frozen branch is `23514`
with no mutation. An authenticated relational arm mismatch is retained earlier
by evidence admission as a relation-27 conflict and is never eligible for this
scan. First terminal allocates only R29's V1 action sequence; nonterminal,
later-same and later-different allocate none in the result call. The later-
different R24 then R22 allocations occurred after R27 inside its evidence-
admission transaction. All five result branches return the selected R27
admission sequence and new claim time, never one of those V1 action sequences.

Fresh results resolve the same 11-field order exactly. Common sources are the
selected R27 evidence ID/state/planned observation, completion and classification
IDs/admission sequence, the claimed-observation time, and literal true. Status
and link sources are per arm: pending plus null link for nonterminal; recorded
plus operation-7 R29 for first-success/failure; recorded-same-terminal or denied-
terminal-conflict plus the locked frozen-owner R29 for later-same/different.
Semantic branch effects must bind those exact sources, not a union.

On a fresh result call, after the complete lock set, SQL separately samples
`fdv1_api_claimed_at`, fills exactly the four API-claim columns and computes the
V1 binding from their final values. The installed observation `recorded_at` and
every 0053 command/event/classification field remain unchanged. First-terminal
R29 `linked_at` equals this claim time. Exact replay returns it unchanged.

`runner_nonce`, `provider_result_nonce`, `broker_token`,
`storage_create_nonce`, `storage_read_nonce`, and `verifier_nonce` are non-null
only when `newly_committed = true` and have the exact lengths/encoding from
section 4. `completion_event_id`, `classification_id`, `terminal_link_id`, and
`terminal_link_sha256` follow the exact arms below. Provider challenge/result,
storage-create/read and verifier seed/final context bytes and SHAs are nonsecret
and remain non-null on exact replay/read. For provider-result processing,
`observation_id`, `completion_event_id`, and `classification_id` are non-null
for every processed nonterminal or terminal evidence row. Only the terminal
link pair is null for a nonterminal result; it is non-null for a returned
canonical terminal row, including a conflict return pointing to the existing
canonical link. In the provider-context read, the runner pair is null exactly
for `runner_outcome = 'absent'` and non-null for `succeeded|failed`.
`result_authority_not_after` is nullable only for a
forensic late/invalid/conflict custody disposition. No other nullable output is
permitted.

For mutators, `database_sequence` and `database_time` are the immutable values
of the committed primary result described above. The two read-only context
functions allocate no sequence and return a fresh millisecond-truncated
post-lock `clock_timestamp()` as `database_time`:

- `fdv1_api_read_provider_result_context` returns the locked relation-20
  recovery-redemption `action_sequence` while `runner_outcome = 'absent'`, or
  the uniquely planned relation-28 runner-receipt `action_sequence` when the
  outcome is `succeeded|failed`; and
- `fdv1_api_read_verifier_context` returns the uniquely planned accepted
  relation-27 storage-read `admission_sequence` whose arrival makes the final
  context available.

Those sequence sources identify the immutable row that determines the returned
context version; neither read is an idempotency-bearing mutation and neither
returns `newly_committed`.

## 6. Source-scoped containment

The internal resolver has one closed branch per source kind. It first verifies
the exact source ID/SHA in its authoritative table, then derives affected
activations/attempts by the relationships below. There is no catch-all or
digest-only join.

| Source | Exact applicability to an activation/attempt |
| --- | --- |
| derivative policy revocation | activation approval/attestation has the same policy version, definition and generation |
| derivative generation supersession | activation generation is the exact superseded generation for that policy version |
| base policy revocation | execution carries the exact base policy version/definition/generation |
| base generation supersession | execution carries the exact superseded base generation |
| registry attestation revocation | activation references that exact attestation ID/SHA |
| workload authorization revocation | a signer leaf affects exact evidence/phase rows storing that signer; a DB-caller leaf additionally affects signer rows whose immutable paired-caller ID/SHA names it, then their evidence/phase consumers; a `trust_root` follows only inclusion-authority descendants, their direct caller/signer children, the same exact caller-to-paired-signer edge and resulting evidence/phase consumers; compromise time is applied at the phase action/admission time |
| executor authorization revocation | activation references that exact executor authorization ID/SHA |
| broker authorization revocation | attempt reservation is the revoked broker authorization's exact reservation |
| custodian authorization revocation | attempt reservation/object chain is the exact custodian authorization target |
| storage profile revocation | closure/reservation uses the exact profile ID/version/SHA |
| activation revocation | exact activation ID/SHA only |
| epoch disabled/replaced | activation references the exact old epoch composite |
| derivative authority expired | watchdog derives the expired phase and exact activation/attempt/fence; no arbitrary source ID |
| global/scoped kill | fixed 0053 kill scope predicate matches provider/project/execution/attempt |
| accepted runner terminal failure | exact failed relation-28 evidence triple and same activation/execution/attempt/fence; admission derives provider-stop containment before a terminal link or broker denial after a terminal-failure link |
| quarantine security event | event already carries the same exact activation/execution/attempt/fence |

For every applicable provider-bound open phase graph, an immediate source
transaction must
append or verify exactly one containment event and its exact existing/reused
stop intent before commit. A source not applicable to an attempt cannot create
containment for it. Conversely, an immediate authority-loss source cannot
commit without closure. The sole exception is a source row recorded before a
future `effective_at`/inline `revoked_at`: its registration may commit before
the boundary, but it is not yet an authority loss. At and after that boundary,
the deterministic watchdog branch is required and every ordinary phase action
fails closed until the exact closure exists. The deferred reverse closure is
therefore `source -> exact affected set` and `containment -> exact source and
same affected attempt`, not a global existential query.

Global kill and base-rights revocation reuse the exact fixed 0053 stop intent
and do not add a lower-priority duplicate. All other branches derive the
contract's exact derivative reason, priority, actor and digest mapping.

Containment effect is phase-aware:

| Affected phase | Required effect |
| --- | --- |
| before submit redemption | deny/contain the exact attempt; no provider stop for work never invoked |
| possible invocation or provider possibly active | containment plus one exact recovery authority/stop intent for that fence |
| terminal provider result, before upload | retain evidence and quarantine/deny broker; no fictitious provider stop |
| object created/read/verifying | quarantine the exact output and deny later phase; do not kill unrelated or already-terminal provider work |
| post-custody | retain and mark evidence/current-authority impact; never rewrite custody or create a new execution |

A DB-caller/signer revocation applies only where that exact authorization was
used, plus the explicit DB-caller-to-paired-signer edge and that signer's exact
consumers. Revoking a watchdog, auth gateway, evidence admitter or post-terminal
custodian denies its future actions and invalidates affected evidence at the
recorded/compromise boundary; it does not blindly terminal-kill every live
derivative attempt. The source-to-effect branch is part of the exact catalog
and concurrency test manifest.

Root revocation is not a global registry-generation kill. The resolver is
seeded with the exact revoked trust-root pair and recursively follows only
runtime trust-root rows whose stored
`(inclusion_authority_root_id,inclusion_authority_root_sha256)` equals the
prior member's `(id,authorization_sha256)`. It rejects a revisited pair as
corruption even though strict prior `action_sequence` is also required. The
affected set is exactly that seed plus those inclusion-authority descendants,
then DB-caller/evidence-signer rows whose exact parent pair is a member, then
every evidence signer whose immutable `(paired_caller_id,
paired_caller_sha256)` names an affected DB caller even when the signer's own
parent root is different, and finally evidence/phase rows carrying any of those
exact root/caller/signer pairs. The pairing hop does not mark the signer's
parent root, its siblings or unrelated consumers as affected. Same-domain,
same-key, registry-wide and digest-only matches are excluded. Every
registration, evidence admission, phase action and watchdog path calls this
same closure after root-first locks and rechecks both signer and paired-caller
lineages. The retroactive boundary is
`coalesce(compromise_not_before, recorded_at)` for each revocation; rows before
a later non-retroactive boundary are not inferred affected.

## 7. Phase-specific authority

One internal function computes each phase; no universal `authority_not_after`
is reused.

- Activation/attempt/prepare/claim/submit redemption recompute current
  dispatch authority and its least horizon.
- Recovery derives only from historical redemption/containment and the
  one-call grant horizon.
- Broker issuance/use derives from historical submit redemption plus current
  reservation/storage/broker/spool evidence.
- Custodian read derives from exact create receipt plus current
  storage/custodian/verifier read authority.
- Custody validates every historical action at its own recorded DB time.
- Current result classification calls only
  `fdv1_result_authority_at(uuid,uuid,timestamptz)` from the authenticated
  evidence contract. It must not call fixed V0
  `foundry_execution_authority_is_current`, inspect pricing/dispatch expiry,
  or reuse activation/submit horizons.

All mutation/action clocks are PostgreSQL DB clocks sampled after their full
lock set. The watchdog's persisted due-set `scan_cutoff_at` is the sole
selection-only exception described in section 4: it is sampled after the global
authority lock, before selected-row integrity locks, and is not an action time.
Worker, provider, HTTP, object-store and caller times remain observations.

## 8. Grants and table-denial matrix

Each service group has EXECUTE only on the functions in its subsection.
`omnitwin_api_activation` cannot call claim/redemption/output functions;
claimer cannot redeem; submit and recovery cannot call each other; evidence
admitter, broker, custodian and watchdog are mutually disjoint.

All eight groups and their login members have zero direct DML on:

- all activation V1 tables, including the workload authorization/revocation
  registry, generic authenticated-evidence ledger and the three typed
  evidence/link projection tables;
- `foundry_executions`, `foundry_attempts`,
  `foundry_prepared_provider_requests`, `foundry_provider_commands`,
  `foundry_execution_events`, result observations/classifications,
  `foundry_stop_intents`, and `foundry_verified_checkpoints`; and
- every legacy/public/release/runtime table in activation-contract section 12.

No service group owns a function, table, sequence, schema or policy. No group
has grant/admin option. The function owner is not directly login-capable.

## 9. Catalog proof

The frozen migration test enumerates exact expected rows and fails closed on
extras, omissions, truncation, overloads or privilege drift across:

- `pg_roles`: role attributes and exact login/group separation;
- `pg_auth_members`: exact direct `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`
  edge and no nested/cross-plane/owner/migration edge;
- `pg_proc`: name, schema, owner, language, volatility, parallel safety,
  `prosecdef`, exact argument OIDs/count, zero defaults/variadic, return type,
  `proconfig`, and ACL;
- `pg_namespace`: no service/public CREATE on trusted schemas;
- `pg_class`, `pg_constraint`, `pg_trigger`, `pg_index` and `pg_sequence`:
  expected identities, owners, ACLs, `relrowsecurity` and
  `relforcerowsecurity`, including owner capabilities on every touched 0053
  relation;
- `pg_policy`: exact expected policy set; no permissive or accidental service
  policy and no reliance on an omitted policy;
- `pg_attribute`: every expected column name/type/nullability/order, UTF-8
  octet length at most 63, and no silent truncation/collision; and
- default-privilege and schema ACL catalogs plus `information_schema`
  privilege views and `has_*_privilege` checks for the positive and complete
  negative matrix.

Every source-declared function/signature, type, table, column, role, trigger,
constraint, index, sequence and policy identifier is first checked with
`octet_length(source_name) <= 63`; a source manifest is then compared to exact
catalog names and namespace/parent-scoped collision keys. Checking only the
already-truncated catalog name is insufficient.

## 10. Static, live and adversarial tests

At minimum, the exact candidate implementation must prove:

1. generation-1 disabled rejects every activation/external-action API while
   allowing only the exact one-time bootstrap, inert registry/profile/source
   registration, reads and negative tests explicitly permitted by the
   activation contract; same-key/equal-request bootstrap replay returns the
   original only while the temporary grant remains, whereas changed reuse or a
   fresh second-bootstrap key denies, and any open bootstrap membership denies
   enablement;
2. each role's one positive function set and every cross-plane/direct-DML/
   owner/schema/sequence/policy negative case;
3. `PUBLIC` execution denial, exact signature grants, no overload/default/
   variadic ambiguity, no callable V1 internal trigger/helper and no
   service-callable existing `SECURITY DEFINER` mutation helper;
4. malicious `pg_temp` and public tables/functions/operators/types, changed
   search path, prepared statements, connection reuse, `SET ROLE`, `RESET
   ROLE`, null/wrong `system_user`, generic pooler and cross-membership;
5. exact/conflicting idempotent replay, duplicate concurrent calls, rollback
   at every intermediate insert, serialization retry, zero-row update and
   deferred-closure failure;
6. activation/policy/epoch/revocation/kill/time races in both commit orders
   under root-first locks, with no deadlock or reverse acquisition;
7. gateway token-commitment wrong signer/plane/scope/hash/expiry/reuse, submit
   claim/grant/redemption non-reissuance, wrong token/actor/fence/event, crash
   before/after commit, fixed-V0 reaper/claim-expiry retokenization, and no
   recovery submit/checkpoint path;
8. every containment source with one affected, multiple affected, unrelated
   live, terminal, missing, spoofed and cross-project attempt, proving exact
   forward and reverse closure;
9. evidence admission, broker and custodian functions against raw-byte
   duplicate/lexical/signature/key tests and the complete authenticated-result-
   evidence adversarial suite;
10. dispatch/pricing/executor expiration after valid submit followed by valid
    forensic custody; current rights/epoch/storage/result-window expiration
    must separately deny only current disposition;
11. direct checkpoint and public/runtime/quarantine-reference smuggling at
    every guarded surface; and
12. admin-action replay across action/tenant/subject/request and every
    predecessor kind against the exact authoritative-source matrix;
13. provider evidence atomically producing R27 and the complete 0053 outcome/
    observation/completion/classification graph (plus later-different R24→R22),
    followed by a claim-only result call that creates R29 only for a first-
    terminal arm, with rollback at every intermediate point and no direct-DML
    alternative;
14. exact per-phase compromise/revocation behavior proving that output-only or
    watchdog/custodian revocation does not stop unrelated provider work; and
15. exact source-manifest/catalog enumeration including `pg_policy` and
    `pg_attribute` on PostgreSQL 16.14, plus full 0000-0058 replay; and
16. record-result rejection for same caller/key with another execution, missing
    later-different replay R24/R22, authorization after fresh operation 2,
    incomplete caller/provider-signer ancestor closure, expanded historical-
    result authority, concatenated/reordered guards, missing branch effects,
    flat-union substitution, or any non-exact 11-field return source.

Positive-path pre-0059 testing may create a candidate enabled epoch only in a
disposable network-isolated database and must destroy it afterward. It is not
authority to create, merge or apply 0059 anywhere.

## 11. Acceptance and non-claims

This design is GO for activation-contract integration only if an independent
review of the frozen evidence and API specs reports no P0/P1/P2 finding and
confirms:

- every service mutation has exactly one role-authenticating entry point;
- no intended positive path depends on direct table DML;
- caller identity is derived from the authenticated DB session and one-plane
  authorization rather than request content;
- function ownership, search path, overload and PUBLIC/default privileges are
  closed;
- containment resolves each authoritative source to all and only its exact
  affected live attempts;
- custody uses the authenticated three-record graph and a separate result
  horizon; and
- all authority-none and quarantine/public-denial invariants survive.

Even a clean design audit is not implementation evidence. It does not prove
that workload identities, keys, auth gateway, runner, provider gateway,
broker, custodian, object lock, versioning, KMS, network namespace, PostgreSQL
roles, or live services exist. The frozen 0058 draft and migration 0059 remain
NO-GO until the amended SQL/application/infrastructure evidence and a final
independent frozen-hash audit pass.
