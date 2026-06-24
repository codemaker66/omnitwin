ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platform_role" varchar(20) NOT NULL DEFAULT 'none';

DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_platform_role_check"
    CHECK ("platform_role" IN ('none', 'operator', 'admin'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "users_platform_role_idx" ON "users" ("platform_role");
