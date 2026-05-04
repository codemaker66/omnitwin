-- -----------------------------------------------------------------------------
-- 0023_upload_scoping
--
-- T-089: uploaded files must carry enough metadata to enforce private/public
-- read policy and audit upload decisions. The route now scopes private keys
-- under venue/customer prefixes and only exposes permanent URLs for explicit
-- public marketing uploads.
-- -----------------------------------------------------------------------------

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "content_length_bytes" integer;

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "sha256" varchar(64);

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "visibility" varchar(20) NOT NULL DEFAULT 'private';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_visibility_check'
  ) THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_visibility_check" CHECK (
      "visibility" IN ('private', 'public')
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_sha256_check'
  ) THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_sha256_check" CHECK (
      "sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_content_length_positive_check'
  ) THEN
    ALTER TABLE "files" ADD CONSTRAINT "files_content_length_positive_check" CHECK (
      "content_length_bytes" IS NULL OR "content_length_bytes" > 0
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "files_visibility_idx"
  ON "files" ("visibility");
