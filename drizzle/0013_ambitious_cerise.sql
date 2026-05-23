CREATE TABLE "course_capture_profiles" (
	"course_code" text PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"reviewer_status" text DEFAULT 'ai_drafted' NOT NULL,
	"reviewer_note" text,
	"scale_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_capture_profiles" ADD CONSTRAINT "course_capture_profiles_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;