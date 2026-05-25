CREATE TABLE "course_explore_what_ifs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"analysis_id" uuid,
	"change_prose" text NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_explore_what_ifs" ADD CONSTRAINT "course_explore_what_ifs_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_what_ifs" ADD CONSTRAINT "course_explore_what_ifs_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_what_ifs" ADD CONSTRAINT "course_explore_what_ifs_target_id_course_explore_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."course_explore_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_what_ifs" ADD CONSTRAINT "course_explore_what_ifs_analysis_id_course_explore_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."course_explore_analyses"("id") ON DELETE set null ON UPDATE no action;