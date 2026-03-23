-- Users: add profile fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_name" text;

-- Configurations: nullable userId + public preview flag
ALTER TABLE "configurations" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "configurations" ADD COLUMN IF NOT EXISTS "is_public_preview" boolean NOT NULL DEFAULT false;

-- Enquiries: nullable userId + guest fields
ALTER TABLE "enquiries" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "guest_email" text;
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "guest_phone" text;
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "guest_name" text;

-- Guest leads table
CREATE TABLE IF NOT EXISTS "guest_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "name" text,
  "first_enquiry_id" uuid,
  "converted_to_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "guest_leads_email_idx" ON "guest_leads" ("email");

-- Enquiry status history: make changedBy nullable (for guest submissions)
ALTER TABLE "enquiry_status_history" ALTER COLUMN "changed_by" DROP NOT NULL;
