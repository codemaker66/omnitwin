# Hallkeeper live verification — 7 September 2026

The requested Hallkeeper UI and presentation walkthrough are published on venviewer.com and were checked through the normal signed-in founder account in Brave. No authentication bypass or production fixture interception was used.

## Published identity

- Web source: `7f2a701b4dade7d9d6048a82511ffa83cf4ff821`.
- Coordinated production publication: 18:43:44 UTC, Vercel success receipt `6314446074`, deployment `https://omnitwin-h7bhil4b8-codemaker66s-projects.vercel.app`.
- Public entry asset reported by the release executor: `/assets/index-MYrlSuOu.js`.
- Hallkeeper changes include `ecfb449d`, the house-block label correction `5106777c`, strict lint correction `7a32014c`, and per-sheet offline drain `4aea6143` (integrated as `cf375851`).
- The API was already healthy at compatible source `cedda2d7`; the release executor owns the subsequent matching API publication and provider receipts.

The earlier coordinated run was interrupted before web publication. The original presentation window was missed; source push alone was not reported as delivery. Live verification below followed the actual web publication.

## Actual production browser checks

Checks completed between approximately 18:45 and 18:51 UTC using normal founder access:

- `/hallkeeper` redirects to `/hallkeeper/today`; Hallkeeper appears in the primary staff navigation and the account displays Platform admin.
- The Day Board displays four real rooms and three active bookings for 7 September, with Live updates, room filtering and an accessible link to the walkthrough. Grand Hall filtering and restoration to All rooms work. No prepared event was visible in the current active-booking projection, so Day Board-to-prepared-event navigation is not claimed.
- The prepared event `fa64096b-4bbe-4d76-87a8-2b938343d863` displays Your working documents. Both new links were clicked: the current sheet opens configuration `3b18bfc3-4a40-4723-8130-13134c80e16e`, and version 1 handoff opens pack `b57fda8d-4dfb-4f85-a1ee-0a0b953096f5`.
- The redesigned sheet visibly preserves approval version 1, the saved floor plan's 162 furniture footprints, 288 manifest items and 43 checklist rows. Its supplied guest count is zero; indicative times are Not provided. The warm two-column layout, category strip and practical-details panel render.
- Furniture category collapse and reopening via its category link work. All 43 shared checks remain unchecked; no checklist or operational records were changed.
- Download PDF shows the active preparing state, then PDF download started after the request succeeds. The downloaded document was not separately parsed during this live pass.
- The handoff renders the compiled approved snapshot v1, 288 items, 53 tasks, pick list, supplier notes and internal BEO; it remains distinct from shared setup progress.
- The walkthrough visibly states that it is fictional and resets when leaving. Its isolated iframe renders all six labelled event stages. Selecting Setup displays the room-kit work. Handover opens the three-room summary; simulated Maya cover acceptance changes the demo to accepted. Restart returns to Today and cover still needing acceptance.

Live screenshots and accessibility evidence are retained in the task's browser tool transcript. Presentation tabs are the real Day Board, approved sheet and fictional walkthrough. UI actions in the walkthrough are simulated; the real sheet's checks save shared progress and were left untouched.

## Qualification and limits

The release executor reports 934 passing web tests across 65 files plus full types, build and Linux lint/types/build/audit checks on the combined candidate. Source-stability receipts are under `D:/claude/venviewer-presentation-readiness-20260907/gates/7f2a701-*`; publication identity is in `published-source-7f2a701.json`. Earlier failed lint/type/test attempts remain preserved in that release evidence.

The isolated Hallkeeper queue regression passed with 4/4 page tests and focused ESLint. It checks that navigating A to B while A's replay is pending does not hide or prevent B's drain. Earlier local browser fixtures exercised calendar date refetch, room filtering, event links, checkbox PATCH/reload and 390-pixel mobile layout. Those mocked API checks do not prove live database writes or multi-device sync. The live pass above is read-only for venue data; mobile layout was visually checked locally, not on a physical phone.

The real sheet and Day Board are operational surfaces. The complete care, break-cover, change-management and handback workflow is still a clearly labelled interactive design demonstration. This delivery does not claim those simulated actions persist backend records, nor does technical verification establish founder aesthetic acceptance.

See [presentation route](presentation-route.md) for direct links and a concise demonstration sequence.
