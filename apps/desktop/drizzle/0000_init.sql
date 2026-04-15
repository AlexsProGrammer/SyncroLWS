CREATE TABLE `active_tools` (
	`profile_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `base_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `local_files` (
	`hash` text PRIMARY KEY NOT NULL,
	`local_path` text NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer NOT NULL,
	`reference_count` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
