CREATE TABLE "career_target_demand" (
	"career_target_id" text NOT NULL,
	"sub_competency_id" text NOT NULL,
	"k_demand" real,
	"u_demand" real,
	"d_demand" real,
	"contributing_position_ids" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_target_demand_career_target_id_sub_competency_id_pk" PRIMARY KEY("career_target_id","sub_competency_id")
);
--> statement-breakpoint
ALTER TABLE "career_target_demand" ADD CONSTRAINT "career_target_demand_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_target_demand" ADD CONSTRAINT "career_target_demand_sub_competency_id_sub_competencies_id_fk" FOREIGN KEY ("sub_competency_id") REFERENCES "public"."sub_competencies"("id") ON DELETE cascade ON UPDATE no action;