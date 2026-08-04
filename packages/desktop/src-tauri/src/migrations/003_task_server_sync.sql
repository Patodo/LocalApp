ALTER TABLE local_tasks
ADD COLUMN server_sync_pending INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_local_tasks_server_sync
ON local_tasks(server_sync_pending, updated_at);
