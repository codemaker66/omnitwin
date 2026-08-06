# OmniTwin Foundry derivative activation V1 — second-amendment audit

Date: 2026-07-14  
Audited artifact: `docs/specs/omnitwin-foundry-derivative-activation-v1.md`  
Bytes: `69,012`  
Physical lines: `1,162`  
SHA-256: `1f593314fd45850950afe168548ac1eefebabea2e0754ee05101cc21c4371659`

## Why a second amendment was required

Disposable PostgreSQL implementation invalidated the first design GO. The
audited contract required the JobSpec `outputPrefix` to equal a reservation
prefix ending in `/`, but unchanged migration 0053's
`foundry_is_safe_relative_path` rejects the resulting terminal empty segment.
No enabled exact subject could therefore have been constructed.

The second amendment keeps 0053 untouched. It defines the shared JobSpec and
reservation prefix as one normalized safe-relative directory path with no
leading or trailing slash and no empty segment. The deterministic object key is
`output_prefix || "/normalized.glb"`.

## Independent design verdict

- P0: none.
- P1: none.
- P2: none.
- P3: the existing catalog-test expansion remains mandatory.
- Second-amended design: **GO to continue implementing and testing inert 0058-A only.**
- Current SQL implementation at this audit point: **NO-GO pending its separate enforcement audit.**
- Enabled epoch / migration 0059: **NO-GO.**

The independent reviewer matched the exact SHA and size and confirmed that the
new prefix is constructible under the unchanged 0053 predicate, that the job
and reservation prefixes remain identical, and that adding `/normalized.glb`
only at object-key construction introduces no new path/namespace contradiction.
The previous design blockers remained closed.

The reviewer reiterated that the implementation catalog proof must inspect
`pg_policy` and `pg_attribute` in addition to the catalogs named in the design,
so policy and column identifiers cannot silently truncate or collide at
PostgreSQL's 63-byte limit.

## Boundary

This is a design-only, unsigned, authority-none review. It does not approve the
current SQL, which separately showed enforcement gaps during review, and it is
not evidence for an application, workload identity, IAM policy, storage path,
broker, custodian, enabled epoch or live system. It authorizes no execution,
provider call, credential use, object-store mutation, spend, signing,
publication, promotion or production database action.
