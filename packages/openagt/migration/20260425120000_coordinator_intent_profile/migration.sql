ALTER TABLE `coordinator_run` ADD `intent` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `coordinator_run` ADD `mode` text NOT NULL DEFAULT 'autonomous';
--> statement-breakpoint
ALTER TABLE `coordinator_run` ADD `workflow` text NOT NULL DEFAULT 'coding';
