# OmniTwin Foundry activation V1 catalog-manifest format

Status: **DESIGN DRAFT / NO-GO — strict structural schema present; no expanded
catalog or semantic-verifier acceptance evidence is present.**

Date: 2026-07-14

This document freezes the format required for the machine-readable PostgreSQL
catalog contract referenced by the activation V1 schema/privilege manifest. It
does not provide that final catalog, repair migration 0058, create 0059, enable
generation 1, or grant execution, provider, storage, custody, release,
publication, serving, signing, redistribution, runtime, or measured-geometry
authority.

## 1. Normative representation

The final artifact is canonical UTF-8 JSON with no BOM or trailing bytes and is
validated by a versioned JSON Schema checked in beside it. Its own digest is the
RFC 8785 JCS SHA-256 of the complete object with the one top-level
`manifestSha256` leaf omitted. YAML and format-specific implicit scalar typing
are forbidden.

Before object conversion, candidate-manifest and recursively referenced catalog
bytes MUST be one strict UTF-8 JSON text with no BOM, malformed or non-shortest
UTF-8, lone surrogate or other invalid Unicode scalar, duplicate member name at
any depth, or bytes after the JSON text. Duplicate members are rejected by a
token-preserving parser, not silently collapsed by a host map. The verifier
RFC-8785-re-encodes the parsed value and requires byte-for-byte equality with
the supplied canonical JSON bytes; disagreement fails closed before any digest
or schema result can be trusted.

Before any host-language floating-point coercion, the verifier parses JSON
numeric tokens losslessly. Every value validated by an `integer` schema node
MUST be a mathematical integer in the inclusive I-JSON interoperable range
`[-9007199254740991, 9007199254740991]`; this rule applies recursively to the
candidate and every referenced JSON artifact before JCS hashing. Each integer
node in the schema repeats those bounds or a tighter PostgreSQL catalog bound.
Every other numeric token MUST parse to a finite IEEE-754 binary64 value under
RFC 8785; overflow and non-finite values fail closed. Catalog values needing
exact decimal `int64` range are strings, not JSON numbers.

Digest preimages are frozen without an implicit salt or domain separator. The
textual `sha256:` prefix is output notation and is never part of a preimage:

- `manifestSha256` is SHA-256 of the root object's RFC 8785 UTF-8 bytes after
  omitting exactly the root `manifestSha256` member;
- `sourceSetSha256` is SHA-256 of the `sources` object's RFC 8785 UTF-8 bytes
  after omitting exactly its `sourceSetSha256` member;
- `contractSetSha256` is SHA-256 of the `contracts` object's RFC 8785 UTF-8
  bytes after omitting exactly its `contractSetSha256` member; and
- `composition.expandedCatalogSha256` and `expectedCatalog.catalogSha256` are
  both SHA-256 of the complete expanded-catalog object's RFC 8785 UTF-8 bytes,
  with no member omitted, and MUST be identical.

The required canonical-vectors artifact includes positive preimage/UTF-8/digest
vectors for all four rules and negative mutations that retain the self-digest
leaf, omit a different leaf, change nesting, or hash non-canonical bytes. The
pinned verifier MUST pass those vectors before accepting a manifest.

Every artifact path uses normalized repository-relative POSIX syntax: a
nonempty slash-separated path with no drive prefix, leading slash, backslash,
control character, empty segment, trailing slash, or `.`/`..` segment. The
resolver joins it beneath an approved root and rejects any escape; a native
filesystem path supplied by an instance is not accepted as an artifact path.
After joining, it resolves the canonical target through every symlink, junction
or other reparse point and requires that target to remain beneath the canonical
approved root; an implementation may instead reject linked/reparse traversal
entirely. Lexical normalization alone is not containment proof.

Array order is normative. Arrays representing catalog sets contain no
duplicates and are sorted by unsigned UTF-8 byte order of these stable keys,
never by OID or discovery order: source/contract ID; role name;
membership `(profile,role,member,grantor)`; qualified schema/extension/sequence/
table name; constraint/index/trigger/policy identifier within its relation;
routine `(qualifiedName,identityArguments)`; grant
`(profile,objectKind,objectIdentity,column,grantor,grantee,privilege)`; grouped
default-ACL `(profile,owner,schema,objectType)`; dependency
`(dependentKind,dependentIdentity,referencedKind,referencedIdentity,dependencyType)`;
and generated-object dependency key. Null sort components precede strings.
`negativeAssertions` is a closed const-true object whose property names are the
assertion IDs, so RFC 8785 object-member ordering applies rather than array
sorting.
Within a raw object/default-ACL entry, its normalized-grant rows are sorted by
`(grantor,grantee,privilege,grantable)`; grouping does not make their order or
duplication insignificant.
Arrays with semantic ordinals retain those ordinals instead: lifecycle profiles
use the section-3 order; columns use `attnum`; routine arguments/OUT columns,
index keys/includes, FK columns, trigger events, unified effect steps and
composition operations use their declared position. A verifier rejects an
out-of-order array and duplicate stable-key or ordinal records even when JSON
Schema validation alone would accept them. Explicitly legal repeated
positional index keys or trigger arguments remain distinct by position and are
not deduplicated.

The normative payload is the **fully expanded final catalog**. A baseline-0058
SHA and ordered typed delta operations may be retained as provenance, but no
installer, verifier or reviewer may infer an omitted relation, column,
constraint, index, trigger, routine or grant from baseline SQL. CI rejects a
delta whose deterministic expansion is not byte-equivalent to the embedded or
content-addressed `expectedCatalog`.

### Mandatory semantic verification

A Draft 2020-12 JSON Schema pass is necessary but **never sufficient** for
acceptance or activation. CI and every installer/reviewer MUST run one pinned
semantic verifier implementation and reject unless all of the following hold:

1. PostgreSQL is major 16, `serverVersionNum` is in the 160000–160999 range,
   the major/minor/version fields agree and the declared definition printer is
   the one used for every normalized definition.
2. Every source, contract, routine-body and content-addressed catalog artifact
   is fetched as exact bytes; normalized path/media type/length/digest are
   checked before parsing. An authenticated bootstrap/review policy maintained
   independently of the candidate manifest pins the allowed verifier identity,
   normalized path, media type, byte length and SHA-256. The trusted caller
   requires both verifier entries and the fetched bytes to match that external
   pin before loading or executing them. A verifier named or hashed only by the
   manifest under review cannot authorize that manifest. A content-addressed
   `expectedCatalog` is then recursively validated against its declared
   `schemaRef`. Missing or unavailable bytes fail closed.
3. `manifestSha256`, `sourceSetSha256`, `contractSetSha256`, every artifact/body
   digest, `composition.expandedCatalogSha256` and
   `expectedCatalog.catalogSha256` are recomputed under the declared canonical
   rules. The two expanded-catalog digests and the recursively resolved bytes
   are identical.
4. The expanded arrays are exact stable-key sets, not lower bounds:
   `inventoryScope.managedNames`/`managedRoles` equal the managed catalog
   projection; external dependencies equal the required source/body/effect
   projection; and the generated projection contains exactly the per-owner
   row/array types, applicable TOAST relation/index pairs and applicable
   internal trigger groups. No dangling or extra object is accepted.
5. Every local reference resolves with the required kind: owners, role members,
   grants, defaults, columns, backing indexes, FK targets, trigger routines and
   constraints, called routines, sequence consumers, dependency endpoints and
   contract IDs. All summary counts are derived from and equal the resolved
   catalog, including nested column/constraint/index/trigger/policy totals.
6. Lifecycle flags are checked against catalog state. All managed roles,
   including the bootstrap role, are NOLOGIN/NOINHERIT in every profile. The
   two sentinel-only profiles contain exactly the one coherent relation-1
   migration sentinel and no other managed row. The
   ephemeral external deployment LOGIN and its `bootstrap_only` membership and
   grants exist only in `bootstrap_open`; bootstrap-entry-point EXECUTE is
   absent from post-install and steady state; and PUBLIC/service principals
   never gain internal-helper execution or table/sequence DML through direct
   grants, PUBLIC, ownership or membership expansion. Every managed role also
   remains NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOREPLICATION and NOBYPASSRLS
   in all three profiles, including after effective membership expansion.
7. Raw ACL/default-ACL storage is compared exactly and independently from the
   normalized rows. `aclexplode`, PUBLIC and membership expansion reproduce
   those rows, and every privilege is legal for its object type and column
   scope.
8. Routine definitions are available as exact bytes. Static analysis proves
   their dependencies and read/write/call/sequence sets equal `effects`.
   `orderedSteps` ordinals are contiguous and every runtime sequence
   allocation's positive `effectStepOrdinal` resolves to a matching
   `sequence_allocation` step after all applicable `rootFirst` locks. The sole
   migration `installation_seed` allocation instead has a null step ordinal
   and is checked directly against its exact sentinel consumer and lock order.
   `semanticOperationSteps` is a separate branch-sensitive projection, empty
   for routines with no referenced semantic-operation contract. Otherwise its
   ordinals and selectors are unique and contiguous. Each step has a closed
   unique `guardIdentifiers` array and one `branchEffects` row for every exact
   `(operationNamespace,operationOrdinal,branch)` in the referenced contract.
   Ordinals are contiguous inside a collision-free namespace; admission uses
   `preamble:1` separately from `accepted:1..13`. Each branch row binds
   its own applicability predicate, mode/clock, recomputed SQL AST nodes,
   relation/column accesses, aggregate-effect stable keys, writes, return-field
   sources and explicit continuation/return/error outcomes. Every `continue`
   outcome has a non-null `(nextOperationNamespace,nextOperationOrdinal)`
   target; every `return` or `error` outcome sets both target fields to null.
   A bare ordinal is never a continuation target. Guard IDs match by
   `(operationNamespace,operationOrdinal,guardId)` and may repeat at another operation ordinal. A
   concatenated guard string, opaque branch macro or flat union of possible
   branch effects fails. A lock/sequence-only `orderedSteps` entry cannot
   substitute for a validate, select, derive, update, insert or return step.
9. Contract artifact consumers and all column/constraint/routine `contractIds`
   are a bidirectionally equal reference graph. `verifierContractIds` equals
   exactly three IDs: the semantic-verifier implementation and the two
   workload-inclusion proof artifacts. The verifier source/implementation and
   workload pair are present in their required source/contract sets with
   matching exact-byte metadata; the implementation also matches the
   independently authenticated bootstrap/review pin from rule 2. All three
   contracts validate before catalog comparison. The verifier implementation
   has an empty catalog-consumer list because its use is represented by
   `verifierContractIds` plus the external pin. The workload proof pair and all
   other byte contracts name their real column, constraint and routine
   consumers, so a fabricated table/role/generated-object consumer cannot
   satisfy closure.
10. `semanticContracts.providerResultAdmission` and
    `semanticContracts.recordProviderResult` are compared together. The first
    reserves the proof required for the atomic accepted R27/0053 graph and
    admission-time later-different containment, but its mandatory readiness
    gate remains `no_go` until the installed 0053 cascade is closed. The second
    freezes the guarded four-column API claim, frozen branch/terminal owner,
    exact ten-column replay binding, seven-branch replay/fresh universe, nine-
    operation routine vector and all five fresh return arms, but is not
    implementation authority without a matching expanded catalog and live
    routine. Admission separately closes five pre-accepted replay/conflict/
    disposition outcomes and the ten accepted result-branch × completion-subarm
    combinations, while expressly recording that the installed cascade and
    generic structural-conflict vectors remain incomplete. Their semantic
    selectors, branch effects, predicates, return fields, aggregate routine
    effects, guard arrays and sequence-allocation records must correspond
    exactly. A union of possible inserts, a matching branch-name string or an
    unbound semantic selector without predicate/AST/effect correspondence fails.
11. `semanticContracts.watchdogScan` is a readiness boundary, not a positive
    implementation contract. It freezes four cursor-intent summary rows and a
    two-clock due/winner protocol while requiring `status = no_go` and
    `positivePathAuthorized = false` until the scheduled-source, passive-member,
    historical-caller and complete operation/effect catalogs are exact.
12. Every `negativeAssertions` property names an executed check. A literal
    `true` without the successful check is not evidence.

## 2. Top-level object

The object has exactly these keys:

- `format`: literal `omnitwin.foundry.activation-catalog-manifest.v1`;
- `manifestSha256`: prefixed digest computed as described above;
- `postgresql`: exact server major/minor, catalog feature set and normalized
  definition-printer version, pinned to PostgreSQL major 16;
- `sources`: content-addressed 0053–0058 SQL, activation/evidence/API/schema
  contracts, this format contract, the catalog JSON Schema, request/evidence
  schemas, canonical vectors, generator source, the pinned semantic-verifier
  source, the workload-inclusion proof Markdown contract and its JSON Schema;
- `identifierPolicy`: lower-case ASCII, maximum 63 UTF-8 bytes, collision rules;
- `inventoryScope`: exact managed names/prefixes and projected external
  dependencies;
- `composition`: baseline SHA, ordered typed delta operations and expanded-
  catalog SHA;
- `profiles`: the three lifecycle profiles below;
- `expectedCatalog`: the complete objects in sections 3–12;
- `contracts`: content-addressed closed request/evidence/context/canonical-row
  schemas and vectors referenced by columns/routines/constraints, plus the
  pinned semantic-verifier implementation and required workload-inclusion
  proof Markdown contract and JSON Schema;
- `semanticContracts`: the branch-sensitive objects in section 5: a closed
  NO-GO provider-result admission-materialization blocker contract, a frozen
  unimplemented record/claim contract with dedicated replay persistence,
  comparator, operation vectors and effect arms, and a watchdog-scan readiness
  boundary; and
- `negativeAssertions`: the closed absence rules in section 13.

Unknown or omitted top-level keys are invalid.

`identifierPolicy.collisionRules` is exactly the ordered four-rule vector
`reject_source_duplicates`, `reject_postgresql_truncation`,
`reject_cross_kind_collision`, `reject_generated_name_collision`. Omission,
addition or reordering is invalid.

## 3. Lifecycle profiles

Every role membership, ACL and bootstrap-only object state is evaluated in
exactly three profiles:

1. `post_install_pre_bootstrap`;
2. `bootstrap_open`; and
3. `steady_state_post_bootstrap`.

Both non-ceremony profiles set `bootstrapLoginAllowed`,
`bootstrapMembershipAllowed` and `bootstrapFunctionExecuteAllowed` to false.
`post_install_pre_bootstrap.v1ManagedRowsAreSentinelOnly` and
`bootstrap_open.v1ManagedRowsAreSentinelOnly` are true. This means exactly one
row exists across the 30 managed V1 tables: relation 1's immutable generation-1
`disabled_sentinel` with `disabled_reason = 'bootstrap'` and
`action_sequence = 1`, equal to the sole action-sequence start. The other 29
managed tables contain zero rows. It does not assert that the PostgreSQL
database, migration journal or projected external relations are empty.
`steady_state_post_bootstrap.v1ManagedRowsAreSentinelOnly` is false. The
bootstrap-open profile may exist only in the separately authorized disabled
ceremony before its one bootstrap mutation and sets the three bootstrap
permissions true. Those flags authorize only the ephemeral external deployment
LOGIN, its direct membership in the permanently NOLOGIN/NOINHERIT managed
bootstrap role, and bootstrap-function execution. Steady state requires no
bootstrap deployment LOGIN/member, permanent bootstrap-function EXECUTE
revocation and generation 1 still disabled. The verifier links these policy
flags to the exact managed-row state, role classification, membership/grant
lifecycle and routine classification; they are not free-standing assertions.

## 4. Roles, memberships and schemas

Each role entry enumerates name, owner/provenance classification, all PostgreSQL
`rol*` booleans, connection limit, password state, `valid_until`, exact
`rolconfig`, and managed/external status. Each membership enumerates role,
member, grantor, admin/inherit/set options, lifecycle profile and whether it is
permanent or `bootstrap_only`. Environment-varying managed-role OIDs are
recorded as `null`; projected external-role OIDs are positive integers. Raw
`rolconfig = NULL` remains distinct from an explicit empty array. A connection
limit is `-1` or greater. The managed union is exactly one owner, one bootstrap
and eight capability roles; no managed role has a service/deployment/migration/
external-dependency classification. In every profile, every managed role is
present and structurally NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEROLE, NOCREATEDB,
NOREPLICATION and NOBYPASSRLS, with no password and `rolconfig = NULL`; the
verifier also proves no membership path restores equivalent elevated power.
The external deployment LOGIN is present and LOGIN-capable only in
`bootstrap_open`, with only its direct `bootstrap_only` membership there.
External service LOGINs remain LOGIN/INHERIT and NOSUPERUSER, NOCREATEROLE,
NOCREATEDB, NOREPLICATION and NOBYPASSRLS in every profile; the ephemeral
deployment LOGIN has those same security attributes whenever present, and both
LOGIN classifications preserve `rolconfig = NULL`.
Every managed role and projected external service/deployment LOGIN also has zero
rows in `pg_db_role_setting` for the applicable database; a per-database role
setting is catalog drift and fails closed rather than being hidden by a null
`rolconfig`.
Each service LOGIN has exactly one direct edge to one capability role with
`inheritOption = true`, `setOption = false` and `adminOption = false`, and no
nested, cross-plane, owner, bootstrap or migration membership; the verifier
resolves those options and classifications rather than trusting role names.

Each schema enumerates qualified name, owner, raw ACL storage (`NULL` versus an
explicit ACL) and normalized effective grants per profile. The public schema,
`omnitwin_fdv1_ext`, every managed role and every external service LOGIN used by
the environment evidence must be represented; placeholders are invalid in an
environment-specific expansion.

The `public` schema matrix retains ambient `PUBLIC USAGE` and revokes `PUBLIC
CREATE`; the V1 owner and eight capability roles have direct `USAGE`, never
`CREATE`; service LOGINs have no direct grant; and bootstrap has a direct
`bootstrap_only` `USAGE` grant only in `bootstrap_open`. Its actual schema
owner/grantor/OID and any pre-existing non-V1 grant are environment evidence.
The `omnitwin_fdv1_ext` matrix instead gives its environment-recorded schema
owner `USAGE, CREATE`, the V1 owner `USAGE` only, and `PUBLIC`, bootstrap,
capability roles and service LOGINs neither privilege. Extension owner, schema
owner and member-routine owners are projected independently and must not be
collapsed to one assumed identity.
These are the only two entries in the managed/projected schema inventory, so
`summary.schemaCount = 2`; dependencies in `pg_catalog` remain external object
references rather than extra schema entries.

## 5. Extensions and sequences

Each extension entry enumerates name, exact version, schema, owner, relocatable
bit and required member-object/dependency assertions. The pgcrypto 1.3 entry
must prove that both `omnitwin_fdv1_ext.gen_random_bytes(pg_catalog.int4)` and
`omnitwin_fdv1_ext.digest(pg_catalog.bytea,pg_catalog.text)` are extension
members. For each it records the actual member owner, language C, `$libdir/
pgcrypto` binary, exact `pg_random_bytes`/`pg_digest` symbol, volatility,
parallel safety, strictness, security-invoker/non-leakproof behavior, return
type and raw/effective ACL. The full extension-schema routine surface is also
projected: `PUBLIC` has EXECUTE on none, the V1 owner has EXECUTE on exactly
those two signatures, and no bootstrap/capability/service identity has EXECUTE.
Every digest call uses literal algorithm `sha256`.

Each sequence enumerates qualified name, owner, `AS` type, start, increment,
minimum, maximum, cache, cycle, persistence, `OWNED BY`, exact raw/effective ACL
and the expected state policy for each lifecycle profile. The sole sequence is
exactly `public.fdv1_action_sequence_v1 AS bigint MINVALUE 1 MAXVALUE
9223372036854775807 START 1 INCREMENT 1 CACHE 1 NO CYCLE OWNED BY NONE`, owned
as an object by `omnitwin_fdv1_owner`. Its raw ACL in every profile is exactly
`{omnitwin_fdv1_owner=U/omnitwin_fdv1_owner}`; the owner has only ordinary
`USAGE`, while every other managed identity, service LOGIN and `PUBLIC` has no
sequence privilege.

All 30 sequence-backed columns have no default (`atthasdef = false`). Every
allocation record has `kind = explicit_nextval` and resolves to the exact
schema-qualified call `pg_catalog.nextval('public.fdv1_action_sequence_v1'::
pg_catalog.regclass)`; `column_default`, `setval`, sequence restart, literal or
copied values are forbidden. Allocation after replay/conflict checks and
root-first locks is checked from the closed allocation record and, for runtime
allocations, the matching routine effects rather than asserted only in prose.
`fdv1_api_record_provider_result` legitimately has zero V1 allocation steps in
its nonterminal, later-same and later-different arms: every fresh arm commits
the observation API-claim update, but only a first-terminal arm also inserts and
allocates R29. Provider-result evidence admission always allocates R27; its
later-different arm then allocates R24 and R22, in that order and after R27,
inside the same admission transaction. An orphan per-call allocation or an
allocation attributed to the wrong routine is rejected.

The top-level `semanticContracts.providerResultAdmission` object reserves the
otherwise branch-insensitive evidence-admission effect projection. Its required
`readinessGate.status` is currently `no_go`, so this schema is evidence of a
closed blocker, not authority to implement a positive path. For an
accepted `provider_result`, it names the exact R27 branch/owner columns and the
six observation admission fields, then proves this one root-first transaction:

1. derive the authenticated result state/tuple, prospective 0053
   classification, frozen branch and any first-terminal owner;
2. allocate the R27 admission sequence and insert R27;
3. insert the preallocated observation;
4. make or validate the command completion and installed attempt/execution
   projection;
5. insert or validate the preallocated completion event;
6. insert the preallocated classification; and
7. satisfy the named deferred bidirectional R27-to-0053 graph closure before
   commit.

The contract enumerates each top-level operation's exact branch-subarm array,
relation, insert/update/validate mode, planned-ID source, evidence/state/tuple/
outcome-digest equalities, clock source, closed `guardIdentifiers` array and
mandatory semantic-operation selector. The separate ordinary
`routineEffectStepSelector` is non-null only for lock/sequence ordering. Its graph relation
set includes R27, the observation, command, attempt, execution, completion event
and classification relations. The minimal command contract has exactly two
arms for invoked recovery commands (`provider_reconcile|provider_poll|
provider_stop`). Live admission prelocks the complete installed-guard superset,
inserts the planned observation, derives the exact command outcome, and uses
`GREATEST(command_guard_clock, old_command.updated_at + 1 microsecond)` strictly
before claim expiry with `completedBy={service,command.claimed_by}` and
classification `already_authoritative`. The sole pre-existing arm is a
V1-aware watchdog's immutable expired `uncertain/unknown` closure using
`claim_lease_expired_effect_unknown`, no prior observation/classification, and
`late_eligible`. Before R27 exists, its planned completion-event ID comes from
the exact locked command-claim→R19→R20→actual-call/invocation chain; the later
R27 copies that same ID. The live clocks satisfy
observation `recorded_at <=` command `completed_at =` completion-event
`recorded_at <=` classification `classified_at`; the watchdog's immutable
command/event time is no later than the new observation and classification.
No call rewrites a historical lease, revision, clock or projection.

Installed baseline conclusive completion, any pre-existing succeeded/failed
command, a random completion-event ID, or an occupied observation/classification
cannot be adopted. The installed 0053 completion cascade also has variable
attempt/execution updates, pending-command cancellations plus nested events,
and reconcile/stop successor rows; one trigger uses `SKIP LOCKED`. The current
top-level vector does not enumerate those effects and its aggregate cross-check
records that fact as false. The semantic preamble has exactly five outcomes:
equal replay, changed-key `23505`, byte-identical/different-key `23505`, fresh
authenticated structural conflict, and fresh accepted provider result. The last
expands exactly into the five result branches crossed with the two command-
completion subarms. Each preamble outcome and each accepted operation/subarm
requires its own semantic branch effect; neither replay/conflict nor the 10-way
accepted set may be represented as a flat union. `PR-A-001` through `PR-A-009`
must pass a future revised complete vector, closed cascade and generic conflict
catalog, live-routine AST/effect match and expanded-catalog match before
`readinessGate` can change under a new schema version. Literal branch strings
and this partial vector are not positive-path evidence.

The admission branch/state/owner/classification matrix is closed. Every accepted
typed graph requires command-local `already_authoritative|late_eligible`,
including `nonterminal` and `later_different_terminal`. First-terminal
success/failure has no owner; later-same and later-different require the
immediate first-terminal owner, with equality or inequality respectively. The first
terminal owner is chosen by `(admission_sequence,evidence_id)` with UUID-byte
ordering inside the exact activation/attempt/fence/output-slot scope. A terminal
`terminal_conflict`, `not_eligible`, or another relational mismatch is retained
as R27 `authenticated_structural_conflict`, creates no typed 0053 graph or R29,
and follows the generic authenticated-structural-conflict security/containment
policy. Only domain-separated R27 tuple inequality selects the distinct
accepted later-different containment policy.

For `later_different_terminal`, the admission contract continues after the
complete 0053 graph by allocating/inserting R24 and then R22. R24 is the
critical `provider_terminal_result_conflict` quarantine event for the current
accepted R27 ledger row, provider-evidence triple, recovery caller and exact
activation/execution/attempt/fence. R22 names that exact R24 source and evidence
triple, with null target terminal state and stop intent. The locked phase matrix
is exactly:

| Locked owner/output graph | R24 state | R22 phase effect |
| --- | --- | --- |
| frozen first-terminal owner R27 plus complete 0053 graph, R29 absent | `contained` | `post_terminal_broker_deny` |
| owner R29 present, no accepted storage-create R27 | `contained` | `post_terminal_broker_deny` |
| owner R29 and accepted storage-create R27 present, R23 absent | `contained` | `output_quarantine` |
| owner R29 and R23 present | `retained` | `post_custody_evidence_only` |

The pre-R29 owner graph is already the terminal barrier; `pre_submit_deny` and
`provider_stop` are impossible. A later historical R29 insert for that owner is
allowed through the exact containment, but every broker, custodian and public-
output positive predicate remains denied. The contract binds the R24/R22 field
sources, locked predicates, named guards and allocation/effect-step ordinals;
literal phase strings alone are not evidence.

The top-level `semanticContracts.recordProviderResult` object contains exactly
these five fresh-key arms:

| Arm | Status / result state | Required admission state | New managed insert/allocation | Required existing rows | Returned link |
| --- | --- | --- | --- | --- | --- |
| `nonterminal` | `pending` / `nonterminal` | complete 0053 graph; claim only | none | none | none |
| `first_terminal_success` | `recorded` / `terminal_success` | complete 0053 graph; claim | R29 | none | new R29 |
| `first_terminal_failure` | `recorded` / `terminal_failure` | complete 0053 graph; claim | R29 | none | new R29 |
| `later_same_terminal` | `recorded_same_terminal` / success or failure | complete 0053 graph; claim | none | owner R29 | existing R29 |
| `later_different_terminal` | `denied_terminal_conflict` / success or failure | complete 0053 graph plus exact admission R24/R22; claim | none | owner R29, R24, R22 | existing R29 |

The record contract's operation vector has exactly nine ordered steps:

1. before the root, derive `SESSION_USER`/`SYSTEM_USER`, read exact `pg_roles`/
   `pg_auth_members` membership, hash the system identity with the pinned digest
   routine, and resolve exactly one identity-only R25 candidate without treating
   it as current authority; then take the global root lock and lock the R5-pinned
   recovery caller/provider signer plus both rows' recursive parent/inclusion-
   root R25/R26 lineages and preliminary R1/execution/R11/R5 subject/phase and
   current-containment eligibility,
   and any claimed observation plus stored R27/R29. Later-different replay also
   locks and validates the current-evidence/ledger-linked R24 and its exact R22.
   After that complete set, every call samples one operation-1 authorization
   clock and validates the full caller/signer lineage before equal replay return,
   changed-key `23505`, or fresh continuation;
2. only after operation-1 authorization, a fresh key retains those locks, takes the
   remaining complete graph lock set, enumerates accepted R27 rows by
   `(admission_sequence,evidence_id)`, validates every earlier 0053 graph before
   considering its claim state, validates the selected R27 against the locked
   attempt/execution/fence/subject/phase, and selects the earliest complete
   unclaimed row;
3. validate the R27-frozen branch and owner without reclassification: a first
   terminal requires the link key free, later-same requires tuple equality and
   the owner R29, and later-different requires tuple inequality plus the exact
   existing admission R24/R22;
4. after the complete fresh-graph lock set, sample a distinct millisecond claim
   clock, revalidate the same R5-pinned caller/provider-signer recursive R25/R26
   closure at that time, and derive the exact domain-separated API-binding SHA
   from the selected observation;
5. update exactly the four API-claim columns, selected by
   `update:observation_api_claim`;
6. only for first-terminal success/failure, allocate one R29 `action_sequence`,
   selected by `sequence_allocation:r29.action_sequence`;
7. only for those first-terminal arms, insert the planned R29 selected by
   `insert:r29.first_terminal_link` and copy its caller/request/key/time fields
   from the claimed observation;
8. resolve the branch-specific returned link and, for later-different, validate
   the already committed admission containment without writing or returning
   containment IDs; and
9. prove the exact branch write set and return the selected R27 admission
   sequence plus the observation claim time, with no further mutation.

Every record operation has a mandatory `semanticOperationSelector`. The
ordinary `routineEffectStepSelector` is non-null only for operation 6's sequence
ordering; per-branch aggregate bindings carry the exact lock-step stable keys.

`guardIdentifiers` are semantic contract IDs, not permission to invent SQL
object names. Every operation carries a closed unique guard array; operation 5
contains the installed observation guard and API-binding guard as two elements,
and the same guard may legitimately recur at operations 4/5 or 6/7. A future
expanded catalog maps each selector exactly once and each guard by
`(operationNamespace,operationOrdinal,guardId)`. Every exact operation branch has its own
`branchEffects` entry containing applicability SQL, clock/mode, relation/column
accesses, one or more independently recomputed PostgreSQL-16 AST bindings,
aggregate-effect stable keys, writes, return fields and explicit outcomes.
The verifier rejects missing, duplicate, extra, concatenated-guard or union-only
mappings. Ordinary
`orderedSteps` remains only the lock/sequence-order projection.
`operationEffectCrossCheck` therefore
fixes `contractDefinitionStatus = frozen_unimplemented`,
`positiveImplementationAuthority = false`, and current live/catalog validation
`not_available`. `PR-R-001` is the decisive future proof: every fresh arm must
have exactly one observation claim update; only a first-terminal arm may also
have one R29 allocation and insert; and every arm must have zero 0053-graph,
R24 or R22 writes and no uncataloged read, lock, write, call or sequence effect.

Every fresh arm updates exactly the four nullable API-claim columns and has
`newlyCommitted = true`; no arm changes an installed 0053 field, command,
attempt, execution, event or classification. This is non-positive historical
materialization of an already accepted complete graph, including after later
containment. It does not require a current enabled epoch and never establishes
positive enabled-epoch authority. It locks and binds the exact R1/R11
activation, existing execution/attempt/fence, frozen subject/phase and current
containment, and may only claim the existing R27/0053 graph plus conditionally
create the historical first-terminal R29. It never authorizes submit, invoke,
broker, custody, release, a new execution/graph, R24 or R22; generation-1
disabled or any state without an eligible complete graph is `23514` without
mutation. Current R5-pinned recovery caller and provider signer
authority, including paired-caller equality, interval containment and recursive
parent/inclusion-root revocations, is still mandatory at both operation clocks.
Replay is resolved after that locked current-authority preamble and before any
fresh mutation. For a fresh key, the routine enumerates accepted R27 rows by admission sequence then
UUID byte order, validates every earlier row's exact complete graph and claim
state, and selects the earliest unclaimed graph. A missing/mismatched graph is
`23514` before any later row is considered; joining or filtering it away is
forbidden. The returned sequence is that R27 `admission_sequence` and the
returned time is the new observation `fdv1_api_claimed_at`. Equal replay and a
fresh continuation are both authorized at the common post-root/post-complete-
replay-lock operation-1 clock; operation 4 separately rechecks the same complete
caller/signer lineage at the claim clock. Equal replay returns the original
fields with `newlyCommitted = false`; changed key reuse is `23505`; no graph or
impossible frozen arm is `23514`. Replay return sources are closed: status is
the stored branch mapping; evidence/state/planned observation, completion and
classification IDs plus sequence come from the locked stored-triple R27;
terminal link ID/SHA are null or come from the locked branch-specific R29; time
comes from the claimed observation; and `newlyCommitted` is literal false.
Later-different replay must additionally prove the locked current R27-linked R24
and its exact R22 source/attempt/fence/phase closure, while returning no
containment identifier.

Fresh return closure uses the same 11-field order. Eight common sources are the
selected R27 evidence/state/planned IDs and admission sequence, the claimed
observation time, and literal `newlyCommitted = true`. Per-arm overrides provide
status plus link ID/SHA: nulls for nonterminal, operation-7 R29 for either first-
terminal arm, and the locked frozen-owner R29 for later-same/later-different.
Every returning semantic branch effect must resolve exactly those 11 fields.

The record contract's closed comparator fixes domain
`omnitwin.foundry.derivative-provider-result-tuple.v1`. At admission, its
current digest is the new accepted R27 `result_tuple_sha256` and its canonical
digest is the frozen terminal-owner R27 digest. At recording, a later arm's R29
provider-evidence triple must equal that frozen owner triple and reach the same
accepted R27 digest; the routine validates the frozen branch rather than
reselecting it. Equality selects later-same and inequality later-different.
Provider-command and provider-result-evidence identities, diagnostics, raw
response/outcome hashes, lifecycle, open outcome code, classification and
observation/admission/processing times are excluded. The later-different
offending table is exactly
`public.foundry_derivative_authenticated_evidence_v1`.

Its required `replayPersistence` object names
`public.foundry_provider_command_result_observations` and enumerates in physical
order exactly these ten nullable columns:

```text
fdv1_recovery_caller_id
fdv1_recovery_caller_sha256
fdv1_api_request_sha256
fdv1_api_idempotency_key
fdv1_provider_evidence_id
fdv1_provider_payload_raw_sha256
fdv1_provider_admission_sha256
fdv1_result_branch
fdv1_api_binding_sha256
fdv1_api_claimed_at
```

It fixes three states: baseline has all ten null; admission-materialized/
unclaimed has the caller pair, evidence triple and branch non-null and the four
API fields null; claimed has all ten non-null. Admission writes only those six
fields. Record performs only the four-field null-to-non-null update. The caller
pair is an immediate relation-25 composite FK and equals the accepted R27
recovery caller; the evidence triple is an immediate accepted-provider-result
R27 FK whose planned observation and branch equal this row. The partial unique
key is `(fdv1_recovery_caller_id,fdv1_api_idempotency_key)` with predicate
`fdv1_api_idempotency_key IS NOT NULL`.

Because `fdv1_api_record_provider_result(uuid,text)` has no request object, SQL
derives `sql_derived_api_request_sha256` from the exact scalar-only wrapper with
schema/domain `omnitwin.foundry.fdv1.record-provider-result-api-request.v1`,
function identity `public.fdv1_api_record_provider_result(uuid,text)`, ordered
`scalarArguments` as an array of exactly two closed `{name,value}` objects—
first `{name:"executionId",value:<lower-case UUID>}`, then
`{name:"apiIdempotencyKey",value:<exact nonempty UTF-8 text of at most 160
characters>}`—and canonical empty-object request `{}`. The wrapper has exactly
`schemaVersion,functionIdentity,scalarArguments,request`; strict RFC 8785 JCS
receives no implicit coercion or Unicode normalization, and the hash is the
prefixed SHA-256 of domain UTF-8 + LF + wrapper JCS UTF-8. Operation 5 stores
only this SQL-derived value and replay compares only against it. Thus the same
caller/key with a different execution is changed reuse `23505`, not replay.

The binding domain and `schemaVersion` literal are both
`omnitwin.foundry.fdv1.provider-result-api-binding.v1`. The prefixed SHA is over
that UTF-8 domain plus LF and RFC 8785 JCS of exactly
`schemaVersion,observationId,recoveryCallerId,recoveryCallerSha256,
apiRequestSha256,apiIdempotencyKey,providerEvidenceId,
providerPayloadRawSha256,providerAdmissionSha256,resultBranch,apiClaimedAt`,
with UUIDs lower-case and the claim time in canonical millisecond UTC form.
R29 first-terminal fields copy the dedicated caller/request/key fields and set
`linked_at` equal to `fdv1_api_claimed_at`. Verification must prove that 0053's
installed `actor_key`, internal `idempotency_key`, `request_digest` and
`recorded_at` retain their original meanings. The semantic verifier requires
exact correspondence among both provider-result semantic objects, aggregate routine effects,
executable branch predicates, named guards and allocation records; aggregate
unions cannot substitute for either closed object.

The third semantic object, `watchdogScan`, deliberately freezes only the
defensible readiness boundary. Its frozen cursor intent/summary has four rows;
the labels below are not executable SQL predicates or implementation authority:

| Phase | Frozen graph boundary | Effect | Target/stop |
| --- | --- | --- | --- |
| `dispatch_open` | authorized/submit-pending attempt; no R17 or R29 | `pre_submit_deny` | `terminal_killed`; no provider stop |
| `invocation_open` | R17; no R29 and no complete accepted first-terminal R27 graph | `provider_stop` | `terminal_killed`; stop required |
| `broker_open` | successful R29 or complete accepted first-success R27 graph; no accepted storage-create R27 | `post_terminal_broker_deny` | null; no provider stop |
| `custody_open` | same success owner plus accepted storage-create R27; no R23 | `output_quarantine` | null; no provider stop |

The scan may locate replay identity first but cannot return replay before the
common locked current-authority check. It then locks the global root, samples
the millisecond selection-only cutoff, uses inclusive `due_at <=
scan_cutoff_at`, selects one winner per attempt/fence/phase, globally orders
obligation tuples, takes and
rechecks the selected locks without `SKIP LOCKED`, and only then samples the
distinct mutation/receipt time. Specific scheduled transitions win an exact-
time tie over the synthetic passive-expiry envelope. The initial selection
excludes fully satisfied obligations, the limit counts obligations rather than
source rows, and `scan_cutoff_at <= database_time = receipt.recorded_at`.

That frozen intent/summary is not enough to implement the routine. The
readiness gate names blockers `WD-B-001` through `WD-B-008`: the scheduled-transition subarm
catalog is absent; base-policy generation source identity/SHA is ambiguous; a
future derivative-epoch arm conflicts with the current R1
`effective_at <= recorded_at` CHECK and unresolved UUID lineage; the passive
member catalog is incomplete by phase/substage; mutable command SHA, R25
lineage, custody horizon and empty-member behavior are unresolved; historical
caller/receipt validation is incomplete; the full read/lock/write/sequence and
nested closure vector is absent; and no exact executable cursor predicates
bound to the live routine AST/effects or expanded-catalog/live-routine vector
suite exist. WD-B-008 requires both plus the complete positive/negative suite.
The thirteen `rejectWatchdog*` assertions in the schema are the decisive
negative suite. None may be satisfied by copying this prose into a routine or
treating a materialized authority horizon as an expiry member.

The sole V1 action sequence is observed in every profile; inability to read its
state fails closed and `unobserved` is not a legal comparison. Both
sentinel-only pre-bootstrap profiles require exact state with `isCalled = true`
and `lastValue` equal to the sequence start because the migration-installed
sentinel consumes the first value. With start 1, increment 1 and cache 1, that
sentinel value is 1 and the next runtime allocation is 2. Steady state requires
`monotonic_no_reuse`, non-null `lastValue`, and exactly `isCalled = true`; false
is reset/reuse evidence. The verifier unions all 30 stored action/admission-
sequence columns, proves every value positive and globally unique, the sentinel
alone at 1, and `max(stored value) <= lastValue`. Rollback gaps are legal;
reset, regression, reuse, cycling or allocation beyond the maximum fails
closed.
`allocations` is a closed union discriminated by `origin`. Exactly one
`installation_seed` arm names relation 1's generation-1 bootstrap
`disabled_sentinel` and its `action_sequence` column, requires
`afterRootFirstLocks = true`, and has `effectStepOrdinal = null` because the
migration seed is not a routine effect. Every `runtime` arm carries a positive
matching routine-effect step ordinal. The routine's unified `orderedSteps`
interleaves advisory/relation/row locks and `sequence_allocation` steps so the
verifier can prove runtime ordering rather than trusting
`afterRootFirstLocks = true` alone. The semantic verifier proves there is
exactly one installation-seed allocation, that it produced the sentinel value,
and that no default, literal assignment, copy, restart or `setval` can make the
next allocation reuse 1.

## 6. Tables and ordered columns

Each table enumerates qualified name, provenance, owner, relation kind,
persistence, access method, tablespace, partition status, replica identity,
RLS/force-RLS bits and raw/effective ACL.

The activation V1 managed set is exactly 30 permanent, non-partitioned ordinary
heap tables. Its table entries therefore use `relationKind = ordinary`,
`persistence = permanent`, `accessMethod = heap`, `partition.isPartition =
false`, and null partition parent/bound values. Partition parents, child
partitions, foreign relations, custom access methods, temporary tables and
unlogged tables are outside this manifest set.

Live verification also requires no user DML rewrite rule in `pg_rewrite`, no
ordinary-inheritance edge in either direction in `pg_inherits` and no logical-
replication exposure for any managed table. It checks direct relations, `FOR
ALL TABLES` and schema-level publications through `pg_publication`,
`pg_publication_rel` and `pg_publication_namespace`, plus `pg_subscription`/
`pg_subscription_rel`, so apply workers cannot target V1 tables under replica
semantics. Expected catalog internals are matched exactly; an extra rule,
inheritance edge, publication or subscription fails closed.

Table entries additionally enumerate exact `reloptions`, `toast_reloptions` and
their expected defaults. Their `columns` array is complete and ordered by expected `attnum`. Every element
enumerates name, type schema/name, typmod, nullability, exact default SQL and
dependencies, identity/generated flags, collation, storage, compression and
`dropped = false`. The PostgreSQL 16 projection also records
`atthasmissing`/the canonical missing value, `attislocal`, `attinhcount`,
column options and FDW options, preserving all required raw null states.
`generated` is only `none` or `stored` on PostgreSQL 16. Global deltas such as `action_sequence` and
`timestamptz(3)` are expanded into each affected table; grouped insertion prose
is not an allowed final representation.

## 7. Constraints

Every constraint has an explicit identifier and enumerates kind, local ordered
columns or a canonical expression, validation state and backing index when
applicable. Foreign keys additionally enumerate referenced relation/columns,
match type, update/delete actions, optional ordered delete-action column subset,
deferrability and initial state. PostgreSQL 16 accepts only `simple` and `full`
here; unimplemented `partial` is invalid. `onDeleteSetColumns` is nonempty and
a subset of the local FK columns only for `SET NULL`/`SET DEFAULT`, and is
`null` for every other delete action. The verifier checks its order, subset and
action linkage.
Constraint kinds are an exhaustive PostgreSQL 16 projection: CHECK, primary
key, unique, foreign key, exclusion and source-named constraint-trigger rows.
Table NOT NULL state remains a column fact rather than a fabricated
`pg_constraint` kind. Constraint-trigger rows identify their explicit trigger;
the verifier cross-checks the reciprocal trigger owner. Exclusion operators
use schema-qualified PostgreSQL operator spellings such as `=`, `&&` and `?`, not
identifier syntax; their positional array aligns with the exclusion keys and
preserves legal repeated key columns/expressions and operators. Primary, unique
and foreign-key column lists remain duplicate-free.

A phrase such as `named guard`, `closed arm`, `same graph`, or `exact source
closure` is invalid in the expanded catalog. Cross-row/table conditions must be
represented by their exact constraint-trigger/routine objects and canonical SQL
definitions.

## 8. Indexes

Every index enumerates explicit identifier, access method, uniqueness/primary/
exclusion/nulls-not-distinct flags, ordered key columns or canonical
expressions, collation, opclass, direction/null ordering, included columns,
predicate, immediate/valid/ready/live/clustered/replica-identity bits and any
owning constraint. Partial accepted-evidence, replay, receipt/link composite and
idempotency indexes may not be described only by prose.
The raw `indcheckxmin` bit is also mandatory. Primary and
nulls-not-distinct indexes must be unique. A primary index is non-exclusion,
not nulls-distinct, non-partial and resolves to its owning constraint. An
exclusion index is neither primary nor unique, is not nulls-distinct and also
resolves to its owning constraint. Repeated positional keys are preserved
rather than rejected as set duplicates; the verifier resolves the owning
constraint and cross-checks that constraint's kind.

## 9. Triggers and policies

Every ordinary or constraint trigger enumerates explicit identifier, timing,
event list and update-column list, row/statement level, `WHEN` expression,
transition tables, called routine identity/arguments, enabled mode, internal
bit, deferrability, initial state, machine-readable purpose and provenance. Each
of the thirty tables has exactly one `mutation_denial` trigger; every deferred
closure/arm guard is individually present with `closure_guard` or `arm_guard`
purpose. Constraint triggers are AFTER ROW and resolve to a
`constraint_trigger` catalog entry. Repeated positional trigger arguments are
preserved rather than deduplicated. A mutation-denial trigger is exactly an
ordinary unconditional `BEFORE STATEMENT` trigger over `UPDATE`, `DELETE` and
`TRUNCATE`, with no `UPDATE OF` list or transition tables; static body analysis
proves its called routine always denies the mutation. `INSTEAD OF` is invalid
because this closed inventory contains tables, not views. A `TRUNCATE` trigger
is statement-level; constraint triggers cannot use transition tables; and a
transition-table trigger is ordinary `AFTER`, names exactly one compatible
non-TRUNCATE event, and has no `UPDATE OF` list.

Every table has an explicit policy array, including an empty array where no
policy exists. Each policy enumerates name, command, permissive/restrictive
mode, roles and canonical `USING`/`WITH CHECK` expressions.

## 10. Routines and effects

Every public entry point and internal/helper/trigger routine enumerates:

- qualified name and identity arguments;
- machine-readable classification as public entry point, bootstrap entry point,
  internal helper, predicate helper or trigger function;
- ordered argument names, modes, types and defaults;
- an exhaustive return arm: scalar, set-returning table, PostgreSQL `void`,
  PostgreSQL `trigger`, or non-set-returning procedure OUT record, with exact
  type and ordered OUT columns;
- language and either an inline exact body or a content-addressed exact body
  artifact plus digest; digest-only routine definitions are forbidden because
  static effect/body comparison must be reproducible;
- owner, volatility, parallel mode, strict/leakproof/security flags, cost,
  rows and support function;
- exact nullable `proconfig`, including search path and preserving catalog
  `NULL` versus an explicit empty array;
- object dependencies and raw/effective ACL; and
- a non-catalog `effects` record listing read tables/columns, inserted tables/
  columns, updated columns, called routines and sequence use, plus unified
  ordered advisory/relation/row-lock and sequence-allocation steps; and
- a closed `semanticOperationSteps` array. Each entry contains selector,
  contract and operation ordinal, effect kind, a closed unique guard-ID array,
  and exact per-branch effects. Each branch effect contains its applicability
  contract/SQL, mode/clock, one or more exact AST bindings, relation/column
  accesses, aggregate-effect stable-key bindings, writes, return fields and a
  closed set of structured continuation/return/error outcomes. Continuations
  bind the full non-null target tuple
  `(nextOperationNamespace,nextOperationOrdinal)`; return/error outcomes bind
  null for both target fields. The semantic
  verifier enforces unique `(operationNamespace,operationOrdinal,branch)`
  coverage and `(operationNamespace,operationOrdinal,guardId)` matching, expands only contract-declared branch
  universes, and rejects a flat aggregate union. The array is empty only when no
  semantic contract references that routine.

The closed managed-language set is `LANGUAGE sql` and `LANGUAGE plpgsql`;
extension-member C/binary routines remain in their separate extension/
dependency projection. The pinned semantic verifier pins PostgreSQL 16 SQL and
PL/pgSQL grammar/analyzer versions and fails closed on any language, parser
construct or parser version it does not support. It may not accept an unanalyzed
body by treating declared `effects` as truth.

For each AST binding, the verifier constructs the closed projection
`{schemaVersion,routineDefinitionSha256,nodePath,statementOrdinal,nodeKind,
normalizedNode}` from the independently pinned parser/analyzer and hashes its
RFC-8785 JCS under domain
`omnitwin.foundry.fdv1.semantic-operation-ast-node.v1`; a predicate projection
is hashed under the corresponding `.predicate.v1` domain or is null only when
the AST node has no predicate. `aggregateEffectBindings.stableKey` is the exact
RFC-8785 JCS text of the resolved aggregate effect (effect set, qualified
target, ordered columns and predicate where applicable; routine identity for a
call; qualified sequence for sequence use; full ordinal record for an ordered
step). The verifier requires bidirectional equality: no semantic access/write/
call/sequence may lack an aggregate binding and no claimed binding may be
absent from the analyzed AST.

Static checks compare effects to the SQL body and to owner privileges. A replay
that merely discovers another needed privilege fails the manifest; it cannot
broaden the grant in place.
Content-addressed routine bodies are fetched before analysis; their artifact
digest and definition digest must name the same exact SQL/text bytes. Every
effect/dependency set rejects duplicates and must be byte/body-derived rather
than hand-waved.

## 11. ACL and default-ACL normalization

Normalized grants are rows with lifecycle profile, object kind/identity,
optional column, grantor, grantee, privilege and grantable bit. Raw ACL storage
(`NULL` versus explicit ACL) is recorded separately. Verification expands
`PUBLIC` and memberships for effective-right checks while still comparing raw
ACLs exactly.

Every normalized grant is also classified as permanent or `bootstrap_only`.
The latter is legal only in `bootstrap_open`. Object/privilege arms are closed:
table SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; column
SELECT/INSERT/UPDATE/REFERENCES; sequence USAGE/SELECT/UPDATE; routine EXECUTE;
schema USAGE/CREATE; type/language/FDW/server USAGE; database
CREATE/CONNECT/TEMPORARY, parameter SET/ALTER SYSTEM, large-object
SELECT/UPDATE and tablespace CREATE may not be interchanged.
`MAINTAIN` is not a PostgreSQL 16 privilege and is rejected. PUBLIC grants and
PUBLIC default-ACL grants always have `grantable = false`.

Default ACL entries enumerate owner, schema, object type, raw ACL storage and
normalized grants. Their legal privilege arm is selected by default object
type. Table-wide and column grants are not interchangeable.

For `omnitwin_fdv1_owner`, routine and type default hardening is global: the
source statements omit `IN SCHEMA`. The exact expected rows are a global
routine entry `{omnitwin_fdv1_owner=X/omnitwin_fdv1_owner}` and a global type
entry `{omnitwin_fdv1_owner=U/omnitwin_fdv1_owner}`, with no per-schema routine
or type entry. Table and sequence PUBLIC revokes normally create no row because
PostgreSQL's hard-wired defaults already grant PUBLIC nothing; the verifier
distinguishes that absence from an unexpected grant. Per-schema revocation is
not accepted as a substitute for the two global rows. Default privileges apply
to the creator's `current_role`, so each object's actual creator and creation-
time role are frozen; later ownership transfer cannot satisfy this invariant.
Explicit per-object revocation remains mandatory.
The profile-expanded manifest therefore contains exactly six default-ACL
entries: the same global routine/type pair in each of the three lifecycle
profiles, and `summary.defaultAclCount = 6`.

## 12. External dependencies and contracts

External dependencies project only the exact 0053–0057/base relation, routine,
type, trigger and column facts required by V1, including every privilege of the
V1 owner, ten managed roles and environment service LOGINs. Unrelated
application ACLs are not frozen, but an unprojected dependency in a routine body
is an error.

`contracts` references content-addressed JSON Schemas and canonical vectors for
all JSONB inputs, raw evidence/report/context bytes, discriminated payloads and
SQL-constructed canonical rows. Catalog shape alone is not treated as proof of
byte semantics.
Columns, constraints and routines carry the contract IDs they consume; each
contract artifact carries the reverse consumer identities. The verifier
requires bidirectional set equality. `verifierContractIds` supplies the forward
link for exactly three verifier-consumed artifacts: the content-addressed
semantic-verifier implementation and the workload proof pair. Its source-set
twin is the required `semantic_verifier_source`; the bootstrap caller requires
matching normalized path, media type, byte length and digest, and compares all
of them with an authenticated out-of-band verifier pin before execution.
Manifest-internal content addressing is not verifier authorization.
The verifier implementation has no catalog consumer; its use is recorded by
`verifierContractIds`. The workload proof pair names the real workload-
registration routine and candidate/verification column or constraint consumers
that reference its IDs. Every non-verifier contract may name only column,
constraint or routine consumers, and the forward/reverse sets must agree. Two
additional required contract/source kinds freeze
`docs/specs/omnitwin-foundry-activation-v1-workload-inclusion-proof.md` and
`docs/specs/omnitwin-foundry-activation-v1-workload-inclusion-proof.schema.json`.
Their mutable hashes belong only in a generated manifest instance and are not
embedded in this format contract.

PostgreSQL-generated structural dependents are a separate closed projection,
not unmanaged extras. Row composite types, array types, TOAST relations and
TOAST indexes are matched through `pg_depend` to their owning managed table and
compared for kind, namespace, owner, persistence, access method, reloptions,
TOAST options and ACL. Their OID-derived names/OIDs are deliberately not frozen.
Constraint-owned indexes with source-chosen names remain in the ordinary exact
index inventory. A generated object without the expected dependency, or an
unexpected generated kind/options/privilege, fails verification.
Because V1 has exactly thirty tables, the structural schema requires exactly
thirty row-composite and thirty array-type entries before any TOAST or generated
trigger entries. Stable owner-key set equality—not those counts alone—proves
one pair belongs to every table. Summary fields separately count each generated
kind; the verifier derives them and requires TOAST relation/index pairing.

OID-named internal referential-integrity/constraint triggers are in the same
dependency-keyed projection. They are matched through their FK/constraint and
`pg_depend`, comparing exact count, AFTER ROW level, non-TRUNCATE events,
deferrability/initial state, called internal function identity, enabled/internal
flags and dependencies; an OID-derived trigger name is not frozen. Source-named
V1 ordinary/constraint triggers remain in the explicit trigger inventory. An
unexpected internal trigger or a generated trigger detached from its expected
constraint fails.

## 13. Negative assertions

The final object explicitly rejects:

- an extra/missing managed or projected generated object, overload, role,
  membership, policy, trigger, index or column;
- a truncated/colliding/overlength identifier;
- an unexpected owner, ACL/default ACL, schema privilege, RLS bit, dropped
  column, default, type/typmod/order drift or extension member;
- sequence definition/allocation/ACL drift, including a column default,
  non-`explicit_nextval` allocation, `setval`/restart/literal/copy path,
  sequence privilege beyond owner USAGE, false steady-state `isCalled`, or
  cross-table stored-value collision;
- pgcrypto execution-surface drift, including a missing/wrong approved member,
  binary/symbol/property drift, PUBLIC execution, owner execution of another
  extension routine, or caller-selected digest algorithm;
- default-privilege creator/scope drift, including per-schema-only routine/type
  revocation or object creation under an unmodeled `current_role`;
- `rejectProviderResultEffectArmDrift`: a missing/extra/reordered admission or
  record branch; opaque branch macro, concatenated guard, flat effect union or
  wrong per-branch AST/access/write/return/outcome; incomplete atomic R27/0053
  graph; a missing/changed frozen R27 owner; terminal conflict outside later-
  different; replay data placed in 0053's installed actor/key/digest/time fields
  instead of the exact ten dedicated columns/binding; an invalid three-state
  transition; allocation outside R27 then R24/R22 at later-different admission
  or R29 at first-terminal record; containment that blocks historical owner R29
  or permits a positive output path; missing pre-root identity/catalog/builtin
  effects; replay before the locked current R5-pinned caller/provider-signer
  recursive R25/R26 plus R1/execution/R11 preamble; missing R27/R29 or
  later-different R24/R22 replay closure; expanded historical-result authority;
  replay/fresh-return source, authorization-clock, SQLSTATE, sequence or time-source drift; or a
  selector whose semantic-operation branch/AST/aggregate/write/return binding
  or namespace-plus-ordinal continuation target is missing, duplicated or
  mismatched;
- `rejectProviderResultSameCallerKeyDifferentExecutionReplay`: the same caller
  and API key with another `executionId` must change the exact scalar-wrapper
  digest and fail `23505` without mutation;
- `rejectProviderResultReplayContainmentClosureDrift`: a later-different replay
  with missing/mismatched/unlocked current R27-linked R24 or R24-sourced R22;
- `rejectProviderResultCommandReservationColumns`: any superseded
  `fdv1_result_*` command-reservation column or equivalent constraint, index,
  guard or sidecar on `public.foundry_provider_commands`;
- `rejectDelayedProviderResult0053Materialization`: an accepted provider-result
  R27 without its exact complete 0053 graph at admission commit, or later graph
  creation/mutation by another routine;
- `rejectRecordTimeProviderResultContainment`: any R24/R22 allocation or insert
  by the record routine rather than R27-then-R24-then-R22 admission order; and
- `rejectPreR29ProviderStopForFrozenTerminalOwner`: `pre_submit_deny` or
  `provider_stop` after the frozen first-terminal owner R27 and complete 0053
  graph exist, or any later R29 that reopens output;
- `rejectLifecycleManagedRowOrSequenceCoherenceDrift`: lifecycle managed-row or
  action-sequence incoherence, including a missing or extra sentinel, another
  managed row in a sentinel-only profile, a sentinel value/canonical leaf that
  differs from sequence start/last value, any pre-bootstrap `isCalled` value
  other than true, zero or multiple installation-seed allocations, reset,
  regression or reuse;
- service/PUBLIC execution of an internal helper;
- service table/sequence DML or cross-plane effective privilege; and
- any catalog object or byte contract still represented by an unresolved prose
  placeholder.

## 14. Verification inputs

Catalog primitives are primary truth: `pg_roles`, `pg_auth_members`,
`pg_db_role_setting`, `pg_namespace`, `pg_extension`, `pg_depend`, `pg_class`,
`pg_attribute`, `pg_attrdef`, `pg_sequence`, live sequence state,
`pg_constraint`, `pg_index`, `pg_trigger`, `pg_policy`, `pg_proc`, `pg_type`,
`pg_collation`, `pg_default_acl` and `aclexplode`. Pinned-version
`pg_get_expr`, `pg_get_constraintdef`, `pg_get_indexdef` and
`pg_get_functiondef` strings are secondary definition checks.

The PostgreSQL 16 projection additionally preserves required raw states that a
normalized definition can hide, including managed/external role-OID policy,
nullable `rolconfig`/`proconfig`, column missing/inheritance/options state and
`pg_index.indcheckxmin`. Dependency identities cover languages, operators,
operator classes/families, access methods, casts and other referenced catalog
kinds; dependency types include normal, auto, internal, extension,
auto-extension, pin and partition dependencies.

The external projected-fact catalog set covers the matching PostgreSQL 16
catalogs for every allowed object/dependency kind, including operator/opclass/
opfamily/access-method/cast/language catalogs, shared grant-bearing catalogs,
foreign/partition/type catalogs, `pg_depend`/`pg_shdepend`, rewrite/inheritance
catalogs and publication/subscription catalogs. For every managed table, column,
routine and type, the verifier walks reverse dependencies to exact closure and
rejects any unmodeled external view/materialized view, rule, foreign key,
generated expression, trigger or other dependent regardless of object name or
managed prefix.

## 15. Current blocker

The strict Draft 2020-12 JSON Schema now exists beside this document, including
the required workload-inclusion proof artifact kinds. No expanded
`expectedCatalog` instance, frozen source/contract hashes, deterministic
generator output, semantic-verifier implementation bytes, independently
authenticated bootstrap/review pin for those bytes, live PostgreSQL 16 catalog
comparison or adversarial acceptance evidence exists yet. Final
attnums/defaults, actual identifiers, executable CHECK/closure definitions,
indexes, trigger inventory, internal routine bodies/effects, raw ACL/default-ACL
storage and lifecycle instances therefore remain unproven data rather than
facts supplied by this format. This document and schema are not evidence that
migration 0058 is repairable, runnable or authorized.
