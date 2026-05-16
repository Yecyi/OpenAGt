CREATE INDEX IF NOT EXISTS `personal_memory_query_idx` ON `personal_memory_note` (`scope`, `kind`, `project_id`, `session_id`, `time_updated`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `personal_memory_project_time_idx` ON `personal_memory_note` (`project_id`, `time_updated`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `inbox_project_state_time_idx` ON `inbox_item` (`project_id`, `state`, `time_updated`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wakeup_project_state_due_idx` ON `scheduled_wakeup` (`project_id`, `state`, `scheduled_for`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_snapshot` (
  `id` text PRIMARY KEY NOT NULL,
  `aggregate_id` text NOT NULL,
  `adapter_id` text NOT NULL,
  `seq` integer NOT NULL,
  `schema_version` integer NOT NULL,
  `projector_version` text NOT NULL,
  `payload` text NOT NULL,
  `time_created` integer NOT NULL,
  FOREIGN KEY (`aggregate_id`) REFERENCES `event_sequence`(`aggregate_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_snapshot_aggregate_seq_idx` ON `event_snapshot` (`aggregate_id`, `seq`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_snapshot_adapter_idx` ON `event_snapshot` (`adapter_id`, `aggregate_id`);
