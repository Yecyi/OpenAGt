CREATE TABLE `calibration_record` (
  `id` text PRIMARY KEY NOT NULL,
  `expert_id` text NOT NULL,
  `workflow` text NOT NULL,
  `prior` real NOT NULL,
  `posterior` real NOT NULL,
  `outcome` real NOT NULL,
  `brier` real NOT NULL,
  `time_recorded` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
CREATE INDEX `calibration_expert_idx` ON `calibration_record` (`expert_id`);
CREATE INDEX `calibration_workflow_idx` ON `calibration_record` (`workflow`);
CREATE INDEX `calibration_time_recorded_idx` ON `calibration_record` (`time_recorded`);
