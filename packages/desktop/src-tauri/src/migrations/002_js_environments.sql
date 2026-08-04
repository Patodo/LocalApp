CREATE TABLE js_environments (
  environment_key TEXT PRIMARY KEY,
  descriptor_json TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE INDEX idx_js_environments_state_used ON js_environments(state, last_used_at);
