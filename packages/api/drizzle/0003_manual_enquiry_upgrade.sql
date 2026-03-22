-- Add user_id, created_at, updated_at to enquiries (drop old timestamp columns)
ALTER TABLE "enquiries" ADD COLUMN "user_id" uuid NOT NULL REFERENCES "users"("id");
ALTER TABLE "enquiries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "enquiries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

-- Drop old columns that were replaced
ALTER TABLE "enquiries" DROP COLUMN IF EXISTS "view_duration_seconds";
ALTER TABLE "enquiries" DROP COLUMN IF EXISTS "submitted_at";
ALTER TABLE "enquiries" DROP COLUMN IF EXISTS "viewed_at";
ALTER TABLE "enquiries" DROP COLUMN IF EXISTS "responded_at";

-- Change default state from 'submitted' to 'draft'
ALTER TABLE "enquiries" ALTER COLUMN "state" SET DEFAULT 'draft';

-- Add index on user_id
CREATE INDEX IF NOT EXISTS "enquiries_user_id_idx" ON "enquiries" ("user_id");

-- Create enquiry_status_history table
CREATE TABLE IF NOT EXISTS "enquiry_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "enquiry_id" uuid NOT NULL REFERENCES "enquiries"("id") ON DELETE CASCADE,
  "from_status" varchar(20) NOT NULL,
  "to_status" varchar(20) NOT NULL,
  "changed_by" uuid NOT NULL REFERENCES "users"("id"),
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "enquiry_history_enquiry_id_idx" ON "enquiry_status_history" ("enquiry_id");

-- Create files table
CREATE TABLE IF NOT EXISTS "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "file_key" text NOT NULL UNIQUE,
  "filename" varchar(500) NOT NULL,
  "content_type" varchar(100) NOT NULL,
  "context" varchar(50) NOT NULL,
  "context_id" uuid NOT NULL,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id"),
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "files_context_idx" ON "files" ("context", "context_id");
