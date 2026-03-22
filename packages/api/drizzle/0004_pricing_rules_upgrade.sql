-- Upgrade pricing_rules: replace old columns with new schema
-- Drop old columns
ALTER TABLE "pricing_rules" DROP COLUMN IF EXISTS "base_price_pence";
ALTER TABLE "pricing_rules" DROP COLUMN IF EXISTS "price_per_guest_pence";
ALTER TABLE "pricing_rules" DROP COLUMN IF EXISTS "price_per_hour_pence";
ALTER TABLE "pricing_rules" DROP COLUMN IF EXISTS "minimum_hours";
ALTER TABLE "pricing_rules" DROP COLUMN IF EXISTS "day_of_week";

-- Add new columns
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "type" varchar(20) NOT NULL DEFAULT 'flat_rate';
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "amount" numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "currency" varchar(3) NOT NULL DEFAULT 'GBP';
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "min_hours" integer;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "min_guests" integer;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "tiers" jsonb;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "day_of_week_modifiers" jsonb;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "seasonal_modifiers" jsonb;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
