CREATE TYPE "public"."course_category" AS ENUM('gc_core', 'specialty', 'major_req', 'other');--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "category" "course_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "builds_to_career" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "catalog_url" text;