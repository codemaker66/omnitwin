CREATE TABLE "diary_commands" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"booking_id" uuid,
	"outcome" varchar(16) NOT NULL,
	"status_code" integer NOT NULL,
	"error_code" varchar(64),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_commands" ADD CONSTRAINT "diary_commands_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diary_commands" ADD CONSTRAINT "diary_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_commands_venue_received_idx" ON "diary_commands" USING btree ("venue_id","received_at");
