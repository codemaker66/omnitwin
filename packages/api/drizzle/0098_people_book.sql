-- ---------------------------------------------------------------------------
-- 0098 — the People Book's records (T-665, slice 1)
--
-- One venue-scoped record per client person and per organisation or
-- household. A person keeps several emails and phones (contact_points) and
-- belongs to organisations (account_memberships); two people a person has
-- looked at can be kept apart (contact_kept_apart); a merge records what it
-- moved so that it can be undone (record_merges). contacts.email, .phone and
-- .client_account_id stay as mirrors of the primary email, phone and
-- membership, so the previous API and every reader of them keep working.
--
-- In order, in one transaction (the migrator runs the file as one; a lock
-- that cannot be had within five seconds fails it and nothing changes):
--
--   1. Every reader and writer of client accounts, enquiries and contacts
--      waits until it is done: the three are locked up front in ACCESS
--      EXCLUSIVE mode, in the order the API's own transactions take them.
--      That shared order is what keeps the file and the API from waiting on
--      each other for the three. The file can still wait while it holds
--      them: the new tables' foreign keys take SHARE ROW EXCLUSIVE locks on
--      users and venues after the upfront LOCK TABLE. Should one of those
--      meet a transaction that holds users or venues and waits for the
--      three, deadlock detection or the five-second lock limit ends the
--      file: the deploy fails, nothing changes, and it can be run again.
--   2. people_trim, people_normalise_email, people_normalise_phone,
--      people_usable_phone and people_name_key: the normalisers and the
--      usable-phone rule of @omnitwin/types in SQL. The backfill uses all
--      five; every live write normalises in TypeScript. people_name_key, and
--      people_trim, which it calls, are also read at runtime: the duplicate
--      suggestions (services/people-duplicates.ts) compare names with
--      people_name_key on every profile read. Those two are kept for that
--      and must not be dropped. A phone is usable when it normalises and has
--      6 to 15 digits (isUsablePhone); the backfill makes no point the API
--      would refuse.
--   3. contacts: email becomes optional; name parts, job title, address,
--      notes, owner, last contact, source, merge and erasure columns; the key
--      (id, venue_id) that the new tables point at, so nothing of one venue
--      can name a person of another.
--   4. client_accounts: kind, address, website, VAT number, notes, owner,
--      source and merge columns, and the same key.
--   5. contact_points, 6. account_memberships, 7. record_merges and
--   8. contact_kept_apart, each in its person's venue.
--   9. enquiries.contact_id: the person an enquiry came from.
--  10. The backfill, deterministic and never by guesswork:
--      a. contacts.email and .phone lose surrounding spaces; a blank email is
--         none, and so is a phone that is not usable ("+44", "TBC", five
--         digits), so the mirror never holds a phone with no point. The
--         enquiries keep the phone as it was typed. From then on a rule
--         (contacts_email_not_blank) refuses any email of spaces alone.
--      b. Each contact's email and usable phone become its primary points.
--      c. A contact's client_account_id that names an account that is not
--         live (deleted or merged) or not at the contact's venue is cleared,
--         as refreshContactMirror would clear it on the person's next write;
--         the account row and its deals keep their own links. Then each
--         contact becomes the primary member of its account, which is live
--         and in its own venue.
--      d. An account named after its primary contact is a household; every
--         other account is an organisation.
--      e. A converted enquiry links to the contact made from it.
--      f. An enquirer whom no live person holds gets one person per venue and
--         email, made from that venue's own enquiries: the latest name, email
--         and usable phone, the first enquiry as its source and its date, and
--         the latest as its last contact (h's rule: g links it those enquiries
--         and no others, and it has no deal yet).
--         Only the venue's clients' enquiries count, in f and in g: seed
--         fixtures, signed-in drafts never sent, the workspace gate's access
--         requests ('venue-access') and Venviewer's own pricing leads
--         ('venue-enquiry') are left out. So is an "email" longer than the
--         column holds (no real address is), so no email is cut short; a
--         name longer than its 200 characters is still cut to them.
--      g. Every other client enquiry links to the one live person who holds
--         its email. Where two people share it (today's duplicates), nothing
--         is linked; they are kept as two people, and no merge happens here.
--      h. Everyone else's last contact: their latest enquiry, deal, activity
--         on a deal, or sent proposal.
--  11. client_accounts.kind defaults to 'household' and is required.
--
-- Its locks hold every enquiry, contact and account reader and writer, so
-- the backfill is planned not to depend on luck. f, g and h read each table
-- once into temporary tables of this file's own: the client enquiries still
-- without a person, each with its email key worked out once; who holds each
-- email; and each person's latest contact. Each is keyed and analysed before
-- anything joins it. So every join is between plain, keyed columns, and the
-- planner never estimates rows this transaction wrote or columns it added
-- from statistics that cannot know them. No table that existed before this
-- file is analysed: that would change production's planner statistics in the
-- middle of a deploy. And f dates the people it makes as it writes them, so
-- h rewrites none of them: rewriting a row this transaction wrote re-runs
-- its foreign-key checks.
-- On rehearsal data at twice Trades Hall's likely volume (10,820 enquiries,
-- 2,650 contacts), the file runs in about 2 s, its longest statement about
-- half a second (528 ms the most logged), with or without fresh statistics,
-- and with the planner forced to other join methods. Those runs came before
-- c's clearing statement, one more pass over contacts by primary key.
--
-- Re-running the file changes nothing: every step skips what is already in
-- place. Nothing is deleted, and the backfill writes no kept-apart marks.
--
-- What remains: in the pre-deploy window the previous container still
-- serves. It writes contacts with no points and enquiries with no person (its
-- client accounts take 'household' by default). The People Book's
-- create-from-enquiry links such an enquiry to its person when it is worked.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
LOCK TABLE "client_accounts", "enquiries", "contacts" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint

-- 2. The normalisers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION people_trim(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT regexp_replace(raw, '^[[:space:]]+|[[:space:]]+$', '', 'g') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION people_normalise_email(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT NULLIF(lower(people_trim(raw)), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION people_name_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT NULLIF(lower(regexp_replace(people_trim(raw), '[[:space:]]+', ' ', 'g')), '') $$;
--> statement-breakpoint
-- normalisePhone in @omnitwin/types, step for step: the digits; after a "+",
-- 44 becomes the national number and any other country keeps its "+"; 0044
-- becomes the national number; anything else is its digits.
CREATE OR REPLACE FUNCTION people_normalise_phone(raw text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  AS $$
DECLARE
  trimmed text;
  digits text;
  national text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  trimmed := people_trim(raw);
  digits := regexp_replace(trimmed, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;
  IF left(trimmed, 1) = '+' THEN
    IF left(digits, 2) <> '44' THEN
      RETURN '+' || digits;
    END IF;
    national := substr(digits, 3);
  ELSIF left(digits, 4) = '0044' THEN
    national := substr(digits, 5);
  ELSE
    RETURN digits;
  END IF;
  -- toNationalNumber: nothing after the country code is no number.
  IF national = '' THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN left(national, 1) = '0' THEN national ELSE '0' || national END;
END
$$;
--> statement-breakpoint
-- isUsablePhone in @omnitwin/types: it normalises, and its digits (a leading
-- "+" not counted) number PHONE_DIGITS_MIN to PHONE_DIGITS_MAX.
CREATE OR REPLACE FUNCTION people_usable_phone(raw text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT coalesce(length(regexp_replace(people_normalise_phone(raw), '[^0-9]', '', 'g')) BETWEEN 6 AND 15, false) $$;
--> statement-breakpoint

-- 3. contacts ----------------------------------------------------------------
ALTER TABLE "contacts"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "given_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "family_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "job_title" varchar(120),
  ADD COLUMN IF NOT EXISTS "postal_address" text,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "last_contact_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "source_system" varchar(40),
  ADD COLUMN IF NOT EXISTS "source_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "merged_into_id" uuid REFERENCES "contacts"("id") ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS "erased_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_source_pair_check";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_source_pair_check"
  CHECK (("source_system" IS NULL) = ("source_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_not_merged_into_self";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_not_merged_into_self"
  CHECK ("merged_into_id" <> "id");
--> statement-breakpoint
-- Foreign keys depend on this key, so it is added once and never dropped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE "conname" = 'contacts_id_venue_unique' AND "conrelid" = '"contacts"'::regclass
  ) THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_venue_source_unique"
  ON "contacts" ("venue_id", "source_system", "source_id") WHERE "source_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_merged_into_idx" ON "contacts" ("merged_into_id") WHERE "merged_into_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_owner_idx" ON "contacts" ("owner_user_id") WHERE "owner_user_id" IS NOT NULL;
--> statement-breakpoint

-- 4. client_accounts ---------------------------------------------------------
-- kind has no default until the backfill has named every existing account (11).
ALTER TABLE "client_accounts"
  ADD COLUMN IF NOT EXISTS "kind" varchar(20),
  ADD COLUMN IF NOT EXISTS "address" text,
  ADD COLUMN IF NOT EXISTS "website" varchar(255),
  ADD COLUMN IF NOT EXISTS "vat_number" varchar(40),
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "source_system" varchar(40),
  ADD COLUMN IF NOT EXISTS "source_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "merged_into_id" uuid REFERENCES "client_accounts"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "client_accounts" DROP CONSTRAINT IF EXISTS "client_accounts_source_pair_check";
--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_source_pair_check"
  CHECK (("source_system" IS NULL) = ("source_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "client_accounts" DROP CONSTRAINT IF EXISTS "client_accounts_not_merged_into_self";
--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_not_merged_into_self"
  CHECK ("merged_into_id" <> "id");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE "conname" = 'client_accounts_id_venue_unique' AND "conrelid" = '"client_accounts"'::regclass
  ) THEN
    ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_accounts_venue_source_unique"
  ON "client_accounts" ("venue_id", "source_system", "source_id") WHERE "source_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_accounts_merged_into_idx" ON "client_accounts" ("merged_into_id") WHERE "merged_into_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_accounts_owner_idx" ON "client_accounts" ("owner_user_id") WHERE "owner_user_id" IS NOT NULL;
--> statement-breakpoint

-- 5. contact_points ----------------------------------------------------------
-- value is the normalised key (normaliseEmail, normalisePhone); display_value
-- is what was written. A person has at most one primary of each kind.
CREATE TABLE IF NOT EXISTS "contact_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "contact_id" uuid NOT NULL,
  "kind" varchar(10) NOT NULL,
  "value" varchar(255) NOT NULL,
  "display_value" varchar(255) NOT NULL,
  "label" varchar(20) DEFAULT 'other' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "source_system" varchar(40),
  "source_id" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "contact_points_contact_venue_fk" FOREIGN KEY ("contact_id", "venue_id")
    REFERENCES "contacts"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "contact_points_kind_check" CHECK ("kind" IN ('email', 'phone')),
  CONSTRAINT "contact_points_label_check" CHECK ("label" IN ('work', 'personal', 'mobile', 'other')),
  CONSTRAINT "contact_points_value_check" CHECK ("value" <> '' AND "display_value" <> ''),
  CONSTRAINT "contact_points_source_pair_check" CHECK (("source_system" IS NULL) = ("source_id" IS NULL)),
  CONSTRAINT "contact_points_contact_kind_value_unique" UNIQUE ("contact_id", "kind", "value")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_points_one_primary_unique"
  ON "contact_points" ("contact_id", "kind") WHERE "is_primary";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_points_venue_kind_value_idx" ON "contact_points" ("venue_id", "kind", "value");
--> statement-breakpoint

-- 6. account_memberships -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "account_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "contact_id" uuid NOT NULL,
  "client_account_id" uuid NOT NULL,
  "role_label" varchar(120),
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "account_memberships_contact_venue_fk" FOREIGN KEY ("contact_id", "venue_id")
    REFERENCES "contacts"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "account_memberships_account_venue_fk" FOREIGN KEY ("client_account_id", "venue_id")
    REFERENCES "client_accounts"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "account_memberships_pair_unique" UNIQUE ("contact_id", "client_account_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_memberships_one_primary_unique"
  ON "account_memberships" ("contact_id") WHERE "is_primary";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_memberships_account_idx" ON "account_memberships" ("client_account_id");
--> statement-breakpoint

-- 7. record_merges -----------------------------------------------------------
-- survivor_id and merged_id name contacts or client accounts, by kind.
CREATE TABLE IF NOT EXISTS "record_merges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "kind" varchar(20) NOT NULL,
  "survivor_id" uuid NOT NULL,
  "merged_id" uuid NOT NULL,
  "snapshot" jsonb NOT NULL,
  "moves" jsonb NOT NULL,
  "merged_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "merged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "undone_at" timestamp with time zone,
  "undone_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "undo_report" jsonb,
  CONSTRAINT "record_merges_kind_check" CHECK ("kind" IN ('person', 'organisation')),
  CONSTRAINT "record_merges_distinct_check" CHECK ("survivor_id" <> "merged_id"),
  CONSTRAINT "record_merges_shape_check" CHECK (jsonb_typeof("moves") = 'array' AND jsonb_typeof("snapshot") = 'object'),
  CONSTRAINT "record_merges_undo_pair_check" CHECK (("undone_at" IS NULL) = ("undo_report" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_merges_merged_idx" ON "record_merges" ("venue_id", "kind", "merged_id", "merged_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_merges_survivor_idx" ON "record_merges" ("venue_id", "kind", "survivor_id");
--> statement-breakpoint

-- 8. contact_kept_apart ------------------------------------------------------
-- The lower id first, so one pair has one key; a withdrawn mark stays.
CREATE TABLE IF NOT EXISTS "contact_kept_apart" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "low_contact_id" uuid NOT NULL,
  "high_contact_id" uuid NOT NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  "withdrawn_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "contact_kept_apart_low_venue_fk" FOREIGN KEY ("low_contact_id", "venue_id")
    REFERENCES "contacts"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "contact_kept_apart_high_venue_fk" FOREIGN KEY ("high_contact_id", "venue_id")
    REFERENCES "contacts"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "contact_kept_apart_order_check" CHECK ("low_contact_id" < "high_contact_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_kept_apart_live_pair_unique"
  ON "contact_kept_apart" ("low_contact_id", "high_contact_id") WHERE "withdrawn_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_kept_apart_high_idx" ON "contact_kept_apart" ("high_contact_id");
--> statement-breakpoint

-- 9. enquiries.contact_id ----------------------------------------------------
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enquiries_contact_idx" ON "enquiries" ("contact_id") WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint

-- 10. The backfill -----------------------------------------------------------
-- a. Trim the mirrors; a blank email becomes none, and so does a phone that is not usable.
UPDATE contacts SET email = NULLIF(people_trim(email), ''),
  phone = CASE WHEN people_usable_phone(phone) THEN people_trim(phone) END
WHERE email IS DISTINCT FROM NULLIF(people_trim(email), '')
   OR phone IS DISTINCT FROM CASE WHEN people_usable_phone(phone) THEN people_trim(phone) END;
--> statement-breakpoint
-- A non-null email mirror is a real one, so every reader can trust it.
-- Every existing row passes: a, just above, nulls each email people_trim leaves empty, over
-- every contact row (deleted ones too). It uses the same [[:space:]] class in the same
-- database, so no locale can make the two disagree. Placed here, the rule also checks every
-- later write in this file.
-- The phone has no such rule yet. The previous release's public enquiry takes a phone that
-- trims to "", and its Create opportunity copies that phone into contacts.phone; it keeps
-- serving for a minute or two after this pre-deploy migration, so a phone rule would turn
-- that click into a 500 in that window. The follow-up that heals pre-deploy residue adds it.
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_email_not_blank";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_email_not_blank" CHECK ("email" IS NULL OR "email" ~ '[^[:space:]]');
--> statement-breakpoint
-- b. Points from each contact's email and phone, primary.
INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
SELECT c.venue_id, c.id, 'email', people_normalise_email(c.email), c.email, 'other', true FROM contacts c
WHERE people_normalise_email(c.email) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'email')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
SELECT c.venue_id, c.id, 'phone', people_normalise_phone(c.phone), c.phone, 'other', true FROM contacts c
WHERE people_usable_phone(c.phone)
  AND NOT EXISTS (SELECT 1 FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'phone')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- c. An account that is not live, or not at the contact's venue, is no longer the contact's:
--    what refreshContactMirror does on the person's next write. The account row and its deals
--    keep their own links. The live account at the venue is the one a contact keeps, so a
--    second run finds nothing distinct from it and changes nothing.
UPDATE contacts c SET client_account_id = NULL
WHERE c.client_account_id IS DISTINCT FROM (
  SELECT a.id FROM client_accounts a
  WHERE a.id = c.client_account_id AND a.venue_id = c.venue_id
    AND a.deleted_at IS NULL AND a.merged_into_id IS NULL
);
--> statement-breakpoint
-- Memberships from contacts.client_account_id: live accounts at the contact's venue only.
INSERT INTO account_memberships (venue_id, contact_id, client_account_id, role_label, is_primary)
SELECT c.venue_id, c.id, c.client_account_id, c.role_label, true
FROM contacts c JOIN client_accounts a ON a.id = c.client_account_id AND a.venue_id = c.venue_id
  AND a.deleted_at IS NULL AND a.merged_into_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM account_memberships m WHERE m.contact_id = c.id)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- d. Household when the account carries its primary contact's name.
UPDATE client_accounts a SET kind = CASE WHEN EXISTS (
  SELECT 1 FROM contacts c WHERE c.id = a.primary_contact_id AND people_name_key(c.name) = people_name_key(a.name)
) THEN 'household' ELSE 'organisation' END
WHERE a.kind IS NULL;
--> statement-breakpoint
-- e. Converted enquiries to the contact made from them (the earliest live one).
UPDATE enquiries e SET contact_id = c.id
FROM (SELECT DISTINCT ON (source_enquiry_id) id, source_enquiry_id, venue_id FROM contacts
      WHERE source_enquiry_id IS NOT NULL AND deleted_at IS NULL ORDER BY source_enquiry_id, created_at, id) c
WHERE e.id = c.source_enquiry_id AND e.venue_id = c.venue_id AND e.contact_id IS NULL;
--> statement-breakpoint
-- f and g work from two temporary tables, each keyed and analysed (they are this file's own;
-- no table that existed before it is analysed here). So the planner never estimates rows
-- this transaction wrote, or columns it added, from statistics that cannot know them, and
-- every join below is between plain, keyed columns.
--
-- The client enquiries still without a person, each read once, with its normalised email
-- worked out once. Left out, in f and in g: seeds, signed-in drafts never sent, the workspace
-- gate's access requests and Venviewer's own pricing leads, none of them the venue's client.
-- So is an email longer than its contacts column: it is left out rather than cut short (and
-- no point can hold it, so g could never link it). Only a usable phone is kept, and only one
-- that fits its column.
DROP TABLE IF EXISTS pg_temp."people_0098_enquiries";
--> statement-breakpoint
CREATE TEMP TABLE "people_0098_enquiries" AS
SELECT e.id, e.venue_id, e.created_at,
  people_normalise_email(coalesce(e.guest_email, e.email)) AS email_key,
  people_trim(coalesce(e.guest_email, e.email)) AS email_display,
  coalesce(NULLIF(people_trim(e.guest_name), ''), NULLIF(people_trim(e.name), ''), people_trim(coalesce(e.guest_email, e.email))) AS name,
  CASE WHEN people_usable_phone(e.guest_phone) AND length(people_trim(e.guest_phone)) <= 50 THEN people_trim(e.guest_phone) END AS phone_display
FROM enquiries e
WHERE e.contact_id IS NULL AND e.fixture_source IS NULL AND people_normalise_email(coalesce(e.guest_email, e.email)) IS NOT NULL
  AND length(people_normalise_email(coalesce(e.guest_email, e.email))) <= 255
  AND e.state <> 'draft' AND (e.event_type IS NULL OR e.event_type NOT IN ('venue-access', 'venue-enquiry'));
--> statement-breakpoint
ALTER TABLE pg_temp."people_0098_enquiries" ADD PRIMARY KEY ("id");
--> statement-breakpoint
ANALYZE pg_temp."people_0098_enquiries";
--> statement-breakpoint
-- Who holds each email in each venue: how many live people, and the one when it is one.
DROP TABLE IF EXISTS pg_temp."people_0098_holders";
--> statement-breakpoint
CREATE TEMP TABLE "people_0098_holders" AS
SELECT p.venue_id, p.value::text AS email_key, count(DISTINCT p.contact_id)::int AS holders,
  (array_agg(DISTINCT p.contact_id))[1] AS contact_id
FROM contact_points p JOIN contacts c ON c.id = p.contact_id
  AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.erased_at IS NULL
WHERE p.kind = 'email' GROUP BY p.venue_id, p.value;
--> statement-breakpoint
ALTER TABLE pg_temp."people_0098_holders" ADD PRIMARY KEY ("venue_id", "email_key");
--> statement-breakpoint
ANALYZE pg_temp."people_0098_holders";
--> statement-breakpoint
-- f. One person per venue and normalised email that no live person holds, made from that
--    venue's own client enquiries: the latest name, email and usable phone, the first enquiry
--    as its source and its date. Its last contact is its latest enquiry, h's rule for it: g
--    links it these enquiries and no others, and it has no deal yet. Dating it here, as it
--    is written, spares h rewriting every row this file has just inserted.
DROP TABLE IF EXISTS pg_temp."people_0098_enquirers";
--> statement-breakpoint
CREATE TEMP TABLE "people_0098_enquirers" AS
SELECT gen_random_uuid() AS contact_id, g.* FROM (
  SELECT k.venue_id, k.email_key,
    (array_agg(k.email_display ORDER BY k.created_at DESC, k.id DESC))[1] AS email_display,
    (array_agg(k.name ORDER BY k.created_at DESC, k.id DESC))[1] AS name,
    (array_agg(k.phone_display ORDER BY k.created_at DESC, k.id DESC) FILTER (WHERE k.phone_display IS NOT NULL))[1] AS phone_display,
    (array_agg(k.id ORDER BY k.created_at, k.id))[1] AS first_enquiry_id,
    min(k.created_at) AS first_at, max(k.created_at) AS last_at
  FROM pg_temp."people_0098_enquiries" k
  GROUP BY k.venue_id, k.email_key
) g
WHERE NOT EXISTS (SELECT 1 FROM pg_temp."people_0098_holders" h WHERE h.venue_id = g.venue_id AND h.email_key = g.email_key);
--> statement-breakpoint
INSERT INTO contacts (id, venue_id, name, email, phone, source_enquiry_id, created_at, last_contact_at, updated_at)
SELECT contact_id, venue_id, left(name, 200), left(email_display, 255), left(phone_display, 50), first_enquiry_id, first_at, last_at, now()
FROM pg_temp."people_0098_enquirers";
--> statement-breakpoint
-- Their email point and, where they gave a usable phone, their phone point.
INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
SELECT venue_id, contact_id, 'email', email_key, email_display, 'other', true
FROM pg_temp."people_0098_enquirers";
--> statement-breakpoint
INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, label, is_primary)
SELECT venue_id, contact_id, 'phone', people_normalise_phone(phone_display), phone_display, 'other', true
FROM pg_temp."people_0098_enquirers"
WHERE phone_display IS NOT NULL;
--> statement-breakpoint
-- Each email f gave a person had no live holder, so that person is now its one holder. The
-- key refuses, and the file fails, should f ever have made a person for an email already held.
INSERT INTO pg_temp."people_0098_holders" (venue_id, email_key, holders, contact_id)
SELECT venue_id, email_key, 1, contact_id FROM pg_temp."people_0098_enquirers";
--> statement-breakpoint
ANALYZE pg_temp."people_0098_holders";
--> statement-breakpoint
DROP TABLE pg_temp."people_0098_enquirers";
--> statement-breakpoint
-- g. Every client enquiry still without a person (as in f) whose email exactly one live
--    person holds.
UPDATE enquiries e SET contact_id = h.contact_id
FROM pg_temp."people_0098_enquiries" k
  JOIN pg_temp."people_0098_holders" h ON h.venue_id = k.venue_id AND h.email_key = k.email_key AND h.holders = 1
WHERE e.id = k.id AND e.contact_id IS NULL;
--> statement-breakpoint
DROP TABLE pg_temp."people_0098_holders";
--> statement-breakpoint
DROP TABLE pg_temp."people_0098_enquiries";
--> statement-breakpoint
-- h. Every other person's last contact: their latest related enquiry, deal, activity on a
--    deal or sent proposal. Each table is read once, and each person's latest is kept, keyed
--    and analysed.
DROP TABLE IF EXISTS pg_temp."people_0098_last_contact";
--> statement-breakpoint
CREATE TEMP TABLE "people_0098_last_contact" AS
SELECT u.contact_id, max(u.at) AS at FROM (
  SELECT e.contact_id, e.created_at AS at FROM enquiries e WHERE e.contact_id IS NOT NULL
  UNION ALL
  SELECT o.primary_contact_id, o.created_at FROM opportunities o WHERE o.primary_contact_id IS NOT NULL
  UNION ALL
  SELECT o.primary_contact_id, a.created_at FROM activities a JOIN opportunities o ON o.id = a.opportunity_id
  WHERE o.primary_contact_id IS NOT NULL
  UNION ALL
  SELECT o.primary_contact_id, p.sent_at FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id
  WHERE o.primary_contact_id IS NOT NULL
) u GROUP BY u.contact_id;
--> statement-breakpoint
ALTER TABLE pg_temp."people_0098_last_contact" ADD PRIMARY KEY ("contact_id");
--> statement-breakpoint
ANALYZE pg_temp."people_0098_last_contact";
--> statement-breakpoint
UPDATE contacts c SET last_contact_at = x.at
FROM pg_temp."people_0098_last_contact" x
WHERE c.id = x.contact_id AND c.last_contact_at IS NULL AND x.at IS NOT NULL;
--> statement-breakpoint
DROP TABLE pg_temp."people_0098_last_contact";
--> statement-breakpoint

-- 11. Every account has a kind from here on ----------------------------------
-- The previous API writes no kind; its new accounts are households.
ALTER TABLE "client_accounts" ALTER COLUMN "kind" SET DEFAULT 'household', ALTER COLUMN "kind" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "client_accounts" DROP CONSTRAINT IF EXISTS "client_accounts_kind_check";
--> statement-breakpoint
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_kind_check"
  CHECK ("kind" IN ('organisation', 'household'));
--> statement-breakpoint

-- The five-second lock limit was for this file alone; anything after it in
-- the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
