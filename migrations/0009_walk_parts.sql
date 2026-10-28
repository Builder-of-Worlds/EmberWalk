ALTER TABLE walks ADD COLUMN part_of TEXT REFERENCES walks (id) ON DELETE CASCADE CHECK (part_of IS NULL OR (length(part_of) = 36 AND part_of <> id));
ALTER TABLE walks ADD COLUMN part_side TEXT CHECK ((part_side IS NULL) = (part_of IS NULL) AND (part_side IS NULL OR part_side IN ('front', 'right', 'back', 'left')));

CREATE INDEX walks_by_part ON walks (part_of, part_side, created_at) WHERE part_of IS NOT NULL;

CREATE TABLE walk_gaps (
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('front', 'right', 'back', 'left')),
  kind TEXT NOT NULL CHECK (kind IN ('missing', 'dark', 'first_five_feet', 'not_checked')),
  hint TEXT NOT NULL CHECK (
    kind = 'missing' AND hint = 'walk_side'
    OR kind = 'dark' AND hint = 'more_light'
    OR kind = 'first_five_feet' AND hint IN ('tilt_down', 'step_back')
    OR kind = 'not_checked' AND hint = 'again'
  ),
  PRIMARY KEY (walk_id, side, kind)
) STRICT;
