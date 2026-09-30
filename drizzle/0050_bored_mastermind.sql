CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"can" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "access_grants_token_hash_unique" UNIQUE("token_hash")
);
