CREATE TABLE "daily_cost" (
	"day" text PRIMARY KEY NOT NULL,
	"total_cost_usd_cents" integer DEFAULT 0 NOT NULL,
	"last_alert_sent" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ip_hourly" (
	"ip_hash" text NOT NULL,
	"hour_key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ip_hourly_ip_hash_hour_key_pk" PRIMARY KEY("ip_hash","hour_key")
);
