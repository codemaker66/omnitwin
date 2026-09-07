-- Customer venue administration is separate from users.platform_role.
-- No existing account or venue grants are changed by this migration.
ALTER TABLE "workspace_memberships" DROP CONSTRAINT "workspace_memberships_venue_role_check";
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_venue_role_check"
  CHECK ("venue_role" IN ('admin', 'staff', 'hallkeeper', 'planner', 'client'));

ALTER TABLE "onboarding_audit_events" DROP CONSTRAINT "onboarding_audit_events_type_check";
ALTER TABLE "onboarding_audit_events" ADD CONSTRAINT "onboarding_audit_events_type_check"
  CHECK ("event_type" IN ('workspace_created', 'owner_invited', 'staff_invited', 'entitlement_recorded', 'provider_verification_updated', 'operator_review_updated', 'member_access_accepted', 'invitation_revoked'));
