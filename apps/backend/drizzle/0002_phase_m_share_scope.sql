-- Phase M — extend share_links with scope + label
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "profile_id" text NOT NULL DEFAULT '';
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "workspace_id" text NOT NULL DEFAULT '';
ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "label" text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "share_links_scope_idx" ON "share_links" USING btree ("profile_id","workspace_id");
