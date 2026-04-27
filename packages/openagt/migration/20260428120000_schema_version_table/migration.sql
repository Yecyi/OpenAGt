CREATE TABLE `_schema_version` (
  `migration_name` text PRIMARY KEY NOT NULL,
  `applied_at` integer NOT NULL,
  `checksum` text NOT NULL,
  `rollback_sql` text
);
CREATE INDEX `_schema_version_applied_at_idx` ON `_schema_version` (`applied_at`);
