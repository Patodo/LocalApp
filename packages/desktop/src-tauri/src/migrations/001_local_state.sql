CREATE TABLE desktop_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id TEXT NOT NULL DEFAULT '',
  launch_at_login INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  npm_registry TEXT,
  http_proxy TEXT,
  https_proxy TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE app_trusts (
  server_origin TEXT NOT NULL,
  app_owner TEXT NOT NULL,
  app_name TEXT NOT NULL,
  publisher_user_id TEXT NOT NULL,
  publisher_display_name TEXT,
  trusted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (server_origin, app_owner, app_name, publisher_user_id)
);

CREATE TABLE local_tasks (
  request_id TEXT PRIMARY KEY,
  server_origin TEXT NOT NULL,
  app_owner TEXT NOT NULL,
  app_name TEXT NOT NULL,
  app_version TEXT,
  publisher_user_id TEXT NOT NULL,
  publisher_display_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  script TEXT NOT NULL,
  dependencies_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  environment_key TEXT,
  result_json TEXT,
  error_code TEXT,
  error_summary TEXT,
  stdout_path TEXT NOT NULL,
  stderr_path TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_local_tasks_status_updated ON local_tasks(status, updated_at DESC);
CREATE INDEX idx_local_tasks_completed ON local_tasks(completed_at, pinned);
