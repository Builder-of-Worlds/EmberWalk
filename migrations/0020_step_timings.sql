CREATE TABLE step_timings (
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (length(step) BETWEEN 1 AND 64),
  started_at TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  day TEXT NOT NULL CHECK (day = substr(started_at, 1, 10)),
  ms INTEGER NOT NULL CHECK (ms >= 0)
) STRICT;

CREATE INDEX step_timings_by_day ON step_timings (day, step, ms);
CREATE INDEX step_timings_by_walk ON step_timings (walk_id);
