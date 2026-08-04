-- Immutable, room-scoped runtime-package revisions.
--
-- Historical runtime_packages rows were mutable, so their present bytes cannot
-- honestly be claimed as the content that was first registered. Preserve those
-- rows as explicitly legacy identities and assign only an ordering number.

ALTER TABLE "runtime_packages"
  ADD COLUMN "revision" integer,
  ADD COLUMN "identity_kind" varchar(24),
  ADD COLUMN "content_digest" varchar(64);

WITH "ranked_legacy_runtime_packages" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "venue_slug", "room_slug"
      ORDER BY "created_at", "updated_at", "id"
    )::integer AS "legacy_revision"
  FROM "runtime_packages"
)
UPDATE "runtime_packages" AS "runtime_package"
SET
  "revision" = "ranked"."legacy_revision",
  "identity_kind" = 'legacy',
  "content_digest" = NULL
FROM "ranked_legacy_runtime_packages" AS "ranked"
WHERE "runtime_package"."id" = "ranked"."id";

ALTER TABLE "runtime_packages"
  ALTER COLUMN "revision" SET NOT NULL,
  ALTER COLUMN "identity_kind" SET NOT NULL,
  ADD CONSTRAINT "runtime_packages_revision_positive"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "runtime_packages_identity_coherent"
    CHECK (
      ("identity_kind" = 'legacy' AND "content_digest" IS NULL)
      OR
      (
        "identity_kind" = 'content_sha256'
        AND "content_digest" IS NOT NULL
        AND "content_digest" ~ '^[a-f0-9]{64}$'
      )
    ),
  ADD CONSTRAINT "runtime_packages_venue_room_revision_unique"
    UNIQUE ("venue_slug", "room_slug", "revision"),
  ADD CONSTRAINT "runtime_packages_venue_room_digest_unique"
    UNIQUE ("venue_slug", "room_slug", "content_digest");

CREATE FUNCTION "enforce_runtime_package_revision_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  "expected_revision" integer;
BEGIN
  IF NEW."identity_kind" IS DISTINCT FROM 'content_sha256'
    OR NEW."content_digest" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'runtime_packages_new_identity_content_sha256',
      MESSAGE = 'new runtime package revisions require a non-null content_sha256 identity';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW."venue_slug" || E'\x1f' || NEW."room_slug", 0)
  );

  SELECT COALESCE(MAX("revision"), 0) + 1
  INTO "expected_revision"
  FROM "runtime_packages"
  WHERE "venue_slug" = NEW."venue_slug"
    AND "room_slug" = NEW."room_slug";

  IF NEW."revision" <> "expected_revision" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'runtime_packages_revision_monotonic',
      MESSAGE = format(
        'runtime package revision must be %s for %s/%s, received %s',
        "expected_revision",
        NEW."venue_slug",
        NEW."room_slug",
        NEW."revision"
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "runtime_packages_revision_monotonic"
  BEFORE INSERT ON "runtime_packages"
  FOR EACH ROW EXECUTE FUNCTION "enforce_runtime_package_revision_insert"();

CREATE FUNCTION "deny_runtime_package_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'runtime_packages is append-only';
END;
$$;

CREATE TRIGGER "runtime_packages_no_update"
  BEFORE UPDATE ON "runtime_packages"
  FOR EACH ROW EXECUTE FUNCTION "deny_runtime_package_mutation"();

CREATE TRIGGER "runtime_packages_no_delete"
  BEFORE DELETE ON "runtime_packages"
  FOR EACH ROW EXECUTE FUNCTION "deny_runtime_package_mutation"();

CREATE TRIGGER "runtime_packages_no_truncate"
  BEFORE TRUNCATE ON "runtime_packages"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_runtime_package_mutation"();
