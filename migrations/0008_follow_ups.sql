CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  job_id TEXT NOT NULL REFERENCES agent_jobs (id) ON DELETE CASCADE,
  for_message_id TEXT NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  draft_message_id TEXT REFERENCES agent_messages (id) ON DELETE SET NULL,
  done INTEGER NOT NULL CHECK (done IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (for_message_id),
  CHECK (draft_message_id IS NULL OR draft_message_id <> for_message_id)
) STRICT;

CREATE INDEX follow_ups_by_job ON follow_ups (job_id, due_at);

CREATE INDEX follow_ups_open ON follow_ups (due_at) WHERE done = 0;

CREATE TRIGGER follow_ups_only_for_a_sent_message BEFORE INSERT ON follow_ups
WHEN NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.id = NEW.for_message_id AND m.status IN ('sent', 'sent_by_phone'))
BEGIN
  SELECT RAISE(ABORT, 'a follow up is only for a sent message');
END;

CREATE TRIGGER follow_ups_only_on_its_own_job BEFORE INSERT ON follow_ups
WHEN NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.id = NEW.for_message_id AND m.job_id = NEW.job_id)
BEGIN
  SELECT RAISE(ABORT, 'a follow up is only for a message on its own job');
END;

CREATE TRIGGER follow_ups_draft_on_insert BEFORE INSERT ON follow_ups
WHEN NEW.draft_message_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM agent_messages d JOIN agent_messages f ON f.id = NEW.for_message_id
  WHERE d.id = NEW.draft_message_id AND d.status = 'draft' AND d.job_id = f.job_id AND d.crew_id = f.crew_id
)
BEGIN
  SELECT RAISE(ABORT, 'a follow up draft must be a draft to the same crew on the same job');
END;

CREATE TRIGGER follow_ups_draft_on_update BEFORE UPDATE OF draft_message_id ON follow_ups
WHEN NEW.draft_message_id IS NOT NULL AND NEW.draft_message_id IS NOT OLD.draft_message_id AND NOT EXISTS (
  SELECT 1 FROM agent_messages d JOIN agent_messages f ON f.id = NEW.for_message_id
  WHERE d.id = NEW.draft_message_id AND d.status = 'draft' AND d.job_id = f.job_id AND d.crew_id = f.crew_id
)
BEGIN
  SELECT RAISE(ABORT, 'a follow up draft must be a draft to the same crew on the same job');
END;

CREATE TRIGGER follow_ups_never_move BEFORE UPDATE ON follow_ups
WHEN NEW.for_message_id IS NOT OLD.for_message_id OR NEW.job_id IS NOT OLD.job_id
BEGIN
  SELECT RAISE(ABORT, 'a follow up cannot move to another message or job');
END;

CREATE TRIGGER follow_ups_never_reopen BEFORE UPDATE OF done ON follow_ups
WHEN OLD.done = 1 AND NEW.done = 0
BEGIN
  SELECT RAISE(ABORT, 'a closed follow up is never reopened');
END;
