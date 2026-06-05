CREATE TABLE "course_intended_coverage" (
	"course_code" text NOT NULL,
	"sub_competency_id" text NOT NULL,
	"intended_k" integer,
	"intended_u" integer,
	"intended_d" integer,
	"confidence" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_intended_coverage_course_code_sub_competency_id_pk" PRIMARY KEY("course_code","sub_competency_id")
);
--> statement-breakpoint
ALTER TABLE "course_intended_coverage" ADD CONSTRAINT "course_intended_coverage_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_intended_coverage" ADD CONSTRAINT "course_intended_coverage_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_intended_coverage_course" ON "course_intended_coverage" USING btree ("course_code");