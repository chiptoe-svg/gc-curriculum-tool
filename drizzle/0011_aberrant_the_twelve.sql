CREATE TABLE "coverage_scores" (
	"course_code" text NOT NULL,
	"sub_competency_id" text NOT NULL,
	"kud_level" text NOT NULL,
	"confidence" integer NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"source_profile_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_scores_course_code_sub_competency_id_pk" PRIMARY KEY("course_code","sub_competency_id")
);
--> statement-breakpoint
ALTER TABLE "coverage_scores" ADD CONSTRAINT "coverage_scores_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_scores" ADD CONSTRAINT "coverage_scores_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_scores" ADD CONSTRAINT "coverage_scores_source_profile_run_id_course_profile_runs_id_fk" FOREIGN KEY ("source_profile_run_id") REFERENCES "public"."course_profile_runs"("id") ON DELETE set null ON UPDATE no action;