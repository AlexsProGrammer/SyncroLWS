-- Phase Q — Workspace ACL.
--
-- Adds first-class `workspaces` and `workspace_members`. Existing
-- `base_entities.workspace_id` (text) is the foreign key target, so we
-- declare `workspaces.id` as text to match without rewriting historical rows.
--
-- For backward compat with personal-mode (device-token) sync, we DO NOT
-- enforce a FK from base_entities.workspace_id → workspaces.id. Personal
-- workspaces live only on the desktop and never get a server-side workspaces
-- row; the sync engine's workspace filter for device tokens still runs the
-- legacy `profile_id` predicate.

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id"            text                                 PRIMARY KEY,
  "owner_user_id" uuid                                 NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"          text                                 NOT NULL,
  "icon"          text                                 NOT NULL DEFAULT 'folder',
  "color"         text                                 NOT NULL DEFAULT '#6366f1',
  "created_at"    timestamp with time zone             NOT NULL DEFAULT now(),
  "deleted_at"    timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "workspaces_owner_idx"   ON "workspaces" ("owner_user_id");
CREATE INDEX IF NOT EXISTS "workspaces_deleted_idx" ON "workspaces" ("deleted_at");

CREATE TABLE IF NOT EXISTS "workspace_members" (
  "workspace_id" text                                  NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id"      uuid                                  NOT NULL REFERENCES "users"("id")      ON DELETE CASCADE,
  "role"         text                                  NOT NULL DEFAULT 'viewer',
  "invited_by"   uuid,
  "accepted_at"  timestamp with time zone,
  "created_at"   timestamp with time zone              NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "workspace_members_user_idx" ON "workspace_members" ("user_id");
CREATE INDEX IF NOT EXISTS "workspace_members_ws_idx"   ON "workspace_members" ("workspace_id");
