CREATE TABLE "capture_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_index" integer NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_result" jsonb,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_capture_snapshots" ADD COLUMN "transcript_session_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "audit_mode" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "capture_messages" ADD CONSTRAINT "capture_messages_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_capture_messages_session" ON "capture_messages" USING btree ("course_code","session_id","turn_index");
