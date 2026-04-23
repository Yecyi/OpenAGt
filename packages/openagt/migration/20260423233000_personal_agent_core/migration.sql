CREATE TABLE `coordinator_run` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`goal` text NOT NULL,
	`state` text NOT NULL,
	`plan` text NOT NULL,
	`task_ids` text NOT NULL,
	`summary` text,
	`time_finished` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_coordinator_run_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `coordinator_session_idx` ON `coordinator_run` (`session_id`);
--> statement-breakpoint
CREATE INDEX `coordinator_state_idx` ON `coordinator_run` (`state`);
--> statement-breakpoint
CREATE TABLE `personal_memory_note` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text NOT NULL,
	`source` text NOT NULL,
	`importance` integer NOT NULL DEFAULT 0,
	`pinned` integer NOT NULL DEFAULT 0,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_personal_memory_note_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_personal_memory_note_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `personal_memory_scope_idx` ON `personal_memory_note` (`scope`);
--> statement-breakpoint
CREATE INDEX `personal_memory_project_idx` ON `personal_memory_note` (`project_id`);
--> statement-breakpoint
CREATE INDEX `personal_memory_session_idx` ON `personal_memory_note` (`session_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `personal_memory_fts` USING fts5(
	`note_id` UNINDEXED,
	`title`,
	`content`
);
--> statement-breakpoint
CREATE TRIGGER `personal_memory_ai` AFTER INSERT ON `personal_memory_note` BEGIN
  INSERT INTO `personal_memory_fts` (`note_id`, `title`, `content`)
  VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `personal_memory_ad` AFTER DELETE ON `personal_memory_note` BEGIN
  DELETE FROM `personal_memory_fts` WHERE `note_id` = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `personal_memory_au` AFTER UPDATE ON `personal_memory_note` BEGIN
  DELETE FROM `personal_memory_fts` WHERE `note_id` = old.id;
  INSERT INTO `personal_memory_fts` (`note_id`, `title`, `content`)
  VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TABLE `inbox_item` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`source` text NOT NULL,
	`scope` text NOT NULL,
	`goal` text NOT NULL,
	`context_refs` text NOT NULL,
	`priority` text NOT NULL,
	`state` text NOT NULL,
	`scheduled_for` integer,
	`payload` text,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_inbox_item_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_inbox_item_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `inbox_project_idx` ON `inbox_item` (`project_id`);
--> statement-breakpoint
CREATE INDEX `inbox_session_idx` ON `inbox_item` (`session_id`);
--> statement-breakpoint
CREATE INDEX `inbox_state_idx` ON `inbox_item` (`state`);
--> statement-breakpoint
CREATE TABLE `scheduled_wakeup` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text,
	`inbox_item_id` text,
	`goal` text NOT NULL,
	`context_refs` text NOT NULL,
	`priority` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`state` text NOT NULL,
	`payload` text,
	`time_fired` integer,
	`time_completed` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_scheduled_wakeup_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_scheduled_wakeup_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_scheduled_wakeup_inbox_item_id_inbox_item_id_fk` FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_item`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `wakeup_project_idx` ON `scheduled_wakeup` (`project_id`);
--> statement-breakpoint
CREATE INDEX `wakeup_state_idx` ON `scheduled_wakeup` (`state`);
--> statement-breakpoint
CREATE INDEX `wakeup_scheduled_for_idx` ON `scheduled_wakeup` (`scheduled_for`);
