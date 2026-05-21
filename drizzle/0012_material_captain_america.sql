CREATE TABLE "course_kud_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"result" jsonb NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"model" text NOT NULL,
	"cost_usd_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_kuds" (
	"course_code" text PRIMARY KEY NOT NULL,
	"threshold_concept" text NOT NULL,
	"know" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"understand" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"do" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manually_edited" boolean DEFAULT false NOT NULL,
	"source_run_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_ip_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "builder_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_kud_runs" ADD CONSTRAINT "course_kud_runs_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_kuds" ADD CONSTRAINT "course_kuds_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_kuds" ADD CONSTRAINT "course_kuds_source_run_id_course_kud_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."course_kud_runs"("id") ON DELETE set null ON UPDATE no action;