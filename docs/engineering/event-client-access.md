# Client event access

Implementation decision for Goal15/F03, 15 September 2026. This narrows an internal-event creator bypass and adds a separate customer planning projection. It does not change the venue-as-tenant model or introduce a new membership system.

## Current authority

The production authentication bridge resolves the verified Clerk identity to the current `users` row on each HTTP request. Its `role`, `venueId` and `platformRole` are the current v1 authority. Workspace membership records remain an onboarding shell; cancelling a pending invitation does not revoke an accepted account. This change does not claim to implement an accepted-membership removal interface.

`client` and `planner` are equivalent customer roles. Neither receives venue-wide Diary, room timelines, internal event plans, operations, mission control or revenue data simply because it created an event. Current venue staff, hallkeepers and admins retain the operational authority already defined by `canManageVenue`; platform administration remains explicit. Configuration ownership continues to govern ordinary saved-layout operations and standalone configuration handoff packs. An event-bound handoff also requires current internal-event authority.

## Customer planning projection

`GET /events/:eventId/client-schedule` accepts an optional UUID `configurationId`. It returns strict, runtime-validated event identity and headline dates/count, venue name and timezone, phase names/times/durations/rooms, and the caller's eligible saved layout identifiers/names/rooms. The schedule is explicitly a **working plan**. A link does not establish approval, publication, safety clearance or a confirmed booking.

A customer must currently own an active, non-preview configuration associated with the active event in the same active venue and room. Valid live link types are `source_configuration`, `variant_configuration` and `approved_snapshot_source`. A variant reference must point to the same event/configuration and be non-archived; a `variant_configuration` link without its variant grants nothing. A current `source_configuration` or `approved_snapshot_source` row without a variant is an explicit association. Historical snapshot records on their own grant no access. Public or staff sharing does not remove the owner's separate relationship and does not grant event access to viewers.

The server selects only the projection's columns. It excludes staff notes, client contact labels, raw snapshots, layout metadata, assumptions, revenue, operational counters, other clients' layouts and venue-wide bookings. Phase rows with invalid, foreign-venue or deleted room references are withheld. Unknown phase times and unassigned rooms remain explicit unknowns.

The service re-reads the current user and resolves authority, relationships and output within one read-only repeatable-read transaction. A read already admitted to its snapshot can finish after a concurrent revocation commits; a subsequent read must see that revocation. Removing the current relationship, changing ownership/role/venue, deleting the account/configuration/room/event/venue or archiving its referenced variant is tested at the owning database boundary. Responses use `Cache-Control: private, no-store`; absent and unauthorized relationships both return generic404.

## Browser boundary

The client schedule request and render state are bound to the current account, role, platform role, venue, event and selected configuration. Changing that identity or selection immediately hides the prior response; cancelled or late responses cannot restore it. Customer planner surfaces use this projection and link to `/events/:eventId`, which lists eligible saved layouts. They do not mount staff Diary/timeline requests. Their captured room fallback does not call the platform-admin runtime registry.

An omitted configuration binding is permitted for the event page. An explicitly null binding in the planner means the selected configuration is unresolved and must not fall back to an event-only read. Internal event readers and the Booking time disclosure also require resolved, authenticated operational authority; loading, signed-out and unknown-role states fail closed while explicit platform-admin access remains supported.

The UI formats actual timestamps in the venue timezone, including dates across midnight, and labels untimed phases without inventing times. Loading uses the shared Activity convention; denied, empty, retry and sign-in states have explicit actions.

## Deliberate limits and neighboring work

This contract provides read access through existing live configuration associations; it adds no customer invitation, role promotion, direct-message, unlink-management or approved client-publication workflow. Those require their own lifecycle design and delivery evidence.

Event notifications now require an active matching event/venue and current internal-event authority, including when historically addressed to a specific recipient. Audience/recipient, event authority and read status are filtered in SQL before pagination. Marking read uses the same event scope and a unique database upsert; concurrent requests produce one read marker. Notifications without an event retain their existing personal-recipient semantics. This does not introduce a general message-revocation or reconnect protocol.

Venue analytics and Event Architect now reject both customer role names. Hallkeeper analytics reads remain consistent with their existing commercial reads; revenue scenario writes remain staff/platform plus venue admin, without promoting hallkeepers. Unrelated integrations management still has an older planner permission and needs a separate capability review. This bounded event slice is not a claim that every platform permission has been audited.

The minimal `use-room-runtime-splat` authority guard overlaps the pending, undeployed Flow/recovery branch. Future integration must preserve that branch's renderer/runtime behavior and this caller-privilege guard. T605's dirty event/commercial work and reserved migrations0071/0072 were not incorporated. This change requires no database migration.

The required `test:event-access-db` gate runs the projection and event-capability PostgreSQL suites serially against an explicitly validated disposable target. It verifies the complete checkout migration hash/timestamp journal and unchanged replay, and rejects skipped or incomplete results. General API test runs may skip optional database suites; that output is separate from this required gate. See the [delivery evidence and limits](../reports/event-access-and-client-schedule-2026-09-15.md).
