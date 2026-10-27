ALTER TABLE walks ADD COLUMN failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 60);
ALTER TABLE walks ADD COLUMN failure_message TEXT CHECK (failure_message IS NULL OR length(failure_message) BETWEEN 1 AND 300);

CREATE TABLE tags (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('loop', 'pan')),
  start_seconds REAL NOT NULL CHECK (start_seconds >= 0),
  end_seconds REAL NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  samples TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(samples)),
  property_line TEXT CHECK (property_line IS NULL OR json_valid(property_line)),
  CHECK (start_seconds < end_seconds),
  CHECK (property_line IS NULL OR kind = 'pan')
) STRICT;

CREATE INDEX tags_by_walk ON tags (walk_id, start_seconds);

CREATE TABLE clips (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('loop', 'pan')),
  file TEXT NOT NULL CHECK (length(file) BETWEEN 1 AND 420),
  fps REAL NOT NULL CHECK (fps > 0 AND fps <= 60),
  frame_count INTEGER NOT NULL CHECK (frame_count > 0),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 8192),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 8192),
  UNIQUE (walk_id, kind)
) STRICT;
