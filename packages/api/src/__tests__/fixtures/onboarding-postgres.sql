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
