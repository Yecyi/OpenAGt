CREATE TABLE `personal_memory_idempotency` (
  `tag` text PRIMARY KEY NOT NULL,
  `note_id` text NOT NULL,
  `time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personal_memory_idempotency_note_idx` ON `personal_memory_idempotency` (`note_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `personal_memory_idempotency` (`tag`, `note_id`, `time_created`)
SELECT json_each.value, personal_memory_note.id, personal_memory_note.time_created
FROM personal_memory_note, json_each(personal_memory_note.tags)
WHERE typeof(json_each.value) = 'text';
