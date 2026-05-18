CREATE TABLE "career_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_definition" text NOT NULL,
	"industry_contexts" jsonb NOT NULL,
	"know_descriptors" jsonb NOT NULL,
	"understand_descriptors" jsonb NOT NULL,
	"do_descriptors" jsonb NOT NULL,
	"defensibility_note" text NOT NULL,
	"soc_code" text,
	"display_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prototype_target_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"change_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "sub_competencies" (
	"id" text PRIMARY KEY NOT NULL,
	"career_target_id" text NOT NULL,
	"name" text NOT NULL,
	"know_descriptor" text NOT NULL,
	"understand_descriptor" text NOT NULL,
	"do_descriptor" text NOT NULL,
	"display_order" integer NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sub_competencies" ADD CONSTRAINT "sub_competencies_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;