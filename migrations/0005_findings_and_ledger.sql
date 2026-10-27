CREATE TABLE findings (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  concept TEXT NOT NULL CHECK (length(concept) BETWEEN 1 AND 40),
  track_ids TEXT NOT NULL CHECK (json_valid(track_ids)),
  band TEXT NOT NULL CHECK (band IN ('zone_0', 'zone_1', 'zone_2')),
  distance_low REAL NOT NULL CHECK (distance_low >= 0),
  distance_high REAL NOT NULL CHECK (distance_high >= distance_low),
  contact TEXT NOT NULL CHECK (contact IN ('yes', 'no', 'not_checked')),
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
  rank INTEGER NOT NULL CHECK (rank > 0),
  proof_clip_id TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  proof_frame INTEGER NOT NULL CHECK (proof_frame >= 0),
  proof_still TEXT NOT NULL CHECK (length(proof_still) BETWEEN 1 AND 420),
  rule_ids TEXT NOT NULL CHECK (json_valid(rule_ids)),
  label TEXT NOT NULL CHECK (label IN ('required_now', 'recommended')),
  instruction TEXT NOT NULL CHECK (length(instruction) BETWEEN 1 AND 500),
  plant_state TEXT CHECK (plant_state IS NULL OR plant_state IN ('dead', 'alive', 'unsure')),
  spacing TEXT CHECK (spacing IS NULL OR spacing IN ('ok', 'too_close', 'not_checked')),
  voice_note TEXT CHECK (voice_note IS NULL OR length(voice_note) BETWEEN 1 AND 2000),
  veto_reason TEXT CHECK (veto_reason IS NULL OR length(veto_reason) BETWEEN 1 AND 300),
  source TEXT NOT NULL CHECK (source IN ('found', 'tapped')),
  status TEXT NOT NULL CHECK (status IN ('needs_fixing', 'fix_planned', 'done')),
  UNIQUE (walk_id, rank)
) STRICT;

CREATE TABLE cost_records (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  at TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  step TEXT NOT NULL,
  walk_id TEXT,
  units_kind TEXT NOT NULL CHECK (units_kind IN ('frames', 'images', 'tokens', 'seconds')),
  units_count INTEGER NOT NULL CHECK (units_count >= 0),
  unit_price_nano INTEGER NOT NULL CHECK (unit_price_nano >= 0),
  total_nano INTEGER NOT NULL CHECK (total_nano >= 0),
  cached INTEGER NOT NULL CHECK (cached IN (0, 1)),
  CHECK (cached = 0 OR total_nano = 0)
) STRICT;

CREATE INDEX cost_records_by_day ON cost_records (day);

CREATE TABLE cache_entries (
  fingerprint TEXT PRIMARY KEY CHECK (length(fingerprint) = 64),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 420)
) STRICT;
