# Event-linked planner bootstrap — 6 September 2026

Local source fix, independently reviewed and verified with component/store tests. Integration and the real browser corridor remain the coordinating agent's next check; this is not a production deployment or visual acceptance.

The diary's “Open the plan” route, `/plan?eventId=…&space=grand-hall`, previously entered generic public-draft bootstrap. It could create a draft or reuse an unrelated browser-local draft instead of reopening this event's saved layouts.

## Result

- Event entry waits for authentication, fetches the actual event graph and venue rooms, and checks every candidate through the authenticated configuration API. It validates event, configuration, venue and actual room identity.
- One accessible layout opens directly. Multiple layouts show their actual saved names and rooms. No match offers event operations and a retry; it does not create or substitute a public draft.
- Explicit configuration links and non-archived variants remain independent event references. Snapshot-only candidates retain the live phase-to-room association, so a moved phase cannot reopen its former room's layout through old snapshot provenance. Candidate selection is not a claim that timeline proof or suitability has been revalidated.
- An explicit missing room or mismatched venue fails closed. Explicit 403/404 responses exclude inaccessible layouts; transient failures block selection of an incomplete candidate set.
- Route, account and unmount changes withdraw outstanding results. Generic bootstrap also withdraws stale lookups and creation settlement. If the server already created a generic draft before entry changed, its browser recovery entry remains available while its stale completion cannot replace or navigate the active event entry. A creation that still owns the route navigates normally after its own store settlement.
- Original query parameters survive navigation. The new working state consumes the shared `ActivityStatus` component. Generic `/plan` creation and reuse remain covered.

## Verification

The initial event regressions produced 7 failures while all 10 existing generic tests passed. Review corrections exposed five generic create-to-route failures; these were fixed by distinguishing a creation's own successful store settlement from a superseding route or account. Both failed receipts are retained.

Final verification: **115/115 tests passed** across routing, cockpit integration, venue resolution, linked-event behavior, request ownership, editor state and recorder reset. Web and E2E TypeScript, changed-file ESLint, `git diff --check`, and the Vite test-mode build passed. Independent source review found no remaining material finding. Tests use controlled API responses and do not establish live authentication or database behavior.

Receipts are retained under `D:/claude/venviewer-save-lifecycle-20260906/`: `event-bootstrap-baseline-red.json`, `event-bootstrap-review-corrections.json`, `event-bootstrap-final-tests.json`, `event-bootstrap-typecheck-final.log`, `event-bootstrap-e2e-typecheck.log`, `event-bootstrap-lint-final.log`, and `event-bootstrap-build.log`.

## Browser handoff and scope

After integrating this commit and its preceding save-lifecycle commit, exercise the existing isolated fixture route `/plan?eventId=4e179764-8468-40ff-ae97-ca804ed06df6&space=grand-hall`. The prepared graph has dinner, ceremony, dancing and breakdown configuration links; the browser must show real named choices and issue no public-draft creation request. Open a choice, verify the matching persisted objects and query, then return through the diary corridor. Root owns that browser qualification and shared session/task records.

The existing authenticated `POST /events/:id/layout-variants` contract can link an accessible same-venue configuration, but this repair adds no creation/linking transaction. It changes no API, fixture, booking, approval, message or production record. The isolated worktree and checks use installed dependencies without installing or mutating shared packages.
