CREATE TABLE "synthesis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"career_target_id" text NOT NULL,
	"submission_count" integer NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"cost_usd_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthesis_runs" ADD CONSTRAINT "synthesis_runs_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;