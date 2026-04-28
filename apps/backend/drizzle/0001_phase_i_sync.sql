-- Phase I: hybrid sync schema
-- Rewrites base_entities to the Phase F hybrid shape and introduces the global
-- monotonic revision sequence, entity_aspects, entity_relations, tombstones.
--
-- This is destructive: any rows in base_entities from earlier dev runs are
-- dropped (they used the legacy type/payload model and have no path forward).

DROP INDEX IF EXISTS "base_entities_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "base_entities_parent_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "base_entities_deleted_at_idx";--> statement-breakpoint
DROP TABLE IF EXISTS "base_entities";--> statement-breakpoint

CREATE SEQUENCE IF NOT EXISTS "sync_revision" AS bigint START WITH 1 INCREMENT BY 1;--> statement-breakpoint

CREATE TABLE "base_entities" (
        "id" uuid PRIMARY KEY NOT NULL,
        "profile_id" text NOT NULL,
        "workspace_id" text NOT NULL,
        "title" text DEFAULT '' NOT NULL,
        "description" text DEFAULT '' NOT NULL,
        "description_json" text,
        "color" text DEFAULT '#6366f1' NOT NULL,
        "icon" text DEFAULT 'box' NOT NULL,
        "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "parent_id" uuid,
        "created_at" timestamp with time zone NOT NULL,
        "updated_at" timestamp with time zone NOT NULL,
        "deleted_at" timestamp with time zone,
        "revision" bigint NOT NULL,
        "last_modified_by_device" uuid
);--> statement-breakpoint
CREATE INDEX "base_entities_scope_idx" ON "base_entities" USING btree ("profile_id","workspace_id");--> statement-breakpoint
CREATE INDEX "base_entities_revision_idx" ON "base_entities" USING btree ("revision");--> statement-breakpoint
CREATE INDEX "base_entities_parent_idx" ON "base_entities" USING btree ("parent_id");--> statement-breakpoint

CREATE TABLE "entity_aspects" (
        "id" uuid PRIMARY KEY NOT NULL,
        "entity_id" uuid NOT NULL,
        "profile_id" text NOT NULL,
        "workspace_id" text NOT NULL,
        "aspect_type" text NOT NULL,
        "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "tool_instance_id" text,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        "updated_at" timestamp with time zone NOT NULL,
        "deleted_at" timestamp with time zone,
        "revision" bigint NOT NULL,
        "last_modified_by_device" uuid
);--> statement-breakpoint
CREATE INDEX "entity_aspects_scope_idx" ON "entity_aspects" USING btree ("profile_id","workspace_id");--> statement-breakpoint
CREATE INDEX "entity_aspects_entity_idx" ON "entity_aspects" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_aspects_revision_idx" ON "entity_aspects" USING btree ("revision");--> statement-breakpoint

CREATE TABLE "entity_relations" (
        "id" uuid PRIMARY KEY NOT NULL,
        "profile_id" text NOT NULL,
        "workspace_id" text NOT NULL,
        "from_entity_id" uuid NOT NULL,
        "to_entity_id" uuid NOT NULL,
        "kind" text NOT NULL,
        "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp with time zone NOT NULL,
        "revision" bigint NOT NULL,
        "last_modified_by_device" uuid
);--> statement-breakpoint
CREATE INDEX "entity_relations_scope_idx" ON "entity_relations" USING btree ("profile_id","workspace_id");--> statement-breakpoint
CREATE INDEX "entity_relations_from_idx" ON "entity_relations" USING btree ("from_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relations_revision_idx" ON "entity_relations" USING btree ("revision");--> statement-breakpoint

CREATE TABLE "tombstones" (
        "kind" text NOT NULL,
        "id" uuid NOT NULL,
        "profile_id" text NOT NULL,
        "workspace_id" text NOT NULL,
        "revision" bigint NOT NULL,
        "deleted_at" timestamp with time zone NOT NULL,
        "last_modified_by_device" uuid,
        CONSTRAINT "tombstones_pk" PRIMARY KEY ("kind","id")
);--> statement-breakpoint
CREATE INDEX "tombstones_scope_idx" ON "tombstones" USING btree ("profile_id","workspace_id");--> statement-breakpoint
CREATE INDEX "tombstones_revision_idx" ON "tombstones" USING btree ("revision");
