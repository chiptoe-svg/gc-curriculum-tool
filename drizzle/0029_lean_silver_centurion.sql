CREATE TABLE "career_target_kud_aggregate" (
	"career_target_id" text PRIMARY KEY NOT NULL,
	"aggregate_markdown" text NOT NULL,
	"derived_from_position_ids" jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_capture_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"position_capture_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_position_capture_messages_session_turn" UNIQUE("session_id","turn_index")
);
--> statement-breakpoint
CREATE TABLE "position_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"career_target_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"company" text NOT NULL,
	"position_title" text,
	"structured_inputs" jsonb,
	"rated_skills" jsonb,
	"source_files" jsonb,
	"session_id" uuid,
	"profile" jsonb,
	"model" text,
	"completeness" text,
	"supersedes" uuid,
	"retired_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "career_capture_messages" CASCADE;--> statement-breakpoint
DROP TABLE "career_captures" CASCADE;--> statement-breakpoint
ALTER TABLE "career_target_kud_aggregate" ADD CONSTRAINT "career_target_kud_aggregate_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_messages" ADD CONSTRAINT "position_capture_messages_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_capture_messages" ADD CONSTRAINT "position_capture_messages_position_capture_id_position_captures_id_fk" FOREIGN KEY ("position_capture_id") REFERENCES "public"."position_captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_captures" ADD CONSTRAINT "position_captures_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_captures" ADD CONSTRAINT "position_captures_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_captures" ADD CONSTRAINT "fk_position_captures_supersedes" FOREIGN KEY ("supersedes") REFERENCES "public"."position_captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_position_capture_messages_session" ON "position_capture_messages" USING btree ("position_capture_id","session_id","turn_index");--> statement-breakpoint
CREATE INDEX "idx_position_captures_partner_target" ON "position_captures" USING btree ("partner_id","career_target_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_position_captures_target_status" ON "position_captures" USING btree ("career_target_id","status");--> statement-breakpoint
CREATE INDEX "idx_position_captures_supersedes" ON "position_captures" USING btree ("supersedes");