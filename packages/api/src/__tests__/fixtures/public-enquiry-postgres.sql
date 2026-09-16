-- Synthetic base tables for the public-enquiry PostgreSQL integration fixture.
--
-- Only the tables POST /public/enquiries touches on its venue-slug path, with
-- the columns that path actually reads or writes: the route SELECTs named
-- columns from venues/spaces/users, but `db.select().from(guestLeads)` and
-- `db.insert(enquiries).returning()` project the whole drizzle model, so those
-- two carry every column. This does not run the application seed and does not
-- claim to qualify the historical migration chain — it exists so the 201 is a
-- real INSERT against real NOT NULL and FK constraints rather than a mock.
CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  slug varchar(100) NOT NULL UNIQUE,
  address varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text UNIQUE,
  email varchar(255) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  role varchar(30) NOT NULL,
  venue_id uuid REFERENCES venues(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  name varchar(200) NOT NULL,
  slug varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (venue_id, slug)
);

-- Never read on the venue-slug path, but `enquiries.configuration_id` points
-- at it, so the foreign key needs a table to reference.
CREATE TABLE configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id),
  is_public_preview boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  configuration_id uuid REFERENCES configurations(id),
  user_id uuid REFERENCES users(id),
  guest_email text,
  guest_phone text,
  guest_name text,
  state varchar(20) NOT NULL DEFAULT 'draft',
  name varchar(200) NOT NULL,
  email varchar(255) NOT NULL,
  preferred_date date,
  event_type varchar(100),
  estimated_guests integer,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enquiry_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  from_status varchar(20) NOT NULL,
  to_status varchar(20) NOT NULL,
  changed_by uuid REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  phone text,
  name text,
  first_enquiry_id uuid,
  converted_to_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
