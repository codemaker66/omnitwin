# Goal 15 — Coherent event access and client schedule

Activated by Blake's 14 September 2026 instruction: “create and carry out the
next prompt.” Task **T-611**, primary launch package **F-03**, following completed
[Goal 14](14-friday-release-baseline.md) and its
[reproduced baseline](../docs/reports/friday-release-baseline-2026-09-15.md).
Status: **complete, 15 September 2026**. No token budget requested.

Delivered API04dbd8bb and web28209abc with exact provider/domain verification,
a real founder-provider event/layout journey, final hosted Test/Lint/Build/Typecheck,
53 required PostgreSQL cases and15 public smoke checks passing. Ordinary client
and venue-admin isolation/revocation remain separately verified through actual
local API/PostgreSQL/rendered synthetic-role tests. The [delivery report](../docs/reports/event-access-and-client-schedule-2026-09-15.md)
records those limits, preserved work and exact receipts. Whole-platform security,
E2E, ordinary-client provider lifecycle, physical-device60fps and design acceptance
remain open. F-15 dependency remediation is recommended next, not activated.

15September implementation decision: current v1 authority is the freshly resolved
`users.role`, `venueId` and `platformRole`. Workspace membership records are an
onboarding shell, and cancelling a pending invitation does not revoke an accepted
account. This goal tests real current-user authority and derived event-link
revocation; it does not claim to deliver a new accepted-membership management
interface. The implementation also closes directly related customer-role access
through venue analytics, Event Architect and event notifications. Current evidence
is in the [active delivery report](../docs/reports/event-access-and-client-schedule-2026-09-15.md).

## Execution prompt

Deliver one coherent event access contract for the released Venviewer application.
Repair the reproduced venue-admin enquiry inbox omission. Give an authenticated
client an intuitive view of the event and schedule to which their own saved plan
is legitimately connected. Keep venue operations, staff notes, other clients,
commercial/private records and venue-wide timetables protected. Make the client
planner's navigation and schedule use this real contract, with polished loading,
empty, access-removed and error states. Verify current account/membership and
event-link revocation at the server boundary; an old token or stale UI must not
preserve authority after it is withdrawn.

Start from the verified current production source and preserve other owners'
work. Reproduce the failures before fixing them. Prefer existing qualified
event/configuration/variant relationships and explicit client response schemas
over granting clients broad existing operational responses. Use the source and
tests to select the precise association policy, recording consequential choices.
Do not invent a separate global role for each profession: document how client,
booker, sales, manager, hallkeeper, caterer and supplier actions map to current
scoped capabilities, and distinguish supported paths from later missing features.

Carry this bounded change through meaningful regression tests, real disposable
PostgreSQL and actual browser checks, independent review, coherent commits,
coordinated integration, production deployment and verification of the changed
live flow. This is implementation and delivery, not another planning-only goal.

## Required behavior and evidence

1. **Explicit authority and response contract.** State who may read the client
   event/schedule projection and why; who may edit/review/approve or read staff
   operations; what current identity/membership/link/ownership changes revoke
   access. Runtime-validate output and input. Include two venues, two clients,
   ordinary venue admin (platform role none), staff, hallkeeper and supplier
   boundaries. Keep existing authorized staff behavior working.
2. **Correct enquiry visibility.** A venue admin's inbox includes the legitimate
   same-venue submitted enquiry already accessible directly and to staff, while
   unrelated venue/client records stay excluded. Preserve pagination, filters
   and read/write boundaries.
3. **Usable client event journey.** A legitimately connected client can open their
   event schedule from their saved planner, see appropriately released/shared
   event timing and their layout, and return without role-denied dead links.
   An unlinked private plan has an intentional empty state. The current client
   403/unavailable room-timeline experience is replaced by real scoped behavior.
   Do not expose internal event/phase notes, raw operational snapshots, revenue,
   other clients' layouts or unrelated room bookings to achieve this.
4. **Revocation and hostile cases.** Prove unlinked/other-client/cross-venue access
   denied; archive/deletion and configuration-owner/link changes respected;
   management/current-membership changes fail closed as applicable. Exercise
   stale responses and identity switches in the browser boundary and real
   PostgreSQL authorization behavior. Synthetic identity tests must not be
   presented as real provider-authenticated evidence.
5. **Verification and delivery.** Run affected contracts/API/web tests and relevant
   lint/typecheck/build checks. Exercise actual rendered client and staff journeys
   against an owned API/disposable database; retain before/after failures and
   screenshots. Independently review the final source and permission evidence.
   Coordinate one release through T-601; if its owner remains unavailable and no
   competing deployment exists, follow the standing shipping contract from the
   isolated clean candidate. Verify web/API identities and the changed live flow.
6. **Durable closeout.** Update the F-03 execution record and T-611/session state;
   publish `docs/reports/event-access-and-client-schedule-2026-09-15.md` with the
   authority matrix, exact source, tests/browser/SQL receipts, deployment/live
   evidence and any remaining limits. Recommend the next bounded package without
   silently activating it.

## Boundaries

The baseline is web `91220e0` / API `7f2a701`, reconfirmed at 22:34 UTC on
14 September before starting. Recheck at integration. Preserve the frozen Goal14
worktree/evidence; use a new owned checkout, dependencies and disposable database.
T-605 owns its unfinished decision/commercial work and migration numbers0071/0072;
do not take those reservations or mix its dirty source into this release. A needed
migration must have a separately reconciled safe order; prefer a correct no-schema
slice when existing qualified relationships suffice.

Retain the selected design direction and shared Activity convention. Preserve
Hallkeeper, Diary, onboarding, inventory, furniture and planner behavior; do not
silently publish the pending Flow/capture union or renderer changes in this goal.
No external messages to customers/staff, account privilege changes, unrelated
production data writes, source-capture edits, CMS hold changes or paid compute.
Use existing authorized accounts and data for live verification; never impersonate
a client or weaken production auth to obtain a green check.

This goal does not implement general DMs/service requests, every commercial or
supplier workflow, whole-product redesign, reconstruction or mobile60fps. Those
remain in the full Friday programme. Completion requires the scoped behavior
delivered and verified live; a local pass or release handoff alone is insufficient.
