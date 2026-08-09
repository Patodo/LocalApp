CREATE TABLE local_inbox_items (
    id TEXT PRIMARY KEY,
    app_owner TEXT NOT NULL,
    app_name TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    url TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at INTEGER NOT NULL,
    read_at INTEGER
);

CREATE INDEX idx_local_inbox_created_at
ON local_inbox_items(created_at DESC);

CREATE TABLE local_favorites (
    stored_page_path TEXT PRIMARY KEY,
    app_path TEXT NOT NULL,
    page_name TEXT,
    owner_name TEXT,
    created_at INTEGER NOT NULL
);
