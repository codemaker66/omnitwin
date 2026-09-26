-- Workspace memberships take the widened role vocabulary.
--
-- Onboarding invites every venue role (VENUE_INVITATION_ROLES is USER_ROLES,
-- and WORKSPACE_MEMBER_ROLES is "owner" plus USER_ROLES), and a membership
-- stores both roles under their own CHECKs. 0073 widened users.role and
-- user_invitations.role for caterer, sales and manager, but these two still
-- held 0037/0070's lists, so an invitation the onboarding form offers was
-- refused by PostgreSQL and answered as a server error.
--
-- Nothing here changes a row. The stored values are asserted first and named
-- if any would still be refused, so a migration that cannot apply says why;
-- the file runs in the migration transaction, so a failed assertion or lock
-- wait leaves the schema as it was.

-- The table is small and rarely written, but DROP/ADD CONSTRAINT takes an
-- ACCESS EXCLUSIVE lock held until the migration transaction commits. A
-- bounded wait fails the migration instead of queueing requests behind it.
SET LOCAL lock_timeout = '5s';

DO $workspace_roles$
DECLARE
  offending text;
BEGIN
  IF to_regclass('workspace_memberships') IS NULL THEN
    RAISE NOTICE 'workspace role vocabulary: no workspace_memberships table, nothing to do';
    RETURN;
  END IF;

  SELECT string_agg(DISTINCT quote_literal("venue_role"), ', ') INTO offending FROM "workspace_memberships"
    WHERE "venue_role" NOT IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'WORKSPACE_MEMBERSHIPS_VENUE_ROLE_VOCABULARY: workspace_memberships.venue_role holds unlisted values: %', offending
      USING ERRCODE = '23514',
        HINT = 'Correct those memberships, or add the role to USER_ROLES and this migration together.';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("role"), ', ') INTO offending FROM "workspace_memberships"
    WHERE "role" NOT IN ('owner', 'client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'WORKSPACE_MEMBERSHIPS_ROLE_VOCABULARY: workspace_memberships.role holds unlisted values: %', offending
      USING ERRCODE = '23514',
        HINT = 'Correct those memberships, or add the role to WORKSPACE_MEMBER_ROLES and this migration together.';
  END IF;

  ALTER TABLE "workspace_memberships" DROP CONSTRAINT IF EXISTS "workspace_memberships_venue_role_check";
  ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_venue_role_check"
    CHECK ("venue_role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager'));

  ALTER TABLE "workspace_memberships" DROP CONSTRAINT IF EXISTS "workspace_memberships_role_check";
  ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_role_check"
    CHECK ("role" IN ('owner', 'client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager'));
END
$workspace_roles$;
