CREATE TABLE concept_runs (
  clip_id TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  concept TEXT NOT NULL CHECK (length(concept) BETWEEN 1 AND 40),
  outcome TEXT NOT NULL CHECK (outcome IN ('found', 'none', 'not_checked')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 300),
  frames_billed INTEGER NOT NULL DEFAULT 0 CHECK (frames_billed >= 0),
  PRIMARY KEY (clip_id, concept),
  CHECK ((outcome = 'not_checked') = (reason IS NOT NULL))
) STRICT, WITHOUT ROWID;

CREATE TABLE tracks (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  clip_id TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  concept TEXT NOT NULL CHECK (length(concept) BETWEEN 1 AND 40),
  sam_object_id INTEGER NOT NULL CHECK (sam_object_id >= 0),
  frames TEXT NOT NULL CHECK (json_valid(frames) AND json_array_length(frames) > 0),
  UNIQUE (clip_id, concept, sam_object_id)
) STRICT;

CREATE INDEX tracks_by_clip ON tracks (clip_id, concept);
