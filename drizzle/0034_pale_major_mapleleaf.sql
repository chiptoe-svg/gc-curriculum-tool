CREATE TYPE "public"."flag_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."flag_target_kind" AS ENUM('coverage_cell', 'profile_competency');--> statement-breakpoint
CREATE TABLE "faculty_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" "flag_target_kind" NOT NULL,
	"course_code" text NOT NULL,
	"career_target_id" text,
	"sub_competency_id" text,
	"competency_statement" text,
	"note" text NOT NULL,
	"flagged_by" text NOT NULL,
	"flagged_context" jsonb,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faculty_flags" ADD CONSTRAINT "faculty_flags_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_flags" ADD CONSTRAINT "faculty_flags_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_flags" ADD CONSTRAINT "faculty_flags_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_faculty_flags_cell" ON "faculty_flags" USING btree ("course_code","career_target_id","sub_competency_id");--> statement-breakpoint
CREATE INDEX "idx_faculty_flags_status" ON "faculty_flags" USING btree ("status");