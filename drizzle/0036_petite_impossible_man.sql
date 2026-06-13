ALTER TABLE "course_kud_runs" ALTER COLUMN "cost_usd_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "course_materials" ALTER COLUMN "analysis_cost_usd_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "course_profile_runs" ALTER COLUMN "cost_usd_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "daily_cost" ALTER COLUMN "total_cost_usd_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "prototype_runs" ALTER COLUMN "cost_usd_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "synthesis_runs" ALTER COLUMN "cost_usd_cents" SET DATA TYPE bigint;