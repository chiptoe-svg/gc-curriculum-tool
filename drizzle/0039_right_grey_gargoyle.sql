CREATE TYPE "public"."course_scope" AS ENUM('gc', 'external');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('offered', 'proposed', 'sandbox', 'retired');--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "scope" "course_scope" DEFAULT 'gc' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "status" "course_status" DEFAULT 'offered' NOT NULL;