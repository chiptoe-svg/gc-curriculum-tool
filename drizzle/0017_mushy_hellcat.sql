CREATE TABLE "course_explore_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"analysis" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_explore_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"caption" text,
	"prose_input" text,
	"authored_against_snapshot_id" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_explore_analyses" ADD CONSTRAINT "course_explore_analyses_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_analyses" ADD CONSTRAINT "course_explore_analyses_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_analyses" ADD CONSTRAINT "course_explore_analyses_target_id_course_explore_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."course_explore_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_targets" ADD CONSTRAINT "course_explore_targets_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_explore_targets" ADD CONSTRAINT "course_explore_targets_authored_against_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("authored_against_snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE set null ON UPDATE no action;