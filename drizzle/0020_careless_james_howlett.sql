CREATE TABLE "snapshot_target_coverage" (
	"snapshot_id" uuid NOT NULL,
	"career_target_id" text NOT NULL,
	"sub_competency_id" text NOT NULL,
	"k_depth" integer,
	"u_depth" integer,
	"d_depth" integer NOT NULL,
	"matched_competency" text,
	"evidence_excerpt" text,
	"confidence" text NOT NULL,
	"rationale" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_target_coverage_snapshot_id_career_target_id_sub_competency_id_pk" PRIMARY KEY("snapshot_id","career_target_id","sub_competency_id")
);
--> statement-breakpoint
ALTER TABLE "snapshot_target_coverage" ADD CONSTRAINT "snapshot_target_coverage_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_target_coverage" ADD CONSTRAINT "snapshot_target_coverage_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_target_coverage" ADD CONSTRAINT "snapshot_target_coverage_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;