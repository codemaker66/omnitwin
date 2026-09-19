-- Release 1 data integrity: give the status and role columns a vocabulary,
-- widen the audience-role checks for the new roles, index the hot paths, and
-- mark seeded fixtures so they can never again be mistaken for real bookings.
--
-- Nothing here changes a row. The CHECK sections assert first and name the
-- offending values, so a migration that cannot apply says exactly why instead
-- of failing with "violates check constraint" on an unnamed row. The whole
-- file runs in one transaction, so a failed assertion leaves the schema as it
-- was.
--
-- Role vocabulary: client, planner, staff, hallkeeper, admin (existing) plus
-- caterer, sales and manager. The audience columns additionally carry
-- supplier and executive, which are audiences rather than user roles.

-- ---------------------------------------------------------------------------
-- 1. Assertions. Every CHECK below is only added once the data satisfies it.
-- ---------------------------------------------------------------------------
DO $assertions$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal("role"), ', ') INTO offending FROM "users"
    WHERE "role" NOT IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'USERS_ROLE_VOCABULARY: users.role holds unlisted values: %', offending
      USING ERRCODE = '23514',
        HINT = 'Correct or retire those accounts, or add the role to USER_ROLES and this migration together.';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("role"), ', ') INTO offending FROM "user_invitations"
    WHERE "role" NOT IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'USER_INVITATIONS_ROLE_VOCABULARY: user_invitations.role holds unlisted values: %', offending
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("state"), ', ') INTO offending FROM "configurations"
    WHERE "state" NOT IN ('draft', 'published');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIGURATIONS_STATE_VOCABULARY: configurations.state holds unlisted values: %', offending
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("review_status"), ', ') INTO offending FROM "configurations"
    WHERE "review_status" NOT IN ('draft', 'submitted', 'under_review', 'approved', 'rejected',
      'changes_requested', 'withdrawn', 'archived');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIGURATIONS_REVIEW_STATUS_VOCABULARY: configurations.review_status holds unlisted values: %', offending
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("visibility"), ', ') INTO offending FROM "configurations"
    WHERE "visibility" NOT IN ('private', 'staff', 'public');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIGURATIONS_VISIBILITY_VOCABULARY: configurations.visibility holds unlisted values: %', offending
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("layout_style"), ', ') INTO offending FROM "configurations"
    WHERE "layout_style" NOT IN ('ceremony', 'dinner-rounds', 'dinner-banquet', 'theatre', 'boardroom',
      'cabaret', 'cocktail', 'custom');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIGURATIONS_LAYOUT_STYLE_VOCABULARY: configurations.layout_style holds unlisted values: %', offending
      USING ERRCODE = '23514',
        HINT = 'The venue document''s classroom and U-shape arrangements are not in LAYOUT_STYLES yet.';
  END IF;

  SELECT string_agg(DISTINCT quote_literal("state"), ', ') INTO offending FROM "enquiries"
    WHERE "state" NOT IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'archived');
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'ENQUIRIES_STATE_VOCABULARY: enquiries.state holds unlisted values: %', offending
      USING ERRCODE = '23514';
  END IF;
END
$assertions$;

-- ---------------------------------------------------------------------------
-- 2. Status and role vocabularies
-- ---------------------------------------------------------------------------
DO $vocabulary$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check' AND conrelid = to_regclass('users')) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
      CHECK ("role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'configurations_state_check' AND conrelid = to_regclass('configurations')) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_state_check"
      CHECK ("state" IN ('draft', 'published'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'configurations_review_status_check' AND conrelid = to_regclass('configurations')) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_review_status_check"
      CHECK ("review_status" IN ('draft', 'submitted', 'under_review', 'approved', 'rejected',
        'changes_requested', 'withdrawn', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'configurations_visibility_check' AND conrelid = to_regclass('configurations')) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_visibility_check"
      CHECK ("visibility" IN ('private', 'staff', 'public'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'configurations_layout_style_check' AND conrelid = to_regclass('configurations')) THEN
    ALTER TABLE "configurations" ADD CONSTRAINT "configurations_layout_style_check"
      CHECK ("layout_style" IN ('ceremony', 'dinner-rounds', 'dinner-banquet', 'theatre', 'boardroom',
        'cabaret', 'cocktail', 'custom'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'enquiries_state_check' AND conrelid = to_regclass('enquiries')) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_state_check"
      CHECK ("state" IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'archived'));
  END IF;
END
$vocabulary$;

-- ---------------------------------------------------------------------------
-- 3. Audience-role widening (EVENT_PLAN_AUDIENCE_ROLES = USER_ROLES + supplier
--    + executive). Each constraint is dropped and re-added rather than
--    altered, because PostgreSQL has no ALTER CONSTRAINT for a CHECK body.
--    Re-adding revalidates the existing rows — but it fails with an anonymous
--    "violated by some row", which is the failure mode §1's named assertions
--    exist to replace, and `DROP CONSTRAINT IF EXISTS` makes it reachable: a
--    table that never had the constraint has unvalidated data. So every
--    audience column is asserted by name first, in the same shape as §1.
-- ---------------------------------------------------------------------------
DO $audience$
DECLARE
  widened constant text :=
    '''client'', ''planner'', ''staff'', ''hallkeeper'', ''admin'', ''caterer'', ''sales'', ''manager'', ''supplier'', ''executive''';
  target record;
  offending text;
BEGIN
  -- Pre-flight: name every stored audience role that the widened list would
  -- still reject, and stop before touching a single constraint.
  FOR target IN
    SELECT * FROM (VALUES
      ('event_plan_changes', 'event_plan_changes_actor_role_check', 'actor_role'),
      ('event_plan_notifications', 'event_plan_notifications_role_check', 'audience_role'),
      ('event_plan_change_acknowledgements', 'event_plan_change_ack_role_check', 'acknowledged_by_role'),
      ('event_mission_events', 'event_mission_events_actor_role_check', 'actor_role'),
      ('event_mission_acknowledgements', 'event_mission_ack_role_check', 'acknowledged_by_role'),
      ('event_mission_sessions', 'event_mission_sessions_role_check', 'role')
    ) AS checks(table_name, constraint_name, column_name) ORDER BY constraint_name
  LOOP
    IF to_regclass(quote_ident(target.table_name)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'SELECT string_agg(DISTINCT quote_literal(%I), '', '') FROM %I WHERE %I NOT IN (%s)',
      target.column_name, target.table_name, target.column_name, widened)
      INTO offending;
    IF offending IS NOT NULL THEN
      RAISE EXCEPTION 'AUDIENCE_ROLE_VOCABULARY: %.% holds unlisted values: %',
        target.table_name, target.column_name, offending
        USING ERRCODE = '23514',
          HINT = 'Correct those rows, or add the role to EVENT_PLAN_AUDIENCE_ROLES and this migration together.';
    END IF;
  END LOOP;

  -- The jsonb audience array is asserted the same way, element by element.
  IF to_regclass('event_plan_changes') IS NOT NULL THEN
    SELECT string_agg(DISTINCT quote_literal(role_value), ', ') INTO offending
      FROM "event_plan_changes",
        LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof("audience_roles") = 'array' THEN "audience_roles" ELSE '[]'::jsonb END
        ) AS element(role_value)
      WHERE role_value NOT IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer',
        'sales', 'manager', 'supplier', 'executive');
    IF offending IS NOT NULL THEN
      RAISE EXCEPTION 'AUDIENCE_ROLE_VOCABULARY: event_plan_changes.audience_roles holds unlisted values: %', offending
        USING ERRCODE = '23514';
    END IF;
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('event_plan_changes', 'event_plan_changes_actor_role_check', 'actor_role'),
      ('event_plan_notifications', 'event_plan_notifications_role_check', 'audience_role'),
      ('event_plan_change_acknowledgements', 'event_plan_change_ack_role_check', 'acknowledged_by_role'),
      ('event_mission_events', 'event_mission_events_actor_role_check', 'actor_role'),
      ('event_mission_acknowledgements', 'event_mission_ack_role_check', 'acknowledged_by_role'),
      ('event_mission_sessions', 'event_mission_sessions_role_check', 'role')
    ) AS checks(table_name, constraint_name, column_name) ORDER BY constraint_name
  LOOP
    IF to_regclass(quote_ident(target.table_name)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', target.table_name, target.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IN (%s))',
      target.table_name, target.constraint_name, target.column_name, widened);
  END LOOP;

  -- The jsonb audience array is a containment check, not an IN list.
  IF to_regclass('event_plan_changes') IS NOT NULL THEN
    ALTER TABLE "event_plan_changes" DROP CONSTRAINT IF EXISTS "event_plan_changes_audience_json_check";
    ALTER TABLE "event_plan_changes" ADD CONSTRAINT "event_plan_changes_audience_json_check"
      CHECK (
        jsonb_typeof("audience_roles") = 'array'
        AND jsonb_array_length("audience_roles") > 0
        AND "audience_roles" <@ '["client", "planner", "staff", "hallkeeper", "admin", "caterer", "sales", "manager", "supplier", "executive"]'::jsonb
      );
  END IF;

  IF to_regclass('user_invitations') IS NOT NULL THEN
    ALTER TABLE "user_invitations" DROP CONSTRAINT IF EXISTS "user_invitations_role_check";
    ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_role_check"
      CHECK ("role" IN ('client', 'planner', 'staff', 'hallkeeper', 'admin', 'caterer', 'sales', 'manager'));
  END IF;
END
$audience$;

-- ---------------------------------------------------------------------------
-- 4. Hot-path indexes. The diary reads events by venue and window on every
--    calendar paint; pricing reads live rules per space; the planner resolves
--    placements by catalogue item, which is also how 0073 finds out whether a
--    legacy asset row is still in use.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "events_venue_starts_idx" ON "events" ("venue_id", "starts_at");
CREATE INDEX IF NOT EXISTS "events_venue_ends_idx" ON "events" ("venue_id", "ends_at");
CREATE INDEX IF NOT EXISTS "pricing_rules_venue_space_live_idx" ON "pricing_rules" ("venue_id", "space_id")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "placed_objects_asset_definition_idx" ON "placed_objects" ("asset_definition_id");

-- ---------------------------------------------------------------------------
-- 5. Seed fixture marker.
--
--    seed.ts writes a believable demo week — the Mackenzie-Ross wedding, the
--    MacLeod and Kerr holds, the Sinclair anniversary. Those titles have been
--    indistinguishable from real ink, so the only way to identify a fixture
--    has been to match its name, which would also match a real booking that
--    happened to be a Kerr wedding. From now on every fixture row carries its
--    origin and nothing else does.
--
--    Nullable and unconstrained by design: a real booking has no fixture
--    source, and this must never become a second status column. The partial
--    indexes exist so "find every fixture" stays a cheap, exact query.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "fixture_source" varchar(40);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "fixture_source" varchar(40);
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "fixture_source" varchar(40);

CREATE INDEX IF NOT EXISTS "bookings_fixture_source_idx" ON "bookings" ("fixture_source")
  WHERE "fixture_source" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "events_fixture_source_idx" ON "events" ("fixture_source")
  WHERE "fixture_source" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "enquiries_fixture_source_idx" ON "enquiries" ("fixture_source")
  WHERE "fixture_source" IS NOT NULL;
