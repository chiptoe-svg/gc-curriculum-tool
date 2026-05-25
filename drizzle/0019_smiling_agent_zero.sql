CREATE TABLE "ai_function_settings" (
	"function_id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"custom_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
