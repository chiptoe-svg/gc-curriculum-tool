ALTER TABLE "sandbox_grants" DROP CONSTRAINT "sandbox_grants_course_code_courses_code_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_grants" ALTER COLUMN "course_code" DROP NOT NULL;