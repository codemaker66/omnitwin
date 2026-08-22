CREATE TABLE "quiz_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz" varchar(40) NOT NULL,
	"answers" jsonb NOT NULL,
	"deliberation" jsonb,
	"result" varchar(20) NOT NULL,
	"runner_up" varchar(20) NOT NULL,
	"margin" real NOT NULL,
	"hung" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"viewport" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quiz_runs_quiz_created_idx" ON "quiz_runs" USING btree ("quiz","created_at");
