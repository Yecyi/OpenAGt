CREATE TABLE `prompt_outcome` (
  `id` text PRIMARY KEY NOT NULL,
  `role` text NOT NULL,
  `variant` text NOT NULL,
  `task_id` text,
  `expert_id` text,
  `success` integer NOT NULL,
  `quality` real,
  `duration_ms` integer,
  `time_recorded` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
CREATE INDEX `prompt_outcome_role_variant_idx` ON `prompt_outcome` (`role`, `variant`);
CREATE INDEX `prompt_outcome_time_recorded_idx` ON `prompt_outcome` (`time_recorded`);
