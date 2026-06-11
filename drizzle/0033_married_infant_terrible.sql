CREATE TYPE "public"."course_category" AS ENUM('gc_core', 'specialty', 'major_req', 'other');--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "category" "course_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "builds_to_career" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "catalog_url" text;
--> statement-breakpoint
UPDATE "courses" SET "category" = 'gc_core' WHERE "code" IN ('GC 1010','GC 1020','GC 1040','GC 1050','GC 2070','GC 2400','GC 3400','GC 3460','GC 3500','GC 3800','GC 4060','GC 4400','GC 4440','GC 4480','GC 4500','GC 4800');
--> statement-breakpoint
UPDATE "courses" SET "category" = 'specialty' WHERE "code" IN ('GC 3620','GC 3700','GC 3710','GC 3720','GC 3730','GC 3740','GC 3760','GC 3780','GC 3790','GC 4070','GC 4900ap','GC 4900bl','GC 4900or','GC 4990ta');
--> statement-breakpoint
UPDATE "courses" SET "category" = 'major_req' WHERE "code" IN ('ACCT 2010','ACCT 2020','MGT 2010','MKT 3010','PKSC 1020','STAT 2300','ENGL 1030','ENSP 2000','PSYC 2010','ECON 2110','PCID 3040','STAT 2220','STAT 3090','STAT 3300','ECON 2000','PCID 3140');
--> statement-breakpoint
UPDATE "courses" SET "builds_to_career" = true WHERE "code" IN ('GC 1010','GC 1020','GC 1040','GC 1050','GC 2070','GC 2400','GC 3400','GC 3460','GC 3500','GC 3800','GC 4060','GC 4400','GC 4440','GC 4480','GC 4500','GC 4800','ACCT 2010','ACCT 2020','MGT 2010','MKT 3010','PKSC 1020','STAT 2300','ENGL 1030','ENSP 2000','PSYC 2010','ECON 2110','PCID 3040');
