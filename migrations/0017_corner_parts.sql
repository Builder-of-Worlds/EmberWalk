CREATE TABLE walk_parts (
  walk_id TEXT PRIMARY KEY REFERENCES walks (id) ON DELETE CASCADE,
  part_of TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE CHECK (length(part_of) = 36),
  part TEXT NOT NULL CHECK (part IN ('front', 'right', 'back', 'left', 'front_right', 'back_right', 'back_left', 'front_left')),
  CHECK (part_of <> walk_id)
) STRICT;

INSERT INTO walk_parts (walk_id, part_of, part) SELECT id, part_of, part_side FROM walks WHERE part_of IS NOT NULL;

CREATE INDEX walk_parts_by_parent ON walk_parts (part_of, part);

CREATE TRIGGER walk_parts_leave_with_parent AFTER DELETE ON walk_parts BEGIN
  DELETE FROM walks WHERE id = OLD.walk_id;
END;

CREATE TABLE walk_gaps_0017 (
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('front', 'right', 'back', 'left', 'front_right', 'back_right', 'back_left', 'front_left')),
  kind TEXT NOT NULL CHECK (kind IN ('missing', 'dark', 'first_five_feet', 'not_checked')),
  hint TEXT NOT NULL CHECK (
    kind = 'missing' AND hint = 'walk_side' AND side IN ('front', 'right', 'back', 'left')
    OR kind = 'missing' AND hint = 'pan_corner' AND side IN ('front_right', 'back_right', 'back_left', 'front_left')
    OR kind = 'dark' AND hint = 'more_light'
    OR kind = 'first_five_feet' AND hint IN ('tilt_down', 'step_back')
    OR kind = 'not_checked' AND hint = 'again'
  ),
  PRIMARY KEY (walk_id, side, kind)
) STRICT;

INSERT INTO walk_gaps_0017 (walk_id, side, kind, hint) SELECT walk_id, side, kind, hint FROM walk_gaps;

DROP TABLE walk_gaps;

ALTER TABLE walk_gaps_0017 RENAME TO walk_gaps;
