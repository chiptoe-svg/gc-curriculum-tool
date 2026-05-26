ALTER TABLE "course_materials" RENAME COLUMN "summary" TO "digest";--> statement-breakpoint
ALTER TABLE "course_materials" RENAME COLUMN "summary_model" TO "digest_model";--> statement-breakpoint
ALTER TABLE "course_materials" RENAME COLUMN "summary_generated_at" TO "digest_generated_at";--> statement-breakpoint
ALTER TABLE "course_materials" RENAME COLUMN "use_summary" TO "use_digest";--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "ferpa_risk" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "auto_set_aside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "set_aside_reason" text;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "indexing_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "indexed_at" timestamp with time zone;