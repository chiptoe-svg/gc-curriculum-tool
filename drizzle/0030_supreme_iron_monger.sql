CREATE TABLE "prerequisite_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"focal_course_code" text NOT NULL,
	"prereq_course_code" text NOT NULL,
	"sub_competency_id" text NOT NULL,
	"expected_k" integer,
	"expected_u" integer,
	"expected_d" integer,
	"source" text NOT NULL,
	"confidence" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_prerequisite_edges_focal_prereq_subcomp" UNIQUE("focal_course_code","prereq_course_code","sub_competency_id")
);
--> statement-breakpoint
ALTER TABLE "prerequisite_edges" ADD CONSTRAINT "prerequisite_edges_focal_course_code_courses_code_fk" FOREIGN KEY ("focal_course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prerequisite_edges" ADD CONSTRAINT "prerequisite_edges_prereq_course_code_courses_code_fk" FOREIGN KEY ("prereq_course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prerequisite_edges" ADD CONSTRAINT "prerequisite_edges_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_prerequisite_edges_focal" ON "prerequisite_edges" USING btree ("focal_course_code");--> statement-breakpoint
CREATE INDEX "idx_prerequisite_edges_prereq" ON "prerequisite_edges" USING btree ("prereq_course_code");