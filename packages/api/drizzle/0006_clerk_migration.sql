-- Migrate from custom JWT auth to Clerk

-- Add clerkId column to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerk_id" text UNIQUE;

-- Drop passwordHash column (Clerk handles passwords now)
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";

-- Drop refresh_tokens table (Clerk handles session management)
DROP TABLE IF EXISTS "refresh_tokens";
