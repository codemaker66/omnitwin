# Saved manual plans can produce immutable phase evidence

Scoped implementation decision, 6 September 2026. This supplements the existing
canonical snapshot, validator and phase-lineage contracts; it does not replace an
accepted ADR or change approval policy. Local candidate only, not deployed.

The real manual edit → approve → freeze path returned
`CONFIGURATION_CANONICAL_SNAPSHOT_MISSING`: only Event Architect produced canonical
snapshots. Its one-row-per-configuration constraint also prevented keeping evidence
for a later saved revision without overwriting older phase references.

The existing freeze endpoint continues to accept only a configuration ID. Its
transaction reads the actual saved configuration, full placed objects and measured
catalogue dimensions. With no prior evidence, or after the saved configuration's
`updatedAt` or persisted review source-state changes, it builds a normalized canonical snapshot from these sources
and the stored room outline, runs the existing validator and appends both rows.
An absent runtime package remains null; the actual outline digest is computed.
The existing internal planning policy is shared unchanged with Event Architect.

Existing canonical payload/digest/identity and proof authenticity are checked
before refreshing stale evidence. Corrupt or missing prior proof is rejected,
never repaired by silently generating another proof. Valid evidence matching the
saved timestamp and review source-state is reused through the existing full object verifier. Untracked
same-timestamp object/catalogue drift is still rejected. This change does not
introduce an automatic room/runtime publication refresh of existing evidence.

Migration 0064 removes only the configuration uniqueness constraint and adds a
configuration/createdAt/id lookup index. Digest uniqueness and all exact-ID lineage
foreign keys remain. Lookup uses descending createdAt then ID; new rows are never
upserts. The phase advisory lock preserves append idempotency, a configuration
advisory lock serializes producers across different phases, and the existing
observed-revision/FOR SHARE sequence rejects queued edits that advance the saved
revision. Any failed source, validator exception, proof verification or phase
append rolls back the transaction. Old canonical/proof/phase IDs remain intact.

Authoritative event and phase reads also hold `FOR SHARE` row locks, in that order,
before the configuration read. The phase-update API does not use the freeze
advisory key, so its actual room reassignment must wait for an active freeze to
commit. A deliberate reassignment after commit remains allowed: the old room no
longer lists the moved phase, and the new room marks its old room-bound keyframe
invalid until a matching plan is frozen. Historical evidence is not rewritten.

A genuine validator run can contain failed, unknown and human-review witnesses.
Freezing proves its authenticated lineage, not that every witness passes and not
that a plan is safe, approved or ready for external delivery. Source-state records
the persisted review status; prior generator provenance is retained when a saved
generated plan is refreshed. Manual sources do not invent event times, pricing,
service assumptions, safety approval or runtime provenance.

Reader/writer audit:

| Consumer | Assumption after this change |
| --- | --- |
| `services/event-architect.ts` | Inserts once per newly generated configuration; unchanged IDs and policy. |
| `routes/phase-layout-snapshots.ts` | Only configuration lookup; deterministic newest evidence, serialized append. |
| `routes/room-layout-timeline.ts` | Joins the phase's exact canonical ID; historical frames unchanged. |
| `layout_validation_runs` / `event_architect_candidates` | Exact snapshot-ID references; no configuration uniqueness assumption. |
| Migrations 0047, 0060, 0063 | Historical migration bytes retained; 0064 makes the explicit new schema change. |
| Historical migration-tail readiness JSON | Dated inspection receipt retains the former constraint name. |

Verification belongs to the focused pure normalization tests and real PostgreSQL
phase lifecycle rehearsal, including manual approval, changed saves, same-plan
concurrent phases, same-phase retries, queued edits, invalid prior proof, final
append rollback, room-flip and tenant/room denials. Receipts remain under
`D:/claude/demo-platform-local-20260906`; passing these checks qualifies the local
API behavior only.

Verified locally at 18:42 UTC: 68 focused tests passed, including 26 actual
PostgreSQL lifecycle cases against a new explicitly named disposable database.
Receipt: `manual-evidence-tests-1788720143057.json` in the directory above.
Changed-file lint passed. API typecheck retains 52 existing errors and build
retains eight, normalized exactly to the prior baseline; none are in this slice.
The full API typecheck/build therefore remain blocked, not claimed green.

The phase-reassignment regression first failed against `643aa310` (receipt
`manual-evidence-tests-1788719989242.json`), where an actual PATCH completed
before the blocked freeze. It passes with the event/phase row locks.
