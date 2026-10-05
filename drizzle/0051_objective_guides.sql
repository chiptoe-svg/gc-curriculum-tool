-- 0051 — objective assessment guides (spec 2026-10-05).
-- HAND-WRITTEN, applied with psql: drizzle/meta is git-ignored and this
-- checkout's journal stops at 0049, so drizzle-kit generate/migrate are unsafe
-- here (see docs/STATE.md Deferred / debt). Idempotent; safe to re-run.
ALTER TABLE "course_materials" ADD COLUMN IF NOT EXISTS "is_syllabus" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course_objective_guides" (
	"course_code" text PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"guide" jsonb NOT NULL,
	"dropped_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_objective_guides_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "course_objective_guides_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- One-time flag backfill: the Canvas syllabus page, and any material whose
-- name contains "syllabus" (case-insensitive).
UPDATE "course_materials" SET "is_syllabus" = true
WHERE "is_syllabus" = false
  AND ("file_name" = 'Canvas: Syllabus' OR "file_name" ILIKE '%syllabus%');
