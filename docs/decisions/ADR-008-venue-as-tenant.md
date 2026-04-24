# ADR-008 — Venue is the tenant unit; no separate Tenant entity
Status: Accepted. Date: 2026-04-23.

The existing codebase's multi-tenant architecture uses `venues` as
the unit of tenancy. Every user-data table has a `venue_id` foreign
key; routes scope access via `canManageVenue()` /
`canAccessResource()`. No separate `Tenant` entity exists, and none
is required for v1.

Why:
- Venues ARE the tenant unit in venue-planning software; adding a
  `Tenant` layer above `Venue` would be over-engineering
- The existing architecture (confirmed by reading all route files
  2026-04-23) is already venue-scoped multi-tenant; the README's
  "single-tenant" wording is misleading, not an architectural
  limitation
- Sub-tenant hierarchy (Aman Group → Aman Venice → Aman Tokyo) is
  deferred until a real customer requires it
- Cross-venue subcontractor access (Trades Hall invites Regis
  Catering) is a separate concern, handled by a future
  `SubcontractorAccess` table, not by adding a tenant layer

Consequences:
- README must be updated to remove "single-tenant" framing
  (tracked: separate commit, future work)
- No schema refactor required for multi-tenancy; the architecture
  is sound
- Future multi-property chains (Aman with multiple venues) are
  modelled by one Aman user having staff/hallkeeper role on multiple
  venues; when a true hierarchy is needed, add `Tenant` table above
  `Venue` then
- Subcontractor cross-venue access is a future `SubcontractorAccess`
  table, not a tenant-layer concern

Supersedes: Path X / Path Y / Path Y+ multi-tenancy proposals from
conversations prior to reading the actual codebase (2026-04-23
clarification).
