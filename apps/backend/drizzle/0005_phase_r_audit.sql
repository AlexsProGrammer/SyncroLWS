-- Phase R — Audit log.
--
-- Append-only history of meaningful actions. Visibility is enforced at the
-- API layer (`auth.audit.list`), not via row-level security, so the schema
-- itself stays simple. `action` is free-form text validated client-side
-- against the enum in `apps/backend/src/audit.ts`.

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id"              uuid                                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "ts"              timestamp with time zone              NOT NULL DEFAULT now(),
  "actor_user_id"   uuid,
  "actor_device_id" uuid,
  "workspace_id"    text,
  "target_kind"     text,
  "target_id"       text,
  "action"          text                                  NOT NULL,
  "payload"         jsonb                                 NOT NULL DEFAULT '{}'::jsonb,
  "ip_addr"         text
);

CREATE INDEX IF NOT EXISTS "audit_log_ts_idx"     ON "audit_log" ("ts");
CREATE INDEX IF NOT EXISTS "audit_log_actor_idx"  ON "audit_log" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_log_ws_idx"     ON "audit_log" ("workspace_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" ("action");
