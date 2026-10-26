-- Synthetic base tables for the public-enquiry PostgreSQL integration fixture.
--
-- Only the tables POST /public/enquiries touches on its venue-slug path, with
-- the columns that path actually reads or writes: the route SELECTs named
-- columns from venues/spaces/users, but `db.insert(enquiries).returning()`
-- projects the whole drizzle model, so enquiries carries every column. The
-- People Book's tables (0098), which the enquiry finds or makes its person
-- in, carry every column the drizzle model declares and the keys 0098 gives
-- them: lockPerson selects a whole contacts row. This does not run the
-- application seed and does not claim to qualify the historical migration
-- chain — it exists so the 201 is a real INSERT against real NOT NULL and FK
-- constraints rather than a mock.
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 0073: seed-fixture marker and the state vocabulary, as schema.ts declares.
  fixture_source varchar(40),
  -- 0079: how the enquiry arrived, and whether the guest chose its room.
  source varchar(20),
  room_chosen boolean NOT NULL DEFAULT true,
  -- 0098: the person the enquiry came from; its key is added once contacts exists.
  contact_id uuid,
  -- 0100: the first reply, and where the person found the venue.
  first_response_at timestamptz,
  first_response_by uuid,
  first_response_channel varchar(20),
  first_response_recorded_at timestamptz,
  referrer_host varchar(253),
  utm_source varchar(100),
  utm_medium varchar(100),
  utm_campaign varchar(100),
  acquisition_channel varchar(20),
  CONSTRAINT enquiries_state_check CHECK (state IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'archived')),
  CONSTRAINT enquiries_source_check CHECK (source IS NULL OR source IN ('website', 'walkthrough', 'planner', 'phone', 'email', 'listing', 'assistant'))
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

-- The People Book (0098). client_accounts and contacts point at each other,
-- so each key across them is added once both exist.
CREATE TABLE client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  name varchar(200) NOT NULL,
  account_type varchar(60) NOT NULL DEFAULT 'event_client',
  primary_contact_id uuid,
  source_enquiry_id uuid REFERENCES enquiries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  kind varchar(20) NOT NULL DEFAULT 'household',
  address text,
  website varchar(255),
  vat_number varchar(40),
  notes text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_system varchar(40),
  source_id varchar(255),
  merged_into_id uuid REFERENCES client_accounts(id) ON DELETE RESTRICT,
  CONSTRAINT client_accounts_id_venue_unique UNIQUE (id, venue_id),
  CONSTRAINT client_accounts_source_pair_check CHECK ((source_system IS NULL) = (source_id IS NULL)),
  CONSTRAINT client_accounts_not_merged_into_self CHECK (merged_into_id <> id),
  CONSTRAINT client_accounts_kind_check CHECK (kind IN ('organisation', 'household'))
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  client_account_id uuid REFERENCES client_accounts(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  email varchar(255),
  phone varchar(50),
  role_label varchar(120),
  source_enquiry_id uuid REFERENCES enquiries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  given_name varchar(100),
  family_name varchar(100),
  job_title varchar(120),
  postal_address text,
  notes text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  last_contact_at timestamptz,
  source_system varchar(40),
  source_id varchar(255),
  merged_into_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  erased_at timestamptz,
  CONSTRAINT contacts_id_venue_unique UNIQUE (id, venue_id),
  CONSTRAINT contacts_source_pair_check CHECK ((source_system IS NULL) = (source_id IS NULL)),
  CONSTRAINT contacts_not_merged_into_self CHECK (merged_into_id <> id),
  CONSTRAINT contacts_email_not_blank CHECK (email IS NULL OR email ~ '[^[:space:]]')
);

ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_primary_contact_fk
  FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE enquiries ADD CONSTRAINT enquiries_contact_fk
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TABLE contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  contact_id uuid NOT NULL,
  kind varchar(10) NOT NULL,
  value varchar(255) NOT NULL,
  display_value varchar(255) NOT NULL,
  label varchar(20) NOT NULL DEFAULT 'other',
  is_primary boolean NOT NULL DEFAULT false,
  source_system varchar(40),
  source_id varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_points_contact_venue_fk FOREIGN KEY (contact_id, venue_id)
    REFERENCES contacts(id, venue_id) ON DELETE CASCADE,
  CONSTRAINT contact_points_kind_check CHECK (kind IN ('email', 'phone')),
  CONSTRAINT contact_points_label_check CHECK (label IN ('work', 'personal', 'mobile', 'other')),
  CONSTRAINT contact_points_value_check CHECK (value <> '' AND display_value <> ''),
  CONSTRAINT contact_points_source_pair_check CHECK ((source_system IS NULL) = (source_id IS NULL)),
  CONSTRAINT contact_points_contact_kind_value_unique UNIQUE (contact_id, kind, value)
);
CREATE UNIQUE INDEX contact_points_one_primary_unique ON contact_points (contact_id, kind) WHERE is_primary;

CREATE TABLE account_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  contact_id uuid NOT NULL,
  client_account_id uuid NOT NULL,
  role_label varchar(120),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_memberships_contact_venue_fk FOREIGN KEY (contact_id, venue_id)
    REFERENCES contacts(id, venue_id) ON DELETE CASCADE,
  CONSTRAINT account_memberships_account_venue_fk FOREIGN KEY (client_account_id, venue_id)
    REFERENCES client_accounts(id, venue_id) ON DELETE CASCADE,
  CONSTRAINT account_memberships_pair_unique UNIQUE (contact_id, client_account_id)
);
CREATE UNIQUE INDEX account_memberships_one_primary_unique ON account_memberships (contact_id) WHERE is_primary;
