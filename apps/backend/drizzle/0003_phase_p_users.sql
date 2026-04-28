-- Phase P — Replace single-owner model with multi-user `users` table.
-- Existing `owner` row(s) become admin users with must_change_password = false.
-- `devices.owner_id` becomes `devices.user_id` (1:1 mapping).

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"org_role" text DEFAULT 'member' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("org_role");
--> statement-breakpoint
CREATE INDEX "users_disabled_idx" ON "users" USING btree ("disabled_at");
--> statement-breakpoint

-- Carry over any existing owner rows as admins (must_change_password = false:
-- they already chose their password).
INSERT INTO "users" (id, email, password_hash, display_name, org_role, must_change_password, created_at)
SELECT id, email, password_hash, email, 'admin', false, created_at FROM "owner";
--> statement-breakpoint

-- Rewire devices FK: owner_id → user_id.
ALTER TABLE "devices" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
UPDATE "devices" SET "user_id" = "owner_id";
--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_owner_id_owner_id_fk";
--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "owner_id";
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "devices_owner_idx";
--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");
--> statement-breakpoint

DROP TABLE "owner";
