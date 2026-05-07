CREATE TABLE `coordinator_event` (
  `event_id` text PRIMARY KEY NOT NULL,
  `ts` integer NOT NULL,
  `session_id` text NOT NULL,
  `run_id` text,
  `task_id` text,
  `expert_id` text,
  `workflow` text,
  `effort` text,
  `event_kind` text NOT NULL,
  `payload_json` text NOT NULL,
  `schema_version` integer NOT NULL,
  `idempotency_key` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coordinator_event_session_ts_idx` ON `coordinator_event` (`session_id`, `ts`);
--> statement-breakpoint
CREATE INDEX `coordinator_event_run_ts_idx` ON `coordinator_event` (`run_id`, `ts`);
--> statement-breakpoint
CREATE INDEX `coordinator_event_kind_ts_idx` ON `coordinator_event` (`event_kind`, `ts`);
--> statement-breakpoint
CREATE INDEX `coordinator_event_expert_workflow_idx` ON `coordinator_event` (`expert_id`, `workflow`);
--> statement-breakpoint
CREATE UNIQUE INDEX `coordinator_event_idempotency_idx` ON `coordinator_event` (`idempotency_key`);
