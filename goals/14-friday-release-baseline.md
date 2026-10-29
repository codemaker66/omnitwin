# Goal 14 — Establish the Friday release baseline

Requested by Blake on 14 September 2026 as the first execution goal of the
[public-release programme](../docs/plan/18-FRIDAY-LAUNCH-2026-09-18.md).
Task: T-610. Primary package: F-01; prepares F-02 and F-09.
Status: **completed in this Codex task on 14 September 2026**.
Evidence: [baseline report](../docs/reports/friday-release-baseline-2026-09-15.md)
and [23-package register](../docs/reports/friday-release-package-register-2026-09-15.md).
Independent material review and full isolated stop/start reproduction passed.
This closes the baseline only; later implementation goals are not activated.

## Outcome

Give Venviewer one verified account of what is deployed, what qualified work is
waiting to be integrated, and an isolated runnable release candidate on which the
next implementation goals can safely build. Produce actual browser/API/database
evidence and a reproducible furnished-scene fixture. Turn the Friday plan into an
executable backlog tied to real source and observed gaps.

This is the first milestone toward the full public product. Its completion does
not certify the whole platform, physical-mobile 60fps, room reconstruction or
Blake's aesthetic acceptance.

## Required work

1. **Reconcile production and ownership.** Verify actual web and API source/build
   identities, applied migration journal and relevant room/furniture manifest or
   asset hashes using current provider/runtime evidence. Compare these with
   `3b1d3389`, `7f2a701`, the shared checkout and owners' pending work. Record
   integrated, deployed and locally qualified work separately. Confirm current
   release execution and preserve T-605's migration reservations. Do not treat
   an old task note or a clean git status as a production receipt.
2. **Prepare an isolated runnable candidate.** Use a task-owned checkout and
   dependencies, explicit disposable PostgreSQL, declared runtime/configuration
   and repeatable start/test commands. Select source through the reconciled
   release/owner evidence. Preserve every other task's edits and modules. Never
   use the ambient production database for fixtures or destructive tests.
3. **Exercise the existing connected event.** Use isolated test identities and
   real API/PostgreSQL to inspect enquiry/booking/layout/approval/operations
   handoffs. At minimum, run an actual browser furniture edit, save and reopen
   against the real API/database and verify object identities/counts/transforms.
   Identify exact missing or failing steps with reproducible evidence. Trace the
   different role paths and permissions; do not implement all missing messaging
   and domain features merely to make this baseline green. Distinguish local
   test authentication from real provider-authenticated evidence.
4. **Freeze the spatial qualification fixture.** Prepare a reproducible
   18-table/144-chair banquet using actual catalogue model/material/dressing
   assets, plus a declared camera/interaction route. Record source/build, room and
   model hashes, object counts and measurement settings. Inventory available
   physical phones/tablets and record an initial measurement on available
   hardware with its exact identity. Keep physical mobile qualification open
   when that hardware is unavailable; emulation is not a substitute. Test counts
   are not venue capacity claims.
5. **Publish the executable next work.** Produce one evidence register with each
   required F-package's owner or explicitly unassigned role, dependency, current
   source, observed failure/unknown, next action and realistic forecast. Identify
   the next bounded implementation goal from the observed critical path. Retain
   monitoring/recovery, communication, all-role workflows, complete design,
   reconstruction and device gates; do not silently shrink the Friday target.

## Completion evidence

- A timestamped release receipt verifies web/API/schema and the asset set used
  for the baseline. Any missing required production identity is an unresolved
  requirement, not an inferred pass.
- A clean task-owned checkout can start the isolated stack using documented
  commands and passes basic connectivity/authentication checks; necessary setup
  repairs receive proportionate verification.
- A retained browser/API/PostgreSQL result demonstrates the minimum furniture
  edit/save/reopen path, including exact state before and after reopening.
- The furnished fixture, its provenance, camera route and available-hardware
  measurement are reproducible, recording device/browser, rendering settings,
  duration and frame-time results; unavailable physical devices are named
  dependencies for F-09.
- The baseline report distinguishes passed, failed and unverified capabilities,
  links the evidence, and names the next implementation package. Task/session
  records are current and an independent review finds no unresolved material
  contradiction between the report and its evidence.

The first feasibility checkpoint is Tuesday 15 September at 11:00 BST. It is a
planning target, not permission to skip evidence or declare completion early.
Report a missed checkpoint plainly and continue the authorised work.

## Execution boundaries

Follow AGENTS.md, the latest founder direction and the delivery contract. Use
bounded subagents for independent investigation/review while progressing locally.
Reconcile useful existing work before rebuilding it. Keep application source
frozen during its verification. Necessary reversible baseline/tooling repairs
are included when required to run the baseline; larger repairs become explicit
next packages. Any necessary product fix follows normal integration, deployment
and live-verification requirements through the release owner.

Preserve tenancy, approval, provenance, retention and source masters. Do not
create production fixtures, send external messages, change account privileges,
lift the separate CMS planning-link hold or start paid compute from this goal.
Existing reconstruction work and allowances retain their owners and limits.
Do not start another Codex task or activate the later goals automatically.

## Deliverables

- `docs/reports/friday-release-baseline-2026-09-15.md`: release receipt, runnable
  setup, executed results, evidence links and current constraints.
- A task-owned reproducible fixture/harness and evidence directory, with its
  location and safe reset procedure recorded in that report.
- Updated F-package execution register, T-610 and session notes; a concrete next
  goal recommendation based on findings.
