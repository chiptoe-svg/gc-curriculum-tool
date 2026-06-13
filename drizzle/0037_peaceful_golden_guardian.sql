CREATE TYPE "public"."course_code_role" AS ENUM('lecture', 'lab', 'other');--> statement-breakpoint
CREATE TABLE "course_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_code" text NOT NULL,
	"paired_code" text NOT NULL,
	"role" "course_code_role" NOT NULL,
	"canvas_course_name" text,
	"canvas_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_course_codes_paired" UNIQUE("paired_code")
);
--> statement-breakpoint
ALTER TABLE "course_materials" ADD COLUMN "source_code" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "course_number" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "number_suffix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_codes" ADD CONSTRAINT "course_codes_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_codes_course" ON "course_codes" USING btree ("course_code");
--> statement-breakpoint
UPDATE "courses" SET
  "prefix" = upper((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[1]),
  "course_number" = ((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[2])::int,
  "number_suffix" = lower(coalesce((regexp_match(code, '^\s*([A-Za-z]+)\s*([0-9]+)\s*([A-Za-z]*)\s*$'))[3], ''))
WHERE code ~ '^\s*[A-Za-z]+\s*[0-9]+\s*[A-Za-z]*\s*$';