ALTER TABLE `personal_memory_note` ADD `kind` text NOT NULL DEFAULT 'belief';
--> statement-breakpoint
CREATE INDEX `personal_memory_kind_idx` ON `personal_memory_note` (`kind`);
