CREATE TABLE "prototype_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid NOT NULL,
	"flag_type" text NOT NULL,
	"target" text NOT NULL,
	"note" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototype_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL,
	"career_target_id" text NOT NULL,
	"upstream_course_label" text,
	"downstream_course_label" text,
	"upstream_syllabus" text NOT NULL,
	"downstream_syllabus" text NOT NULL,
	"result" jsonb NOT NULL,
	"ai_provider" text NOT NULL,
	"ai_model" text NOT NULL,
	"cost_usd_cents" integer NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prototype_flags" ADD CONSTRAINT "prototype_flags_run_id_prototype_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prototype_runs"("id") ON DELETE cascade ON UPDATE no action;