DELETE FROM `coordinator_event`
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM `coordinator_event` GROUP BY `idempotency_key`
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `coordinator_event_session_ts_idx` ON `coordinator_event` (`session_id`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `coordinator_event_run_ts_idx` ON `coordinator_event` (`run_id`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `coordinator_event_kind_ts_idx` ON `coordinator_event` (`event_kind`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `coordinator_event_expert_workflow_idx` ON `coordinator_event` (`expert_id`, `workflow`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `coordinator_event_idempotency_idx` ON `coordinator_event` (`idempotency_key`);
