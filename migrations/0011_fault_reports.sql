CREATE TABLE fault_reports (
  walk_id TEXT NOT NULL CHECK (length(walk_id) = 36),
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  build TEXT NOT NULL CHECK (length(build) BETWEEN 1 AND 40),
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (walk_id, code, build)
) STRICT;

CREATE INDEX fault_reports_by_last_seen ON fault_reports (last_at);
