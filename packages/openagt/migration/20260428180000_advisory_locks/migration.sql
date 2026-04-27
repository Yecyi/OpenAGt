CREATE TABLE `_advisory_lock` (
  `name` text PRIMARY KEY NOT NULL,
  `pid` integer NOT NULL,
  `machine_id` text NOT NULL,
  `acquired_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
CREATE INDEX `_advisory_lock_expires_idx` ON `_advisory_lock` (`expires_at`);
