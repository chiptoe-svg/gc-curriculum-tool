-- Migration: rename upstream/downstream framing → course/prior coursework
--
-- Before: upstream_course_label, downstream_course_label, upstream_syllabus, downstream_syllabus (single-valued text columns)
-- After:  course_label (text), course_syllabus (text), prior_coursework (jsonb array)
--
-- Data preservation: existing rows get prior_coursework backfilled from
-- upstream_course_label + upstream_syllabus as a single-element JSON array.
-- downstream_course_label → course_label, downstream_syllabus → course_syllabus.

-- Step 1: rename downstream columns
ALTER TABLE "prototype_runs" RENAME COLUMN "downstream_course_label" TO "course_label";
--> statement-breakpoint
ALTER TABLE "prototype_runs" RENAME COLUMN "downstream_syllabus" TO "course_syllabus";
--> statement-breakpoint

-- Step 2: add the new prior_coursework JSONB column (nullable first so we can backfill)
ALTER TABLE "prototype_runs" ADD COLUMN "prior_coursework" jsonb;
--> statement-breakpoint

-- Step 3: backfill prior_coursework from the old upstream single-value columns
UPDATE "prototype_runs"
SET "prior_coursework" = jsonb_build_array(
  jsonb_build_object(
    'courseLabel', COALESCE("upstream_course_label", ''),
    'syllabus',    COALESCE("upstream_syllabus", '')
  )
)
WHERE "prior_coursework" IS NULL;
--> statement-breakpoint

-- Step 4: make it NOT NULL now that all rows have a value
ALTER TABLE "prototype_runs" ALTER COLUMN "prior_coursework" SET NOT NULL;
--> statement-breakpoint

-- Step 5: drop the now-redundant upstream columns
ALTER TABLE "prototype_runs" DROP COLUMN "upstream_course_label";
--> statement-breakpoint
ALTER TABLE "prototype_runs" DROP COLUMN "upstream_syllabus";
