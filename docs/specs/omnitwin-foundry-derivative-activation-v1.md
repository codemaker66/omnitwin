# OmniTwin Foundry derivative activation V1

Status: **NO-GO — second amendment awaiting independent re-audit after the output-prefix incompatibility found by disposable PostgreSQL implementation.**

The previous revision of this document is superseded in full by this revision.
It grants no activation authority, authorizes no production action, and is not
evidence that the application, IAM, storage, worker, broker, custodian, or live
database boundary exists. Migrations 0053 through 0057 must remain
byte-identical. Migration 0058 may install only the disabled substrate defined
here and must seed generation 1 with `enabled = false`. Migration 0059 remains
prohibited until the amended contract passes independent re-audit and all
application, IAM, storage, and live-PostgreSQL evidence is bound into an
enabled epoch.

## 1. Audited repository baseline

This contract closes concrete gaps in the current tree; it does not infer that
the existing V0 classifier already closes them.

- `packages/api/drizzle/0056_foundry_derivative_execution_barrier.sql:54-114`
  validates the broad job/stage shape, but its exact-stage branch at lines
  105-114 does not require `outputNames`, `checkpoint`, `resumable`, a
  non-null storage profile, or the exact output prefix.
- `packages/api/drizzle/0057_foundry_derivative_execution_candidates.sql:739-797`
  closes the singleton stage, command, network, input, worker, image, and
  operation binding. It does not close those five output/checkpoint leaves.
  Lines 850-870 require only that the base execution subject's
  `checkpointContract` be null.
- `packages/types/src/omnitwin-foundry.ts:1594-1645` permits arbitrary
  non-empty `outputNames` and permits `checkpoint = "none"` with either
  resumability value; lines 1716-1728 permit a nullable
  `objectStorageProfile` and a free job `outputPrefix`.
- `packages/api/src/services/foundry-provider-request-authorization.ts:430-490`
  parses those stage leaves, lines 576-580 parse the nullable storage binding,
  and lines 1307-1310 and 1471-1495 propagate them. The activation boundary
  must therefore validate the stored leaves again instead of trusting the
  compiler.
- `packages/api/drizzle/0053_foundry_execution_control.sql:3620-3723` defines
  mutable command claim columns but no referencable unique command-claim
  tuple. Lines 4222-4264 expose a direct verified-checkpoint table. Lines
  9180-9217 preserve claim identity only for a claimed-to-terminal transition,
  not as a derivative-wide prohibition on retokenization.
- `packages/api/drizzle/0053_foundry_execution_control.sql:2715-2833` and
  `packages/api/src/db/schema.ts:4405` require
  `foundry_executions.admitted_by_user_id` to reference `users`. V1 activation
  admission is consequently limited to a current platform-administrator user;
  a service principal cannot be written into that column without a later base
  schema version.
- `packages/api/drizzle/0053_foundry_execution_control.sql:3038-3159` fixes
  the existing stop-intent source/reason/priority/terminal/actor/digest shape;
  lines 6448-6610 close each existing source in
  `guard_foundry_stop_intent`. Derivative containment must ALTER and replace
  those exact checks/guards, not create an unconnected stop mechanism.
- `packages/api/drizzle/0053_foundry_execution_control.sql:3540-3579` makes
  `provider_invocation_started` an audit-only, non-projecting event with
  `provider_was_invoked = NULL`. Its guard at lines 8084-8119 requires a live
  claimed command and `event.actor_key = command.claimed_by`. The current
  command store inserts it before the adapter call at
  `packages/api/src/services/foundry-postgres-provider-command-store.ts:765-802`.
- The public/runtime denial surface includes `spaces.mesh_url`
  (`packages/api/src/db/schema.ts:144`), `asset_definitions.mesh_url` (line
  332), `asset_versions.r2_key/external_url/sha256` (lines 997-1000), all four
  runtime-package asset-version columns and `manifest_json` (lines 1048-1052),
  and nested `assets.visualAssetVersionIds`
  (`packages/types/src/asset-version.ts:490-516` and
  `packages/api/src/routes/assets.ts:312-313`).
- Reconstruction release storage and manifest fields are at
  `packages/api/src/db/schema.ts:2827-2839`; review visual, transform, and scene
  references at lines 2883-2899; evidence-object fields at lines 2935-2943;
  attestation digests and `r2_key` at lines 2968-2983; and publication
  bucket/prefix/key/URL fields at lines 3022-3045. The underlying migration is
  `packages/api/drizzle/0049_reconstruction_foundry.sql:7-44,131-176,190-218,232-279`.
  Channels and channel events are downstream release surfaces too.
- Adjacent direct object/public pointers also exist at
  `packages/api/src/db/schema.ts:94` (`venues.logo_url`), lines 145, 331,
  428-429, 545-547, and 747-750 (thumbnail/image/lightmap/diagram/PDF
  pointers), and lines 783-797 (`files.file_key/sha256/visibility`). They are
  in scope in section 12 rather than assumed harmless from their nominal media
  type.

These anchors are the minimum code surfaces the 0058 review must revisit. Line
movement does not narrow the required behavior.

## 2. Rollout invariant

Activation requires all of the following separate stages:

1. **0058, disabled database substrate.** Add only the append-only tables,
   composite keys, predicates, functions, guards, deferred closures, indexes,
   root locks, containment logic, and legacy/public denials in this document.
   Seed epoch generation 1 disabled. No derivative execution row, attempt,
   submit claim, submit grant, redemption, output capability, or invocation may
   be created while the current epoch is disabled.
2. **Coordinated application release.** Install the separately reviewed
   activation store, claimer, submit gateway, recovery gateway, worker runner,
   spool broker, custodian, watchdog, and public-surface scanners. Merely
   publishing TypeScript schemas is not sufficient.
3. **Coordinated infrastructure release.** Install workload identities,
   namespace isolation, an attempt-scoped local spool, immutable/versioned
   quarantine storage, one-key create-only broker credentials, distinct
   version-read-only custodian credentials, and release/runtime IAM denial.
4. **Evidence and independent re-audit.** Pass the test matrix in section 15
   against the exact migration, application artifacts, worker image, IAM
   policies, and storage configuration.
5. **0059, and only 0059, may enable.** It may append generation 2 enabled only
   when the re-audited epoch JSON binds every exact artifact and receipt. It
   must not modify 0053-0057 or weaken 0056's legacy classification.

No stage above implies permission to perform a later stage.

## 3. Closed derivative subject

The only V1 subject is one attempt for one exact deterministic transformation:

| Leaf | Required value |
| --- | --- |
| stage count | exactly one |
| stage kind | `geometry` |
| stage command | exactly `["omnitwin-sealed-worker","normalize_mesh_glb","v0"]` |
| operation | `normalize_mesh_glb/v0` |
| operation class | `deterministic_transformation` |
| derivative class | `lossless_internal_format_normalization` |
| rights purposes | exactly `["commercial_internal_use"]` |
| network | `none` |
| input count | exactly one |
| input | the approved source asset, type `glb_gltf`, media type `model/gltf-binary`, suffix `.glb` |
| output names | exactly `["normalized.glb"]` |
| output slot mapping | exactly `normalized_glb_v0 -> normalized.glb` |
| checkpoint | `none` |
| resumable | `false` |
| source mount | `read_only` |
| object storage profile | exact non-null V1 quarantine profile ID |
| output prefix | exact output-reservation prefix |
| maximum attempts | `1` |
| output disposition | `quarantine_only` |

Signing, checkpointing, release, publication, redistribution, public serving,
runtime promotion, additional inputs or outputs, aliases, wrappers, shells,
unknown versions, and extra stages are structurally outside V1.

### Relational leaf closure

0058 adds `foundry_derivative_candidate_relational_closures_v1`. Its canonical
closed tuple contains the candidate/job/envelope identities and digests plus
every leaf in the table above, the exact stage ID, source asset ID and digest,
worker-profile ID/SHA, immutable container digest, quarantine storage-profile
ID/version/SHA, output prefix, literal slot, and literal filename.
`UNIQUE(candidate_id)` permits at most one closure per candidate, and
`UNIQUE(id, closure_sha256)` is its downstream reference key. Existing
candidates have no backfill obligation; they remain inert. An activation
requires exactly one already-present exact closure and fails if it is absent.

The job JSON is parsed and compared to these normalized relational columns.
The quarantine predicate is **relational equality of normalized leaves and
composite foreign keys**, not byte equality between unrelated JSON documents
and not a bucket/key substring heuristic. A closed canonical JSON/SHA is
additional tamper evidence; it is not a substitute for column equality.

Prepared requests, prepared sidecars, provider commands, command sidecars,
submit grants, recovery-call grants, output reservations, broker and custodian
authorizations, and custody rows carry `(closure_id, closure_sha256)` and
duplicate only the phase-relevant stage/source/slot/filename/profile/prefix
leaves. Their sole closure FK is the two-column key above. Each mutation guard
locks that closure row `FOR KEY SHARE` (or `FOR UPDATE` when itself changing)
and compares every duplicated leaf to it before accepting the row. No
full-leaf index, “monster” unique constraint, or FK is allowed; no new 0058
index/constraint may exceed 32 columns, and the intended smaller identity keys
are listed in section 11. The base job, prepared request, and provider command
receive sidecars rather than changes to their closed V0 subject.

## 4. Distinct authority planes

Submission, recovery, upload, and custody are deliberately different
authorities. No token, row, IAM principal, or database role is valid in more
than one plane.

### 4.0 Activation and executor binding

`foundry_derivative_execution_activations_v1` binds the unique candidate and
candidate reservation, approval/review/attestation evidence, closure, base
execution subject, project/job/envelope/manifest, execution, stage/source,
worker, restriction-lineage/output policy, executor authorization, authority
horizon, and the full epoch composite. Its closed flags are exactly
`authority = "execute_once"`, `execution_eligible = true`,
`dispatch_enabled = true`, `output_disposition = "quarantine_only"`, and
`single_submit_redemption = true` and `single_initial_start = true`.
“Initial start” is the one conservative submit-redemption boundary described
below; it is not a count or proof of external effects. Candidate, execution,
activation SHA, and administrator/idempotency identities are unique. Explicit
revocation is a separate append-only row.

`foundry_derivative_executor_authorizations_v1` binds the executor and submit
gateway's exact issuer/subject/audience/credential-kind/workload-identity SHAs;
provider kind/target; adapter ID/version/artifact/configuration SHAs;
deployment SHA; request-profile ID/version/SHA; worker-profile ID/SHA;
immutable container digest; command, operation, operation class, and stage;
DB validity interval; administrator user; and closed authorization JSON/SHA.
It grants submit-plane eligibility only and grants neither recovery, upload,
nor custody authority. Its append-only revocation table permits exactly one
revocation per authorization.

### 4.1 Immutable submit-once authority

`foundry_derivative_submit_once_grants_v1` is mandatory for a claimed
`provider_submit`. The claimer inserts exactly one grant in the same
SERIALIZABLE transaction that first sets the command claim. Deferred coverage
enforces both directions: every claimed derivative submit has exactly one
grant, and every grant names exactly one claimed derivative submit.

Required grant bindings are grant ID/SHA, activation ID/SHA, closure ID/SHA,
execution/attempt/ordinal/fence, exact prepared request and command/payload/
provider-request identities, the referencable command-claim tuple, executor
authorization and authenticated executor/submit-gateway workload identities,
token SHA only, an opaque `planned_invocation_event_id`, DB issuance/expiry
times, authority horizon, and closed receipt JSON/SHA. The planned UUID has no
FK because the event is created in a later transaction.

There is exactly one grant per activation, not “at most one.” It is immutable,
non-replaceable, and non-reissuable even if unredeemed, expired, lost after
commit, or followed by a crash. Plaintext is generated with an application
CSPRNG, returned only after commit, never logged or stored, and never accepted
by any recovery endpoint.

`foundry_derivative_submit_once_redemptions_v1` records the only permitted
redemption. Grant, activation, command-claim tuple, token SHA, invocation event,
and external idempotency key are independently unique. The submit gateway
authenticates both workload identities, locks root-first, samples DB time,
revalidates through the bounded API-call horizon, and in one transaction
creates the actual `provider_invocation_started` row with
`event.id = grant.planned_invocation_event_id` and the redemption row with a
real FK to that event. A guard enforces that exact ID equality. The grant never
references the future event.

For V0 compatibility, the exact authenticated submit-gateway actor key is
written to `foundry_provider_commands.claimed_by`; the separate executor/
claimer workload identity remains in the grant. The invocation event uses
`actor_kind = "service"` and derives `actor_key = command.claimed_by`. Recovery
commands use the same rule with the recovery-gateway actor key as
`claimed_by`. No gateway may claim as one principal and emit the event as
another.

The committed `provider_invocation_started` event is the conservative,
irreversible **pre-call/possible-invocation boundary** required by fixed 0053.
It is audit-only, does not advance the projection, leaves
`provider_was_invoked` null, and proves only that authority was consumed and a
call may follow. It never proves provider/process contact. Actual contact,
start, or completion requires separately authenticated provider response,
process-start receipt, result observation, and applicable custody evidence.
Only after the redemption/event transaction commits may the gateway make one
external call.

0058 does not rename that fixed event or reinterpret its downstream FKs. The
existing 0053 sequence/claim/actor checks still run; the derivative replacement
adds exact redemption and planned-ID equality. Result observation may cite the
event as its causal “possible invocation” boundary, while
`provider_was_invoked`, lifecycle, completion, and success must come from the
later authenticated evidence already required by 0053 plus this custody
contract.

PostgreSQL cannot commit atomically with that call. A crash after redemption
may lose the call; a timeout after a possible call is `provider_unknown`.
Neither case permits a second submit grant, redemption, claim token, or call.
V1 claims at-most-once redemption and reconcile-on-unknown, not exactly-once
external execution.

### 4.2 Structurally submit-incapable recovery

`foundry_derivative_recovery_authorities_v1` has a closed allowed-kind set of
exactly `provider_poll`, `provider_reconcile`, and `provider_stop`. Its schema
has no submit scope, submit token, submit request, checkpoint scope, output
write capability, or generic command-kind field. Database roles permitted to
use it cannot call submit redemption.

A recovery authority is derived only from:

- an immutable historical submit redemption for the same
  activation/execution/attempt/fence; or
- an immutable containment event for that same attempt/fence.

It is never derived from current dispatch authority and remains usable when a
policy, epoch, executor authorization, activation, or time horizon has removed
dispatch. It cannot create an attempt, change a fence, produce authoritative
success, or mint another submit. Its historical-source type, source ID/SHA,
target provider reference if known, recovery-gateway identity, created DB time,
and terminal-retention limit are immutable.

A redemption-derived authority may issue poll, reconcile, or an exact-intent
stop. A containment-only authority may issue only the exact-intent stop unless
the same attempt also has the historical submit redemption required for poll
or reconcile.

Each exact recovery call requires a fresh
`foundry_derivative_recovery_call_grants_v1` row for one already-claimed
recovery command and one allowed literal kind. Each call grant has a hashed
one-use secret, exact command-claim tuple, short DB expiry, exact source
authority, and an opaque planned call-event UUID with no FK. In the later
redemption transaction,
`foundry_derivative_recovery_call_redemptions_v1` receives the real FK to the
new event and must equal the grant's planned UUID. It is unique by grant, token
SHA, command claim, call event, and provider idempotency key.
Expiry or loss does not retokenize that command; a subsequent poll/reconcile/
stop is a new command, claim, call grant, and redemption.

Stop has additional closure: it must name the current attempt fence and exact
stop intent; a containment stop intent must name its containment event and
target `terminal_killed`. A provider-bound live attempt gets the stop intent
in the containment transaction. A stop grant cannot be used before that
intent, cannot target another provider reference, cannot terminalize as
success, and cannot suppress later forensic observation or custody. Poll and
reconcile may only observe/reconcile the historically redeemed invocation.
Checkpoint is absent from all recovery tables and is denied at direct INSERT.

### 4.3 Referencable, non-retokenizable claims

`foundry_derivative_provider_command_sidecars_v1` is inserted with the base
command while that command is pending. It binds only immutable pending-command
identity/payload/request, activation/closure, attempt/fence, command kind, and
duplicated phase leaves; it has no claim token, `claimed_by`, grant, redemption,
or future-event FK. A unique submit-sidecar key on `activation_id` for literal
`provider_submit` permits at most one submit command for an activation and
therefore at most one pending submit command/sidecar. Recovery commands remain
one row per new call.

0058 adds a unique key on
`foundry_provider_commands(id, claim_token, claimed_by, fencing_token)`.
The pending sidecar references only command ID/fence. Submit and recovery
grants and redemptions—not sidecars—reference all four claim columns and
require non-null claim token and claimer. A derivative guard makes the first
non-null claim tuple immutable for the lifetime of the command, including
expiry, uncertain completion, cancellation, and failed calls. A derivative
command cannot return to a claimable pending state and cannot be re-claimed
with a new token or actor. Submit loss is handled only by historical recovery;
recovery repetition uses a new command ID.

## 5. Network-none output architecture

`networkAccess = "none"` means the sealed worker has no network route, object
credential, provider credential, metadata-service access, or capability-token
delivery. It writes exactly one regular file named `normalized.glb` into its
attempt-scoped local spool. It may not create any other file, directory,
symlink, hard link, device, socket, alternate stream, or checkpoint.
The worker manifest is emitted over the authenticated runner-captured
stdout/control channel after the file descriptor is closed; it is bound to the
worker/runner identity and transcript SHA. It is never a second spool file.

The host upload broker runs outside the worker namespace. After the worker has
exited and the spool is frozen, the broker opens the expected regular file
without following links, verifies path containment and single-file cardinality,
and receives a capability valid for one exact bucket/key create. The
capability permits create-if-absent only and denies list, read, overwrite,
multipart reuse, copy, delete, and all other keys. The worker never sees it.

A different custodian principal may HEAD/GET only the resulting immutable
object version. It cannot create, overwrite, copy, delete, list, publish, or
read release/runtime storage. Broker and custodian authorizations have
separate tables, revocations, workload identities, database roles, IAM policy
digests, and application artifacts.

### Exact output reservation

`foundry_derivative_output_reservations_v1` is created atomically with the
single attempt. It has these mandatory bindings:

- reservation ID/SHA, activation ID/SHA, closure ID/SHA;
- execution ID/subject SHA, attempt ID/ordinal, and fencing token;
- exact stage ID, source asset ID/SHA, literal slot
  `normalized_glb_v0`, and literal filename `normalized.glb`;
- versioned quarantine storage-profile ID/version/SHA and exact bucket;
- exact safe-relative output-directory prefix and deterministic object key,
  where `object_key = output_prefix || "/normalized.glb"` and the normalized job
  `outputPrefix` equals the reservation prefix;
- attempt-scoped spool root identity and the literal relative spool path
  `normalized.glb`;
- **expected** broker and custodian workload/policy profile SHAs and closed GLB
  verifier ID/version/SHA; no actual broker or custodian authorization ID
  exists yet;
- DB `reserved_at`, `expires_at`, authority horizon, canonical reservation
  JSON, and domain-separated reservation SHA.

The prefix is normalized, has no leading or trailing slash, contains no empty
segment, traversal, URL, query, fragment, backslash, or alternate encoding, and
belongs to the dedicated quarantine namespace. It must pass the unchanged
0053 `foundry_is_safe_relative_path` predicate exactly. Bucket/key, activation/slot, and
execution/attempt/fence/stage tuples are unique. V1 has one attempt, so the
immutable job prefix and reservation prefix cannot diverge across retries.

`foundry_derivative_quarantine_storage_profiles_v1` binds an exact bucket,
dedicated root prefix, required object versioning/object-lock behavior,
create-if-absent semantics, broker policy SHA, custodian policy SHA, KMS/
retention settings, validity interval, profile JSON/SHA, and infrastructure
receipt. Before registration, its privileged function normalizes the proposed
bucket/root and scans every section 12 namespace/pointer. Any overlap records a
quarantine security event and returns profile-registration denial without
inserting the profile. Direct profile-table DML is not granted. Its revocation
table is append-only.

`foundry_derivative_output_broker_authorizations_v1` is per reservation and
one key. It binds the broker issuer/subject/audience/credential SHA, exact
bucket/key, create-only policy SHA, broker artifact SHA, capability SHA only,
DB validity, an opaque planned upload-operation UUID with no future-row FK,
and authorization JSON/SHA. This short-lived row is created only after worker
exit, spool freeze/verification, and expected-broker-profile match; its
DB `issued_at` is capability issuance. Its revocation table permits one
revocation per authorization. A CSPRNG plaintext capability is returned only
after issuance commit, never stored/logged, and its SHA is the only durable
secret material.

`foundry_derivative_broker_object_uses_v1` is the one-use DB redemption/use
record. Immediately before PUT, the broker authenticates, locks root/
reservation/authorization, freezes and verifies the spool, samples DB time,
hashes the presented capability, and inserts exactly one use row binding the
authorization, token SHA, activation/closure/attempt/fence, spool identity and
local digest/length, bucket/key, planned upload-operation UUID, DB
`authorized_at`, and `put_not_after`. Unique authorization and token keys make
that capability non-reusable.

`put_not_after` is the least of reservation expiry, storage-profile expiry,
broker-authorization expiry, workload-credential expiry, create-capability
expiry, and `authorized_at + maximum_put_seconds`. Each source must be current
and unrevoked at the DB use time. The use transaction commits immediately
before one create-if-absent PUT. The later authenticated create receipt carries
the same upload-operation UUID and is linked from custody to the use row; the
use row has no FK to that future receipt. A committed use is not proof that PUT
reached storage.

`foundry_derivative_output_custodian_authorizations_v1` is appended only after
the broker's authenticated create receipt identifies an immutable object
version. It is separately per reservation and one version read, and binds the
custodian workload identity, exact bucket/key/version, version-read-only policy
SHA, verifier artifact SHA, DB validity, and authorization JSON/SHA. Its
revocation table is separate.

The non-null job `objectStorageProfile` and output prefix are reservation
metadata consumed by the host broker/custodian control plane. They are never
credentials, mounts, environment variables, or network routes in the worker.

### Output phase and loss rules

The output phases are distinct:

1. **broker issuance** creates the per-reservation one-key authorization;
2. **broker use** redeems it in DB time immediately before PUT;
3. **upload** performs one create-if-absent PUT and obtains a create receipt;
4. **custodian authorization** is created only after that receipt supplies the
   immutable version and matches the reservation's expected custodian profile;
5. **custodian read** performs one exact-version HEAD/GET under current
   custodian/read authority and records its read receipt;
6. **custody** validates the structurally referencable envelope, bytes, GLB,
   result, lineage, and public reverse scan.

Loss of derivative dispatch after the historical submit redemption does not
prevent a still-authorized broker from moving the frozen bytes into forensic
quarantine; this upload is not authoritative success. Current unrevoked
reservation, storage profile, broker identity/authorization, and one-use
capability are still mandatory at broker use. If the broker authorization or
storage profile is already expired/revoked, no PUT is authorized: the spool is
frozen and retained, and a security/containment event records the blocked
upload. A revocation racing after committed broker use cannot be made atomic
with PUT; any resulting object remains quarantined and is non-current at
custody.

## 6. Custody and deterministic classification

`foundry_derivative_output_custody_v1` is append-only evidence. It binds:

- activation/closure/execution/attempt/fence/stage/source/slot/filename and
  reservation/profile/prefix identities;
- submit command, immutable command claim, submit grant/redemption, invocation
  event, executor and submit-gateway identities;
- broker authorization, broker workload identity, capability SHA, upload
  receipt, bucket/key, immutable object version, ETag, and broker DB time;
- custodian authorization and workload identity, exact version read receipt,
  raw SHA-256, prefixed `sha256:…` form, byte length, media type, and suffix;
- GLB proof: magic bytes `glTF`, version exactly 2, declared length equal to
  object byte length, valid chunk headers/bounds/alignment, required JSON
  chunk, no overlapping chunks, and no trailing bytes;
- terminal provider result observation, provider-command outcome JSON/SHA,
  completion event, result classification, and each of their exact identities;
- worker manifest JSON/SHA, restriction-lineage set JSON/SHA, output-policy
  SHA, custody receipt JSON/SHA, worker/broker/custodian observed times, and DB
  `committed_at`;
- literal false release, signing, publication, redistribution, public-serving,
  and runtime-promotion flags.

The minimum structurally referencable custody envelope is non-negotiable: real
FKs and exact guards must resolve activation/closure, execution/attempt/fence,
reservation, broker authorization and object-use row, authenticated create
receipt bucket/key/version, expected and actual custodian authorization/read
receipt, submit redemption and its actual invocation event, and the exact
result observation/outcome/completion/classification identities. A missing or
wrong identity is not stored as an “invalid custody” row. The privileged
custody function appends a quarantine security event, appends containment when
the activation/attempt can itself be resolved exactly, returns denial, and
inserts no custody row; direct table INSERT is denied.

Once that envelope is structurally exact, content-level failures are retained:
hash/ETag/length/media mismatch, invalid GLB, bad worker manifest, incomplete
lineage, or contradictory/missing result proof produces a
`quarantined_invalid` custody row. This distinction preserves hostile bytes
without giving a forged identity a referencable custody record.

Every custody transaction takes the advisory lock for activation plus literal
slot before inspecting prior rows. Before “current” can be considered, the
same transaction runs the complete section 12 reverse scan. Any existing
public/runtime/release match appends a security event and containment and
forces `quarantined_invalid` even if all byte/result proofs otherwise pass.
It never overwrites or discards evidence. Classification then uses this fixed
priority:

1. **invalid** — any content, receipt, digest, GLB, lineage, result/outcome/
   event proof fails, or the reverse scan finds a public match;
2. **conflict** — proofs are valid but another valid immutable version or
   digest already exists for the activation/slot;
3. **late** — proofs are valid and non-conflicting, but authority is not
   current at the custodian's DB commit time;
4. **current** — proofs are valid, non-conflicting, and authority is current.

Thus an invalid late object is `quarantined_invalid`, not late; a valid late
conflict is `quarantined_conflict`, not late. At most one row can be
`quarantined_current_authority` for an activation/slot. Conflicts remain as
separate rows and security evidence. Only exact current custody may satisfy
the deferred authoritative-success closure; late/conflict/invalid custody may
only support forensic or containment terminal states.

Historical claim/grant/authorization rows are evaluated at their own action
times, not required to remain current at custody time: submit claim/grant at
submit redemption/event time, broker authorization/capability at object-use
time, and custodian authorization at exact-version read time. Custody verifies
their DB-time receipts and immutable linkage. Expiry or later revocation does
not erase forensic evidence, but it can make result-phase/current-authority
classification late or invalid according to the phase matrix.

## 7. Epoch, policy generations, time, and containment

### Closed activation epoch

`foundry_derivative_execution_activation_epochs_v1` has
`generation bigint PRIMARY KEY`, `variant`, DB `effective_at`, `enabled`,
`reject_future_generation_while_live`, closed epoch JSON/SHA, actor columns,
optional administrator user, idempotency key, and DB recorded time. A
root-locked insert guard requires generation 1 or exactly
`max(generation) + 1` and requires `effective_at` to be strictly later than
the prior generation's effective time.

It has exactly two closed variants:

- `disabled_sentinel` has `enabled = false` and a closed
  `disabled_reason` of `bootstrap` or `containment`. The only row 0058 inserts
  is generation 1 with reason `bootstrap`. It uses DB-assigned
  effective/recorded times,
  `actor_kind = "system"`,
  `actor_key = "system:foundry-derivative-bootstrap"`, null
  administrator-user ID, and literal `"not_installed"` in every
  release/artifact/IAM/storage/evidence field. Its JSON schema requires those
  sentinels and forbids SHA-shaped substitutes. It does not contain, predict,
  or self-reference the final 0058 SHA and requires no user or not-yet-created
  evidence. A later emergency disabled epoch uses reason `containment`,
  references its prior epoch/source in the closed JSON, and has the same fixed
  system actor/sentinels; it does not pretend to be release evidence.
- `enabled_release` requires `enabled = true`,
  `reject_future_generation_while_live = true`, a current platform-admin user,
  and real domain-shaped SHAs/IDs for the exact final 0058 bytes and migration
  chain; application release, activation store, claimer, submit/recovery
  gateways, worker runner/image, broker, custodian, watchdog, and scanner;
  executor/broker/custodian/quarantine/release/network/KMS/versioning/
  retention IAM and configuration; storage profile and GLB verifier; and live
  PostgreSQL, concurrency, adversarial, IAM-negative, spool, custody,
  reverse-scan, and public-denial evidence. `"not_installed"` is forbidden.

Canonical epoch JSON is a closed object containing the exact variant-specific
values. `UNIQUE(generation, epoch_sha256, effective_at, enabled)` is the
activation's four-column reference. Selection always first chooses the latest
row with `effective_at <= db_now`, ordered by effective time then generation,
**regardless of enabled state**, and only then requires that selected row to be
`enabled_release` with `enabled = true`. It never searches backward for an
older enabled row and never accepts a caller-selected generation.

For V1 enablement, `reject_future_generation_while_live` must be true. While
any affected attempt is live, inserting a future-effective derivative policy
generation, base policy generation, or activation epoch replacement is
rejected root-first. The flag is an additional strict control, not a claim
that PostgreSQL triggers execute when wall time passes.

### DB time and minimum authority horizon

Every authority function samples `clock_timestamp()` in PostgreSQL after all
prescribed locks and writes that same sampled value into the decision receipt.
Caller clocks, token timestamps, worker clocks, and HTTP dates never establish
authority. Provider/worker observations are evidence only and are separately
recorded.

For each phase, `authority_not_after` is the least non-null boundary among all
applicable candidate/reservation expiry, derivative approval, base-rights
approval, review/attestation, compute approval, execution confirmation,
dispatch deadline, pricing snapshot, worker profile, adapter artifact,
deployment, request profile, executor authorization, storage profile, broker
authorization, custodian authorization, output reservation, command claim,
submit or recovery grant, broker capability/object-use window, custodian read
window, maximum API-call window, and the next scheduled effective time for the
derivative policy, base policy, or activation epoch.
Omitting an applicable expiry is denial. A phase requiring authority must
satisfy `db_now < authority_not_after` and prove the phase can finish inside
that horizon.

There is no single horizon reused across phases. Dispatch generation
boundaries apply through submit redemption; the forensic broker path instead
uses its historical redemption plus the current reservation/storage/broker
horizon, and custody verifies historical claim/grant/use/read validity at each
recorded action time rather than demanding they still be current.

There is no wall-clock atomicity claim. At a scheduled boundary, DB-time
predicates deny new dispatch even if no watchdog has run. A root-first
watchdog scans affected live attempts and appends containment. 0059 evidence
must show both the strict scheduling rejection and the boundary-time denial.

### Containment sources

`foundry_derivative_execution_containment_events_v1` supports exactly:

- `derivative_policy_revocation`;
- `derivative_policy_generation_superseded`;
- `base_policy_revocation`;
- `base_policy_generation_superseded`;
- `registry_attestation_revocation`;
- `executor_authorization_revocation`;
- `output_broker_authorization_revocation`;
- `output_custodian_authorization_revocation`;
- `quarantine_storage_profile_revocation`;
- `activation_revocation`;
- `activation_epoch_disabled`;
- `activation_epoch_replaced`;
- `derivative_authority_expired`;
- `global_or_scoped_kill`;
- `quarantine_security_event`.

Source ID/SHA plus attempt/fence is unique. Revocation/supersession
transactions append containment and the exact stop intent before commit for
each affected provider-bound live attempt. Time passage is handled by the
root-first watchdog. Containment cannot delete historical submission,
recovery, observation, or custody evidence and cannot disable structurally
limited poll/reconcile/stop.

### Exact stop-intent integration

0058 must ALTER the existing `foundry_stop_intents`
`foundry_stop_intent_reason_mapping` CHECK and
`CREATE OR REPLACE FUNCTION guard_foundry_stop_intent()`. It adds only
`source_kind = "derivative_authority_event"` with this closed mapping:

| reason_code | priority | terminal | containment sources |
| --- | ---: | --- | --- |
| `derivative_authority_revoked` | 475 | `terminal_killed` | derivative/base generation supersession, derivative policy/registry/executor/broker/custodian/storage/activation revocation, epoch disable/replacement |
| `derivative_authority_expired` | 475 | `terminal_killed` | `derivative_authority_expired` |
| `derivative_quarantine_breach` | 490 | `terminal_killed` | `quarantine_security_event` |

The new guard branch requires `source_id = containment.id`,
`source_digest = containment.containment_sha256`,
`source_recorded_at = containment.recorded_at`, identical
execution/attempt/fence, `causation_id = source_id`, and reason derived from
the table above. Actor kind/key/user ID and correlation ID are copied exactly
from the containment event; operator requires its user ID, while
service/watchdog/system require null user ID. `request_digest` is the
domain-separated SHA of the closed stop tuple, not a caller digest. All values
are derived under locks rather than accepted as authority from input.

0058 also replaces the affected attempt-containment and provider-stop guards
so the exact derivative intent is mandatory, ordered by existing
`priority DESC, recorded_at ASC, id ASC`, and can only target the same live
fence. Existing 0053 application/cancellation event triggers remain in use.
For `global_or_scoped_kill`, V1 reuses and verifies the existing
`kill_switch_event / kill_<scope> / priority 500 / terminal_killed` intent.
For an existing base-rights revocation, it reuses and verifies the existing
`rights_policy_revocation / rights_revoked / priority 450 / terminal_killed`
intent. It does not insert a duplicate derivative intent for either source.
The derivative containment closure requires the exact reused intent before
commit. A statement-level BEFORE INSERT root trigger is added to
`foundry_kill_switch_events` before its fixed 0053 row guard runs.

## 8. Closed phase matrix

| Phase and DB-time point | Required authority | Later loss behavior |
| --- | --- | --- |
| candidate closure / closure recorded time | current derivative/base policy and exact relational subject; no execution authority | closure stays evidence but cannot activate if non-current |
| activation / activation transaction time | latest effective row regardless enabled, then enabled-release epoch; current candidate/base/executor/storage; admin user | activation becomes non-dispatchable |
| attempt + reservation / attempt transaction time | current dispatch, one-attempt limit, exact reservation, and expected broker/custodian profiles only | no actual broker or custodian authorization exists yet |
| prepare/create submit / prepared-command times | current dispatch through API-call horizon; exact pending sidecars/reservation | no new submit work after loss |
| claim submit / claim+grant time | current dispatch; first immutable claim; one mandatory submit grant | historical claim/grant remain evidence |
| redeem submit / redemption+event time | current dispatch and grant through API-call horizon; actual event ID equals opaque planned ID | consumed authority never reopens; event means possible invocation only |
| poll/reconcile/stop / each recovery redemption time | historical recovery source, exact claim, one-use call grant; stop also exact intent/fence; no current dispatch | later policy loss does not erase limited recovery |
| broker capability issuance / authorization DB time | historical submit redemption, frozen exact spool, current reservation/storage/broker identity and expected policy-profile match | creates short-lived actual broker authorization; no PUT yet |
| broker use / immediately pre-PUT DB time | one-use token plus least broker horizon in section 5; no current dispatch required | expired/revoked-before-use retains spool; post-use race is quarantined |
| upload / external PUT window | committed broker-use row and create-if-absent one-key IAM until `put_not_after` | use row is not proof of contact; create receipt is required |
| custodian authorization / post-create DB time | authenticated create receipt, expected profile match, current custodian/storage read policy for exact version | authorization is historical evidence after read |
| custodian read / exact-version read time | current unrevoked one-version read authority and verifier horizon | read receipt remains evidence after expiry |
| raw result observation / observation time | structurally exact historically possible invocation; preserve evidence, never grant success | accepted after dispatch loss |
| custody / custody commit time | minimum structural envelope, action-time-valid historical receipts, byte/result checks, and reverse scan | retains valid invalid/late/conflict evidence without refreshing old authority |
| authoritative success / classification time | exact current custody, exact terminal result/outcome/event/classification, and current result-phase authority | otherwise forensic/containment terminal only |
| checkpoint / any time | always false, including direct `foundry_verified_checkpoints` INSERT | none |
| release/public/runtime / any time | always false | none |

## 9. Activation and claim transactions

Activation and claiming are separate root-first SERIALIZABLE stores.

The **activation store** preallocates activation and execution IDs, takes the
root and ordered locks, samples DB time, recomputes all closed candidate/base/
epoch/executor/storage predicates, inserts activation first using a deferred
execution FK, inserts the exact V0 execution projection and
`execution_admitted` genesis, and lets bidirectional deferred closures commit
or roll back the entire chain. It must not create a submit grant or perform an
external action.

Because the base execution table requires `admitted_by_user_id`, this store
accepts only a current platform-admin `users.id` as activation admitter.
Authenticated workload identities may later claim/redeem within their narrow
roles but cannot impersonate or replace that user.

The **claimer** starts a new SERIALIZABLE transaction, takes the root and the
same ordered scopes, authenticates the workload from trusted transport (not a
caller-supplied actor string), samples DB time, recomputes the appropriate
submit or recovery phase, transitions one pending command to its first claim,
and atomically inserts the mandatory submit grant or one recovery-call grant.
It returns plaintext only after commit. A zero-row, serialization, uniqueness,
deferred-closure, or horizon failure returns no token.

## 10. Canonicalization and privileged SQL

Every canonical artifact has a closed schema, domain tag, canonical
ECMAScript-compatible JSON encoding, and SHA-256. UUIDs, instants, digests,
enums, paths, and actor keys are strings. Every bigint-like value—including
generation, fencing token, command/event sequence, object byte length, and
retention count—is encoded in canonical JSON as an unsigned base-10 string
with no sign, leading zero, decimal point, or exponent (except literal `"0"`
where zero is allowed). TypeScript uses `bigint`/string parsing and never
`Number` for these leaves; SQL digest builders use the exact decimal text.
Relational bigint columns use explicit non-negative bounds, and any value that
must enter an existing ECMAScript-number column is additionally capped at
9007199254740991. SQL and TypeScript canonical vectors must match byte for
byte in tests.

All authority mutation, claim, redemption, containment, and custody-classifier
functions are `SECURITY DEFINER` with fixed
`SET search_path = pg_catalog, public`, fully qualified object references, and
no dynamic SQL. `PUBLIC` execution is revoked. Execute is granted only to the
minimum roles:

- `omnitwin_api_activation`;
- `omnitwin_foundry_claimer`;
- `omnitwin_foundry_submit_gateway`;
- `omnitwin_foundry_recovery_gateway`;
- `omnitwin_foundry_output_broker`;
- `omnitwin_foundry_output_custodian`;
- `omnitwin_foundry_watchdog`.

No function trusts caller-supplied actor, user, authorization, time, token SHA,
or identity claims when it can derive them from the authenticated DB role,
transport verifier, locked row, or DB clock. Read-only predicates may remain
`SECURITY INVOKER`. Table DML is denied to application roles when a privileged
function is the intended mutation surface.

## 11. Lock namespaces, order, indexes, and root triggers

All advisory locks use `pg_advisory_xact_lock(hashtextextended(text, 0))`.
The exact new namespaces are:

1. existing root `foundry-kill:0:global`;
2. `foundry-derivative:1:epoch:<generation>`;
3. `foundry-derivative:2:policy:<version>:<generation>`;
4. `foundry-derivative:3:activation:<activation-uuid>`;
5. `foundry-derivative:4:execution:<execution-uuid>`;
6. `foundry-derivative:5:attempt:<attempt-uuid>`;
7. `foundry-derivative:6:command:<command-uuid>`;
8. `foundry-derivative:7:output:<activation-uuid>:normalized_glb_v0`.

After the root, transactions acquire applicable epoch, registry attestation,
derivative policy, base-policy, activation, executor/storage/broker/custodian
authorization, existing provider/project/execution/attempt, command, and
output scopes in that order, sorting multiple keys by canonical `C` text.
Row locks follow the same semantic order. DB time is sampled only afterward.
No reverse path may begin from an attestation, policy, authorization, custody,
or output row and acquire the root later.

0058 must create at least these exact lookup/uniqueness indexes:

- activation: unique candidate, execution, and actor/idempotency; index
  epoch/policy/`authority_not_after`;
- closure: unique candidate and unique `(id, closure_sha256)`; downstream
  guards compare duplicated leaves after locking that two-column reference;
- command claim: unique
  `(id, claim_token, claimed_by, fencing_token)`;
- submit grant: unique activation, command claim, token SHA, and invocation
  event; submit redemption: unique grant, activation, command claim, token SHA,
  and invocation event;
- recovery authority: unique activation/attempt/fence/source; recovery grant:
  unique command claim, token SHA, and call event; recovery redemption: unique
  grant, command claim, token SHA, and call event;
- output reservation: unique activation/slot, bucket/key,
  execution/attempt/fence/stage, and spool identity;
- broker authorization: unique reservation and capability SHA; custodian
  authorization: unique reservation and identity/policy SHA;
- broker object use: unique broker authorization, capability-token SHA, and
  planned upload-operation UUID;
- command sidecar: unique command ID and unique activation where command kind
  is literal `provider_submit`;
- custody: index activation/slot/commit time; unique bucket/key/object-version;
  indexes raw SHA, prefixed SHA, disposition, result observation,
  classification, and restriction-lineage SHA; partial unique current row per
  activation/slot;
- containment: unique source-kind/source-ID/attempt/fence and index live
  attempt/recorded time;
- quarantine security events: unique offending table/row/reason/custody or
  namespace identity, plus severity/state index.

Statement-level BEFORE root triggers must cover:

- INSERT on activation epochs, derivative policy versions/revocations, base
  policy versions/revocations, registry-attestation revocations, executor/
  broker/custodian/storage authorization revocations, and activation
  revocations, plus `foundry_kill_switch_events`;
- INSERT or UPDATE on executions, attempts, prepared provider requests,
  provider commands, execution events, result observations, result
  classifications, stop intents, and verified checkpoints;
- INSERT or UPDATE on every 0058 closure, activation, sidecar, reservation,
  authorization, grant, redemption, recovery authority, containment, custody,
  and quarantine-security table;
- INSERT or UPDATE on every legacy/public table listed in section 12.

The “every 0058” item means the exact 24 table names in section 13. The
existing mutable/control list is exactly `foundry_executions`,
`foundry_attempts`, `foundry_prepared_provider_requests`,
`foundry_provider_commands`, `foundry_execution_events`,
`foundry_provider_command_result_observations`,
`foundry_provider_command_result_classifications`, `foundry_stop_intents`,
and `foundry_verified_checkpoints`. The legacy/public list is exactly
`venues`, `spaces`, `asset_definitions`, `configurations`,
`configuration_sheet_snapshots`, `photo_references`, `files`,
`website_embed_configs`, `asset_versions`, `runtime_packages`,
`reconstruction_releases`, `reconstruction_release_qa_runs`,
`reconstruction_release_reviews`,
`reconstruction_review_evidence_artifacts`,
`reconstruction_release_attestations`,
`reconstruction_release_publications`, `reconstruction_release_channels`,
and `reconstruction_release_channel_events`. The policy/source list is
exactly `foundry_derivative_execution_activation_epochs_v1`,
`foundry_derivative_rights_policy_versions`,
`foundry_derivative_rights_policy_revocations`,
`foundry_rights_policy_versions`, `foundry_rights_policy_revocations`,
`foundry_derivative_rights_registry_attestation_revocations_v1`,
`foundry_kill_switch_events`, the four
0058 authorization/profile revocation tables named in section 13, and
`foundry_derivative_execution_activation_revocations_v1`. Migration review
must fail if any named relation is absent; it may not silently omit a trigger.

Append-only 0058 tables additionally deny UPDATE, DELETE, and TRUNCATE. The
root trigger does not replace row/deferred guards.

## 12. Namespace- and lineage-independent public denial

The dedicated quarantine bucket/root prefix is denied from asset, review,
release, publication, public-serving, and runtime namespaces **even when no custody row exists**.
Denial parses and normalizes bucket/key/URL/prefix values;
it does not depend on a prior custody join. It also compares custody lineage
when available, using both raw 64-hex SHA and normalized
`sha256:<64-hex>` forms.

Direct INSERT/UPDATE guards and deferred reverse closures cover:

- `venues.logo_url`;
- `spaces.mesh_url` and `spaces.thumbnail_url`;
- `asset_definitions.mesh_url` and
  `asset_definitions.thumbnail_url`;
- `configurations.thumbnail_url` and `lightmap_url`, independent of
  `visibility` or `is_public_preview`;
- `configuration_sheet_snapshots.diagram_url`, `pdf_url`,
  `source_hash`, and direct object/key/URL/digest references in `payload`;
- `photo_references.image_url` and `thumbnail_url`, independent of
  `visibility`;
- `files.file_key`, `sha256`, and `visibility`: a quarantine key/hash is
  denied for every visibility, including `private`;
- `website_embed_configs.cta_url` because the public embed dereferences it;
- `asset_versions.r2_key`, `external_url`, and `sha256`, including raw or
  prefixed SHA and any encoded quarantine bucket/key/URL;
- every `runtime_packages` asset reference:
  `primary_visual_asset_version_id`, `semantic_mesh_asset_version_id`,
  `collision_asset_version_id`, `point_cloud_asset_version_id`, all
  `manifest_json` object/key/URL/digest references, and
  `assets.visualAssetVersionIds`;
- reconstruction release candidate bucket, candidate prefix, release-manifest
  key/SHA, source/release digests, and every manifest file path/key/URL/SHA;
- reconstruction QA report key/digest and every review
  `visual_evidence`, `transform_artifact_refs`, and
  `scene_authority_refs` value;
- review evidence artifact object key, artifact digest, object SHA, and linked
  artifact IDs;
- attestation `r2_key`, statement/envelope/release/review/QA digests, and any
  embedded object reference;
- publication candidate/release bucket and prefixes, public manifest key,
  public base/manifest URLs, manifest/verification/release/review/attestation
  digests;
- reconstruction release channels, channel pointers, and channel events;
- direct `foundry_verified_checkpoints` rows for an activated derivative
  execution, regardless of command or application path.

This is the exact direct-dereference/storage/public-pointer guarantee for the
current schema. Arbitrary prose fields are not claimed to be object registries
and application code must never dereference them as storage references. Any
future schema column or JSON leaf that is directly dereferenced as a
key/URL/digest is activation-blocking until added to this list, its guard, the
profile pre-scan, and the reverse scan.

Every later surface rechecks the complete linked release/package graph instead
of trusting an earlier check. Release/runtime principals have no quarantine
read permission, and public/release buckets reject quarantine-source copies.

For each structurally accepted custody candidate and before current
classification, the custodian performs the reverse scan under the root:
it searches all pre-existing surfaces above by normalized namespace, exact
bucket/key/version, raw/prefixed SHA, asset linkage, manifest linkage, and
release linkage. Matches are never silently ignored or used as proof of
custody. Each is appended to
`foundry_derivative_quarantine_security_events_v1`, classified as a security
event, linked to containment, and left retained for investigation; the custody
disposition is forced to `quarantined_invalid`. Namespace denial remains
effective independently of this scan.

## 13. Exact inert 0058 table set

0058 may add the following append-only V1 tables and no enabled authority:

1. `foundry_derivative_execution_activation_epochs_v1`;
2. `foundry_derivative_candidate_relational_closures_v1`;
3. `foundry_derivative_quarantine_storage_profiles_v1`;
4. `foundry_derivative_quarantine_storage_profile_revocations_v1`;
5. `foundry_derivative_executor_authorizations_v1`;
6. `foundry_derivative_executor_authorization_revocations_v1`;
7. `foundry_derivative_output_broker_authorizations_v1`;
8. `foundry_derivative_output_broker_authorization_revocations_v1`;
9. `foundry_derivative_output_custodian_authorizations_v1`;
10. `foundry_derivative_custodian_auth_revocations_v1`;
11. `foundry_derivative_execution_activations_v1`;
12. `foundry_derivative_execution_activation_revocations_v1`;
13. `foundry_derivative_prepared_request_sidecars_v1`;
14. `foundry_derivative_provider_command_sidecars_v1`;
15. `foundry_derivative_output_reservations_v1`;
16. `foundry_derivative_submit_once_grants_v1`;
17. `foundry_derivative_submit_once_redemptions_v1`;
18. `foundry_derivative_recovery_authorities_v1`;
19. `foundry_derivative_recovery_call_grants_v1`;
20. `foundry_derivative_recovery_call_redemptions_v1`;
21. `foundry_derivative_broker_object_uses_v1`;
22. `foundry_derivative_execution_containment_events_v1`;
23. `foundry_derivative_output_custody_v1`;
24. `foundry_derivative_quarantine_security_events_v1`.

The activation row binds candidate/reservation/approval/review/attestation,
base execution subject, project/job/envelope/manifest, closure/lineage/output
policy, executor authorization, and the full epoch composite. Already
materialized identities use the smallest referencable FK: closure references
are exactly `(closure_id, closure_sha256)` and other small composites cover
only their natural identity. Planned invocation/call/upload UUIDs are the
explicit exception: they are opaque commitments with no FK until the later
row is created; that row must equal the planned UUID and then holds the real
FK. Digest-only joins and future-row FKs are forbidden. Generation 1 disabled
makes every activation-capable predicate false while still permitting
installation and negative tests.

Every exact table name above is at most 63 UTF-8 bytes. Every new or replacement
function, trigger, constraint, index, sequence, policy, and role identifier
must also satisfy `octet_length(name) <= 63` before 0058 is accepted; short
`fdv1_...` names are required where descriptive names would exceed the limit.
The migration test enumerates `pg_class`, `pg_constraint`, `pg_proc`,
`pg_trigger`, and roles and fails on truncation or collision. PostgreSQL's
silent 63-byte truncation is never relied upon.

## 14. Required predicates and closures

### Mandatory 0056 guard replacement

0058 leaves 0056 bytes untouched but must execute `CREATE OR REPLACE` for each
function already attached to a 0056 boundary trigger:

1. `foundry_classify_normalize_mesh_glb_v0_job_spec`;
2. `assert_foundry_legacy_v0_derivative_execution_denied`;
3. `guard_foundry_derivative_v0_execution_insert`;
4. `guard_foundry_derivative_v0_attempt_insert`;
5. `guard_foundry_derivative_v0_prepared_request_insert`;
6. `guard_foundry_derivative_v0_provider_command_insert`;
7. `guard_foundry_derivative_v0_provider_command_claim`;
8. `guard_foundry_derivative_v0_provider_invocation_event_insert`.

The replacement classifier recognizes “exact” only with all section 3 leaves.
Each guard resolves the immutable job classification and latest effective
epoch. `unrelated` follows fixed legacy behavior; every relevant variant is
denied in all epochs. For an exact job, disabled-sentinel/disabled latest
epoch, missing closure/activation/sidecar/reservation/grant/redemption, wrong
phase, or mismatched duplicated leaf is denial. Only an enabled exact concrete
chain may cross execution, attempt, prepared request, submit-command, submit
claim, or submit invocation. Poll/reconcile/stop at the last three boundaries
use only the exact historical recovery chain in sections 4 and 8; they do not
reopen execution/attempt/submit authority. No 0056 trigger is dropped or
temporarily disabled.

0058 must define, with closed arguments and DB-time sampling:

- current effective epoch and next epoch boundary;
- current derivative/base generation and next generation boundary;
- exact candidate relational closure;
- phase-specific activation/execution authority;
- submit-grant issuable and submit-redemption redeemable;
- historical recovery authority and one-use recovery-call redeemability;
- exact output reservation, broker issuance/use horizon, create-receipt
  linkage, post-create custodian authorization, and exact-version read;
- minimum custody envelope and pre-classification public reverse scan;
- deterministic custody classification;
- namespace or lineage quarantine match;
- root-first containment requirement.

Deferred exact-coverage closures enforce:

- activation ↔ execution ↔ admission genesis;
- attempt insert ↔ one output reservation with expected broker/custodian
  profiles, with an at-most-one-attempt key per activation; every
  submit-capable activation must have that exact attempt/reservation chain,
  but activation admission itself does not require an attempt in the admission
  transaction;
- prepared request ↔ prepared sidecar;
- provider command ↔ command sidecar;
- claimed submit ↔ exactly one submit grant;
- submit redemption ↔ invocation event;
- recovery command claim ↔ one call grant ↔ one call event;
- post-spool broker authorization ↔ one object-use row ↔ later exact create
  receipt, without a future-row FK from authorization/use;
- successful terminal result ↔ exact result observation/outcome/completion
  event/classification ↔ exact current custody;
- authority-loss source ↔ containment event ↔ exact stop intent;
- custody ↔ complete immutable object/result/lineage evidence.

Every derivative boundary reclassifies from immutable stored job and worker
records. Missing sidecars, closure rows, reservations, grants, or custody are
legacy denial, never fallback.

## 15. Staged decomposition and test matrix

| Stage | Deliverable | Required proof before next stage |
| --- | --- | --- |
| 0058-A | disabled schema plus **all** DB enforcement: 0056 replacements, roles, locks, row/deferred guards, derivative stop ALTER/guard, containment closures, checkpoint/public/runtime denials, profile pre-scan, custody reverse-scan/classifier functions, append-only rules, and indexes | schema diff proves 0053-0057 byte identity; closed bootstrap sentinel row installs without user/evidence/self-SHA; all activation-capable writes denied |
| App-B | activation store and admin-user admission | SERIALIZABLE rollback/duplicate/replay/concurrency tests; no partial activation/execution/genesis |
| App-C | claimer, submit gateway, recovery gateway | one mandatory non-reissuable submit grant; double redemption/retokenization denial; recovery structurally cannot submit/checkpoint |
| Infra-D | sealed worker, attempt spool, host broker, custodian, versioned quarantine IAM | packet/network denial, no worker credentials, one-file spool, one-key create-only broker, separate immutable-version read-only custodian |
| App-E | wire custody, containment/watchdog, profile scanner, public scanner, and broker/custodian services to the already-installed 0058-A DB functions | priority classification, scheduled-boundary denial, revocation/supersession stop closure, complete legacy/public negative matrix; no DB guard is deferred to App-E |
| Verify-F | disposable live PostgreSQL plus IAM/storage adversarial run | exact artifact/evidence digests and passing report |
| Audit-G | independent amended-contract and implementation re-audit | explicit GO for 0059; otherwise remain NO-GO |
| 0059 | append enabled epoch only | all earlier exact SHAs/receipts match; no unreviewed change |

The live matrix must include at least:

1. exact leaf mutations for output name, slot, checkpoint, resumable, nullable/
   wrong profile, prefix, extra stage/input/output, wrapper, alias, image,
   worker, operation, and purpose at job, prepared, sidecar, grant,
   reservation, and custody boundaries;
2. activation duplicate/conflicting replay and rollback after activation,
   execution, and genesis inserts;
3. activation/attempt/prepare/claim/redemption racing derivative and base
   generation supersession, all revocations, epoch disable/replacement, kill,
   and DB-time expiry in both commit orders;
4. future-effective derivative/base/epoch insert while an affected attempt is
   live, and DB-time boundary denial plus watchdog containment;
5. missing submit grant, a second grant, unredeemed expiry, committed-
   redemption crash, double redemption, wrong token/claim/fence/actor/
   issuer/subject/audience, and every retokenization path;
6. recovery authority without historical redemption/containment; recovery
   submit/checkpoint attempt; reused call grant; poll/reconcile/stop against a
   different invocation/fence/provider ref; stop without exact intent;
7. worker network, metadata, DNS, object-store, process-spawn, and credential
   access attempts; extra spool file, symlink/hardlink/path escape, rename
   race, partial file, and post-freeze mutation;
8. broker list/read/overwrite/copy/delete/other-key attempts and custodian
   create/list/delete/other-version attempts; revoked/expired/wrong workload
   identities; version replacement;
9. GLB bad magic/version/declared length/chunk bounds/alignment/JSON/trailing
   bytes, hash/ETag/version mismatch, missing lineage, contradictory terminal
   result, and missing outcome/event/classification;
10. concurrent custody for the same activation/slot proving the
    activation+slot advisory serialization, retained conflicts, and exact
    invalid → conflict → late → current priority;
11. successful terminal transition without exact current custody and late/
    conflict/invalid custody attempting to authorize success;
12. direct checkpoint INSERT and submit/checkpoint attempts at every prepare,
    command, claim, redemption, event, and result path while legitimate
    recovery and forensic custody still work;
13. direct SQL and API namespace/hash/link smuggling through every field in
    section 12, including raw/prefixed SHA, encoded URLs, all four runtime FKs,
    `visualAssetVersionIds`, release manifest files, review refs, attestations,
    publications, channels, and events;
14. custody reverse scan of deliberately pre-existing legacy/public
    references, proving security-event classification and containment;
15. root/ordered-lock stress with concurrent activation, policy/epoch changes,
    auth revocation, claim, redemption, result, custody, and watchdog work,
    proving no reverse acquisition or deadlock;
16. database-role and `SECURITY DEFINER` tests proving fixed search path,
    revoked PUBLIC, role separation, no caller-actor spoofing, no direct-table
    bypass, and no worker/API/claimer access to provider or object credentials;
17. SQL/TypeScript canonical vectors for every bigint-like value at 0, 1,
    9007199254740991, and the new-table supported maximum without JavaScript
    rounding.
18. clean 0058 bootstrap with no users or release/evidence rows, proving the
    exact system actor/`not_installed` JSON, no self-SHA, contiguous generation
    PK, increasing effective time, and latest-effective-disabled denial rather
    than fallback to an older enabled row;
19. catalog inspection proving all 24 table names and every new function/
    trigger/constraint/index/role identifier is at most 63 bytes and no name
    was truncated or collided;
20. every 0056 replacement guard with unrelated, exact-enabled,
    exact-disabled, variant, missing-chain, mismatched-leaf, exact recovery,
    and forged-recovery cases;
21. derivative stop reason/source/priority/terminal/actor/digest mapping,
    reuse of existing kill/base-rights intents without duplicates, and kill
    event root-lock races;
22. pending sidecar with no claim tuple, one-submit-sidecar enforcement,
    opaque planned event IDs with no premature FK, actual event-ID equality at
    redemption, `actor_key = claimed_by`, and proof that invocation-start is
    never treated as provider contact;
23. broker authorization issuance, immediate pre-PUT one-use redemption,
    exact horizon, double use, crash-before-PUT, create receipt linkage,
    revoked/expired broker or storage retention of the frozen spool, and
    post-use revocation race classification;
24. wrong custody identity denial plus security event, content/GLB/result
    invalid retention, action-time historical-authority validation,
    storage-profile namespace pre-scan, and public-match reverse scan before
    current classification across every adjacent pointer in section 12.

Positive-path pre-0059 tests run only in a disposable, network-isolated
database by applying the exact candidate 0059 enable row under the harness and
destroying the database afterward. No shared, staging, or production database
may append an enabled epoch to gather evidence; their 0058 state remains
generation 1 disabled.

## 16. 0059 evidence gate

0059 remains prohibited until application, IAM, storage, database evidence,
and the independent re-audit all pass against the same artifact set.

An enabled epoch must bind the exact 0058 bytes, migration chain, application
release, activation store, claimer, gateways, worker image/runner, broker,
custodian, watchdog/scanner, storage profile, GLB verifier, all IAM policies,
network/spool isolation, live PostgreSQL run, adversarial run, and independent
audit receipt. Any absent digest, changed artifact, disabled strict
future-generation flag, non-current profile, or failed test makes 0059 fail
closed.

0059 cannot be prepared, merged, or run on the strength of this design alone.
Until the implementation and evidence are independently re-audited, the
correct operational state is generation 1 disabled and **NO-GO**.

## 17. Non-claims

Even a future enabled epoch would authorize only one attempt to redeem one
submit for the exact quarantined normalization subject. It would not prove
that the external side effect occurred, that the provider succeeded, that the
output is useful, that custody is current, that release is permitted, or that
any other derivative operation is authorized. This contract never claims
transactionally exactly-once external execution or wall-clock atomicity.
