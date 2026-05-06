CREATE TABLE `task_outcome` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_session_id` text NOT NULL,
  `task_id` text NOT NULL,
  `child_session_id` text NOT NULL,
  `status` text NOT NULL,
  `task_kind` text NOT NULL,
  `subagent_type` text NOT NULL,
  `description` text NOT NULL,
  `attempt_no` integer NOT NULL,
  `previous_outcome_id` text,
  `retryable` integer DEFAULT 0 NOT NULL,
  `limit_reason` text,
  `summary` text,
  `result_text` text,
  `error_text` text,
  `verdict` text,
  `metadata` text NOT NULL,
  `usage` text,
  `time_recorded` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_outcome_parent_task_idx` ON `task_outcome` (`parent_session_id`, `task_id`);
--> statement-breakpoint
CREATE INDEX `task_outcome_parent_status_idx` ON `task_outcome` (`parent_session_id`, `status`);
--> statement-breakpoint
CREATE INDEX `task_outcome_task_attempt_idx` ON `task_outcome` (`task_id`, `attempt_no`);
--> statement-breakpoint
CREATE INDEX `task_outcome_time_recorded_idx` ON `task_outcome` (`time_recorded`);
