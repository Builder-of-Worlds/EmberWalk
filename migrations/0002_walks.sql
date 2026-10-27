CREATE TABLE walks (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  state TEXT NOT NULL CHECK (state IN ('recording', 'uploading', 'queued', 'processing', 'done', 'failed')),
  step TEXT CHECK (step IN ('prepare', 'segment', 'transcribe', 'score', 'explain', 'second_check', 'preview', 'tap', 'report', 'recheck')),
  length_seconds REAL NOT NULL DEFAULT 0 CHECK (length_seconds >= 0),
  language TEXT NOT NULL CHECK (language IN ('en', 'es')),
  jurisdiction TEXT NOT NULL,
  share_code TEXT UNIQUE CHECK (share_code IS NULL OR length(share_code) = 10),
  device_camera TEXT NOT NULL,
  device_width INTEGER NOT NULL CHECK (device_width BETWEEN 1 AND 8192),
  device_height INTEGER NOT NULL CHECK (device_height BETWEEN 1 AND 8192),
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
  motion_file TEXT,
  CHECK ((state IN ('processing', 'failed')) = (step IS NOT NULL))
) STRICT;

CREATE INDEX walks_by_visitor ON walks (visitor_id, created_at);
