CREATE TABLE "onboarding_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_id" text NOT NULL,
  "email" varchar(255),
  "source" varchar(40) NOT NULL,
  "decision" varchar(60) NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "onboarding_audit_clerk_idx" ON "onboarding_audit_events" USING btree ("clerk_id");
--> statement-breakpoint
CREATE INDEX "onboarding_audit_email_idx" ON "onboarding_audit_events" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "onboarding_audit_created_at_idx" ON "onboarding_audit_events" USING btree ("created_at");
