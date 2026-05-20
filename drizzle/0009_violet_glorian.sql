CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"file_name" text NOT NULL,
	"blob_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"page_count" integer,
	"extraction_method" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"extracted_text" text,
	"analysis_finding" jsonb,
	"analysis_model" text,
	"analysis_cost_usd_cents" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_profile_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"result" jsonb NOT NULL,
	"material_count" integer NOT NULL,
	"model" text NOT NULL,
	"cost_usd_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_profiles" (
	"course_code" text PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"catalog_divergence" jsonb DEFAULT '{"reinforced":[],"additions":[],"gaps":[]}'::jsonb NOT NULL,
	"source_run_id" uuid,
	"manually_edited" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_profile_runs" ADD CONSTRAINT "course_profile_runs_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_profiles" ADD CONSTRAINT "course_profiles_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;