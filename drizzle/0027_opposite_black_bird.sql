ALTER TABLE "capture_messages" ADD COLUMN "instructor_name" text;--> statement-breakpoint
ALTER TABLE "course_capture_snapshots" ADD COLUMN "instructor_name" text;--> statement-breakpoint
-- Backfill existing snapshots to "Department canonical" so they remain
-- distinguishable from future instructor-attributed snapshots. The
-- value is a sentinel — these were captured before instructor identity
-- was tracked; the auditor was effectively the department admin and
-- the depth scoring reflected the collected materials rather than any
-- single instructor's section.
UPDATE "course_capture_snapshots" SET "instructor_name" = 'Department canonical' WHERE "instructor_name" IS NULL;--> statement-breakpoint
UPDATE "capture_messages" SET "instructor_name" = 'Department canonical' WHERE "instructor_name" IS NULL;