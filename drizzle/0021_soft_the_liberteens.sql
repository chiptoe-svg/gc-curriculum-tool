ALTER TABLE "course_materials" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "summary_model" text;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "summary_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "use_summary" boolean DEFAULT false NOT NULL;