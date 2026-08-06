# OmniTwin Foundry derivative activation V1 — independent contract audit

Date: 2026-07-14  
Audited artifact: `docs/specs/omnitwin-foundry-derivative-activation-v1.md`  
Bytes: `68,788`  
Physical lines: `1,161`  
SHA-256: `8442babfb2a636c508016d4bdaca169b70b94b2c8f650d7cb6f44b52d3149788`

## Verdict

- P0: none.
- P1: none.
- P2: none.
- P3: one non-blocking implementation-test expansion below.
- Inert migration 0058-A: **GO to implement and test as a generation-1-disabled substrate only.**
- Enabled epoch / migration 0059: **NO-GO.**

**Post-audit invalidation:** disposable PostgreSQL implementation subsequently
proved that the audited contract's trailing-slash reservation prefix could not
equal an insertable 0053 JobSpec `outputPrefix`: the unchanged
`foundry_is_safe_relative_path` rejects the terminal empty segment. The GO above
therefore applies only as historical review evidence and no longer clears the
amended 0058 implementation. The contract was changed to a safe-relative
no-trailing-slash directory prefix with
`object_key = output_prefix || "/normalized.glb"`; that new exact hash requires a
fresh independent re-audit. Enabled authority and 0059 remain NO-GO throughout.

This was a read-only review by an agent that did not author the activation
contract. The review receipt is an unsigned, internal, authority-none record;
it is not cryptographic proof of reviewer identity, time, independence or
immutable custody.

## Prior blocking findings rechecked

The audit found the previously blocking design issues substantively closed:

1. The bootstrap epoch is feasible without an administrator, future evidence or a self-reference to migration 0058 (`536–567`, `1105–1108`).
2. The exact 24-table set and compact natural references avoid PostgreSQL's identifier and composite-key limits (`143–169`, `925–972`).
3. All eight functions attached to the 0056 boundary are explicitly replaced without modifying 0056 or dropping its triggers (`976–1000`).
4. Stop-intent integration extends the existing 0053 mapping/guard, preserves the existing kill/base-rights intents, and adds root-first kill-event handling (`642–676`).
5. Phase-specific database time, minimum horizons, future-generation behavior and historical action-time authority are separated (`583–613`, `678–698`).
6. Broker authorization and immediate pre-PUT one-use database redemption are distinct; redemption is not storage-contact evidence (`396–423`).
7. Pending sidecars contain no claim tuple or premature event FK; opaque planned UUIDs acquire real equality/FK evidence only when materialized (`313–333`, `954–962`, `1017–1035`).
8. Latest-effective epoch selection cannot skip backward past a disabled row (`569–580`).
9. `provider_invocation_started` remains a pre-call possible-invocation boundary and never proves provider contact (`242–264`).
10. Custody, invalid/conflict/late/current priority, namespace denial and the pre-classification reverse scan are explicitly closed (`461–530`, `856–923`).
11. All database enforcement is assigned to disabled 0058-A; application and infrastructure wiring remain later, separately audited stages (`84–109`, `1041–1052`).

## P3 implementation-test expansion

The contract requires every PostgreSQL identifier to be checked for silent
63-byte truncation or collision, including policies and columns. Its named
catalog sweep at `966–972` and `1109–1111` lists `pg_class`, `pg_constraint`,
`pg_proc`, `pg_trigger` and roles but omits `pg_policy` and `pg_attribute`.

The 0058 implementation gate must therefore inspect both additional catalogs
and fail on a truncated or colliding policy or column identifier. This expands
the implementation test; it does not authorize changing the audited contract.

## Boundary at audit cutoff

At the audit cutoff there was no migration 0058, application store, workload
identity, IAM policy, storage profile, broker, custodian, enabled epoch or live
evidence. A passing design review permits only implementation and disposable
testing of the inert disabled substrate. It authorizes no execution, provider
call, credential use, object-store mutation, spend, signing, publication,
promotion or production database action. Migration 0059 remains prohibited.
