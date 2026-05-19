CREATE TABLE "partner_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"career_target_id" text,
	"unmapped_target_label" text,
	"position_title" text NOT NULL,
	"responsibilities" text DEFAULT '' NOT NULL,
	"salary_range_low" integer,
	"salary_range_high" integer,
	"salary_currency" text DEFAULT 'USD' NOT NULL,
	"interview_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nice_to_have_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"additional_notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "partner_submissions" ADD CONSTRAINT "partner_submissions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_submissions" ADD CONSTRAINT "partner_submissions_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE no action ON UPDATE no action;