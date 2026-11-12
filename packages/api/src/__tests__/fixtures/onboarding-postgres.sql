-- Synthetic base tables for the onboarding PostgreSQL integration fixture.
-- Onboarding/invitation tables and their CHECK/FK/unique constraints are created
-- by the real migrations. This deliberately does not run the application seed
-- or claim to qualify the entire historical migration chain.
CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  slug varchar(100) NOT NULL UNIQUE,
  address varchar(500) NOT NULL,
  logo_url text,
  brand_colour varchar(7),
  timezone varchar(100) NOT NULL DEFAULT 'Europe/London',
  subscription_status varchar(30) NOT NULL DEFAULT 'none',
  plan_tier varchar(30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text UNIQUE,
  email varchar(255) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  display_name text,
  phone text,
  organization_name text,
  role varchar(20) NOT NULL,
  venue_id uuid REFERENCES venues(id),
  username varchar(30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- As migration 0028 declares it. Every sign-in reads it: a Clerk account the
-- user.deleted webhook recorded here never links a row again (middleware/auth.ts,
-- clerkAccountDeleted).
CREATE TABLE general_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action varchar(120) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id varchar(160) NOT NULL,
  summary text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT general_audit_log_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT general_audit_log_summary_nonempty CHECK (length(trim(summary)) > 0)
);
