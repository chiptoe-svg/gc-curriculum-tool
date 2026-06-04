CREATE TABLE "career_capture_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"career_target_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_career_capture_messages_session_turn" UNIQUE("session_id","turn_index")
);
--> statement-breakpoint
CREATE TABLE "career_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"career_target_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"model" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "career_capture_messages" ADD CONSTRAINT "career_capture_messages_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_capture_messages" ADD CONSTRAINT "career_capture_messages_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_captures" ADD CONSTRAINT "career_captures_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_captures" ADD CONSTRAINT "career_captures_career_target_id_career_targets_id_fk" FOREIGN KEY ("career_target_id") REFERENCES "public"."career_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_career_capture_messages_session" ON "career_capture_messages" USING btree ("partner_id","career_target_id","session_id","turn_index");--> statement-breakpoint
CREATE INDEX "idx_career_captures_partner_target" ON "career_captures" USING btree ("partner_id","career_target_id","created_at");