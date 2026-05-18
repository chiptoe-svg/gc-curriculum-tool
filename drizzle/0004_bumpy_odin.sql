CREATE TABLE "courses" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"level" integer NOT NULL,
	"track" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prerequisites" text DEFAULT '' NOT NULL,
	"syllabus_url" text,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"major_projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills_required" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"last_synced_count" integer NOT NULL,
	"last_errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prototype_target_edits" ALTER COLUMN "after" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prototype_target_edits" ALTER COLUMN "after" DROP NOT NULL;