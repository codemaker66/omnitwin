CREATE TABLE "asset_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" varchar(50) NOT NULL,
	"thumbnail_url" text,
	"mesh_url" text,
	"width_m" numeric(5, 3) NOT NULL,
	"depth_m" numeric(5, 3) NOT NULL,
	"height_m" numeric(5, 3) NOT NULL,
	"seat_count" integer,
	"collision_type" varchar(20) DEFAULT 'box' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"state" varchar(20) DEFAULT 'draft' NOT NULL,
	"layout_style" varchar(50) NOT NULL,
	"guest_count" integer DEFAULT 0 NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"thumbnail_url" text,
	"lightmap_url" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"configuration_id" uuid,
	"state" varchar(20) DEFAULT 'submitted' NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(255) NOT NULL,
	"preferred_date" date,
	"event_type" varchar(100),
	"estimated_guests" integer,
	"message" text,
	"view_duration_seconds" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "photo_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"visibility" varchar(20) DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placed_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"asset_definition_id" uuid NOT NULL,
	"position_x" numeric(8, 3) NOT NULL,
	"position_y" numeric(8, 3) NOT NULL,
	"position_z" numeric(8, 3) NOT NULL,
	"rotation_x" numeric(8, 5) DEFAULT '0' NOT NULL,
	"rotation_y" numeric(8, 5) DEFAULT '0' NOT NULL,
	"rotation_z" numeric(8, 5) DEFAULT '0' NOT NULL,
	"scale" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"space_id" uuid,
	"name" varchar(200) NOT NULL,
	"base_price_pence" integer NOT NULL,
	"price_per_guest_pence" integer DEFAULT 0 NOT NULL,
	"price_per_hour_pence" integer DEFAULT 0 NOT NULL,
	"minimum_hours" integer DEFAULT 1,
	"day_of_week" jsonb,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text DEFAULT '',
	"width_m" numeric(6, 2) NOT NULL,
	"length_m" numeric(6, 2) NOT NULL,
	"height_m" numeric(6, 2) NOT NULL,
	"floor_plan_outline" jsonb NOT NULL,
	"mesh_url" text,
	"thumbnail_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_venue_slug_unique" UNIQUE("venue_id","slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" varchar(20) NOT NULL,
	"venue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"address" varchar(500) NOT NULL,
	"logo_url" text,
	"brand_colour" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_references" ADD CONSTRAINT "photo_references_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_references" ADD CONSTRAINT "photo_references_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_references" ADD CONSTRAINT "photo_references_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placed_objects" ADD CONSTRAINT "placed_objects_configuration_id_configurations_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."configurations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placed_objects" ADD CONSTRAINT "placed_objects_asset_definition_id_asset_definitions_id_fk" FOREIGN KEY ("asset_definition_id") REFERENCES "public"."asset_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "configurations_space_state_idx" ON "configurations" USING btree ("space_id","state");--> statement-breakpoint
CREATE INDEX "configurations_venue_visibility_idx" ON "configurations" USING btree ("venue_id","visibility");--> statement-breakpoint
CREATE INDEX "enquiries_venue_state_idx" ON "enquiries" USING btree ("venue_id","state");--> statement-breakpoint
CREATE INDEX "placed_objects_configuration_id_idx" ON "placed_objects" USING btree ("configuration_id");