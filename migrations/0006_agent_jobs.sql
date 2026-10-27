CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  walk_id TEXT NOT NULL REFERENCES walks (id) ON DELETE CASCADE,
  trade TEXT NOT NULL CHECK (trade IN ('tree_service', 'brush_clearing', 'debris_hauling', 'roofing_gutters', 'fencing', 'handyman')),
  finding_ids TEXT NOT NULL CHECK (json_valid(finding_ids) AND json_array_length(finding_ids) BETWEEN 1 AND 50),
  zip TEXT NOT NULL CHECK (length(zip) = 5),
  status TEXT NOT NULL CHECK (status IN ('planning', 'waiting_on_homeowner', 'waiting_on_crew', 'scheduled', 'done', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (walk_id, trade)
) STRICT;

CREATE TABLE agent_job_crews (
  job_id TEXT NOT NULL REFERENCES agent_jobs (id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL CHECK (length(crew_id) = 36),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  crew TEXT NOT NULL CHECK (json_valid(crew)),
  PRIMARY KEY (job_id, crew_id),
  UNIQUE (job_id, position)
) STRICT;

CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  job_id TEXT NOT NULL,
  crew_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'text')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sent', 'sent_by_phone', 'replied')),
  subject TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  FOREIGN KEY (job_id, crew_id) REFERENCES agent_job_crews (job_id, crew_id) ON DELETE CASCADE,
  CHECK ((status = 'draft') = (approved_at IS NULL)),
  CHECK ((status IN ('draft', 'approved')) = (sent_at IS NULL)),
  CHECK (channel = 'email' OR subject IS NULL)
) STRICT;

CREATE INDEX agent_messages_by_job ON agent_messages (job_id, crew_id);

CREATE TABLE agent_steps (
  job_id TEXT NOT NULL REFERENCES agent_jobs (id) ON DELETE CASCADE,
  n INTEGER NOT NULL CHECK (n >= 1),
  at TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (length(tool) BETWEEN 1 AND 64),
  arguments TEXT NOT NULL CHECK (length(arguments) <= 20000),
  outcome TEXT NOT NULL CHECK (outcome IN ('ran', 'refused')),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 1000),
  PRIMARY KEY (job_id, n)
) STRICT;

CREATE TRIGGER agent_messages_start_as_draft BEFORE INSERT ON agent_messages
WHEN NEW.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a message is stored as a draft first');
END;

CREATE TRIGGER agent_messages_approve_only_a_draft BEFORE UPDATE ON agent_messages
WHEN NEW.status = 'approved' AND OLD.status <> 'draft' AND OLD.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT, 'only a draft can be approved');
END;

CREATE TRIGGER agent_messages_send_only_approved BEFORE UPDATE ON agent_messages
WHEN NEW.status IN ('sent', 'sent_by_phone') AND OLD.status <> NEW.status AND OLD.status <> 'approved'
BEGIN
  SELECT RAISE(ABORT, 'only an approved message can be sent');
END;

CREATE TRIGGER agent_messages_reply_only_sent BEFORE UPDATE ON agent_messages
WHEN NEW.status = 'replied' AND OLD.status NOT IN ('sent', 'sent_by_phone', 'replied')
BEGIN
  SELECT RAISE(ABORT, 'only a sent message can be replied to');
END;

CREATE TRIGGER agent_messages_never_back_to_draft BEFORE UPDATE ON agent_messages
WHEN NEW.status = 'draft' AND OLD.status <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'a message that has left the draft state never returns to it');
END;

CREATE TRIGGER agent_messages_frozen_after_draft BEFORE UPDATE ON agent_messages
WHEN OLD.status <> 'draft'
  AND (NEW.body IS NOT OLD.body OR NEW.subject IS NOT OLD.subject OR NEW.channel IS NOT OLD.channel OR NEW.crew_id IS NOT OLD.crew_id OR NEW.job_id IS NOT OLD.job_id)
BEGIN
  SELECT RAISE(ABORT, 'a message cannot change once it has left the draft state');
END;
