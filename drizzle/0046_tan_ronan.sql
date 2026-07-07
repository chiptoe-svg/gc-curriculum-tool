CREATE TABLE "course_explore_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"baseline_snapshot_id" text NOT NULL,
	"change" jsonb NOT NULL,
	"predicted_deltas" jsonb NOT NULL,
	"computed_ripple" jsonb NOT NULL,
	"agent_notes" text,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_explore_scenarios" ADD CONSTRAINT "course_explore_scenarios_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_explore_scenarios_course" ON "course_explore_scenarios" USING btree ("course_code");