CREATE TABLE message_approvals (
  message_id TEXT PRIMARY KEY REFERENCES agent_messages (id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64),
  approved_at TEXT NOT NULL,
  photo_keys TEXT NOT NULL CHECK (json_valid(photo_keys) AND json_array_length(photo_keys) BETWEEN 1 AND 50)
) STRICT;

CREATE TRIGGER message_approvals_only_a_draft BEFORE INSERT ON message_approvals
WHEN NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.id = NEW.message_id AND m.status = 'draft')
BEGIN
  SELECT RAISE(ABORT, 'only a draft can be approved');
END;

CREATE TRIGGER message_approvals_only_by_the_homeowner BEFORE INSERT ON message_approvals
WHEN NOT EXISTS (
  SELECT 1 FROM agent_messages m JOIN agent_jobs j ON j.id = m.job_id JOIN walks w ON w.id = j.walk_id
  WHERE m.id = NEW.message_id AND w.visitor_id = NEW.visitor_id
)
BEGIN
  SELECT RAISE(ABORT, 'only the homeowner who made the walk can approve its messages');
END;

CREATE TRIGGER message_approvals_samples_only_on_a_sample_walk BEFORE INSERT ON message_approvals
WHEN EXISTS (
  SELECT 1 FROM agent_messages m
  JOIN agent_jobs j ON j.id = m.job_id
  JOIN walks w ON w.id = j.walk_id
  JOIN agent_job_crews c ON c.job_id = m.job_id AND c.crew_id = m.crew_id
  WHERE m.id = NEW.message_id AND w.synthetic = 1 AND json_extract(c.crew, '$.sample') IS NOT 1
)
BEGIN
  SELECT RAISE(ABORT, 'a sample walk never messages a real business');
END;

CREATE TRIGGER message_approvals_never_change BEFORE UPDATE ON message_approvals
BEGIN
  SELECT RAISE(ABORT, 'an approval never changes');
END;

CREATE TRIGGER agent_messages_approved_by_the_homeowner BEFORE UPDATE ON agent_messages
WHEN NEW.status = 'approved' AND OLD.status = 'draft'
  AND NOT EXISTS (SELECT 1 FROM message_approvals a WHERE a.message_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'a message is approved only by the homeowner');
END;

CREATE TABLE job_addresses (
  job_id TEXT PRIMARY KEY REFERENCES agent_jobs (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (length(token) = 16 AND token NOT GLOB '*[^a-z0-9]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE outbox (
  message_id TEXT PRIMARY KEY REFERENCES agent_messages (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'failed')),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) BETWEEN 1 AND 200),
  error TEXT CHECK (error IS NULL OR length(error) BETWEEN 1 AND 500),
  updated_at TEXT NOT NULL,
  CHECK ((state = 'sent') = (provider_id IS NOT NULL)),
  CHECK ((state = 'failed') = (error IS NOT NULL))
) STRICT;

CREATE TRIGGER outbox_only_approved_email BEFORE INSERT ON outbox
WHEN NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.id = NEW.message_id AND m.status = 'approved' AND m.channel = 'email')
BEGIN
  SELECT RAISE(ABORT, 'only an approved email goes to the outbox');
END;

CREATE TABLE crew_replies (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  message_id TEXT NOT NULL REFERENCES agent_messages (id) ON DELETE CASCADE,
  via TEXT NOT NULL CHECK (via IN ('email', 'homeowner')),
  from_address TEXT CHECK (from_address IS NULL OR length(from_address) BETWEEN 3 AND 320),
  subject TEXT CHECK (subject IS NULL OR length(subject) <= 300),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  received_at TEXT NOT NULL,
  reading TEXT CHECK (reading IS NULL OR json_valid(reading)),
  read_at TEXT,
  CHECK ((reading IS NULL) = (read_at IS NULL)),
  CHECK ((via = 'email') = (from_address IS NOT NULL))
) STRICT;

CREATE INDEX crew_replies_by_message ON crew_replies (message_id, received_at);

CREATE TRIGGER crew_replies_only_to_a_sent_message BEFORE INSERT ON crew_replies
WHEN NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.id = NEW.message_id AND m.status IN ('sent', 'sent_by_phone', 'replied'))
BEGIN
  SELECT RAISE(ABORT, 'a reply is only to a sent message');
END;

CREATE TRIGGER crew_replies_mark_replied AFTER INSERT ON crew_replies
BEGIN
  UPDATE agent_messages SET status = 'replied' WHERE id = NEW.message_id AND status <> 'replied';
  UPDATE follow_ups SET done = 1
  WHERE done = 0 AND for_message_id IN (
    SELECT o.id FROM agent_messages o JOIN agent_messages r ON r.id = NEW.message_id
    WHERE o.job_id = r.job_id AND o.crew_id = r.crew_id
  );
END;

CREATE TABLE finding_marks (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  finding_id TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('needs_fixing', 'fix_planned', 'done')),
  note TEXT NOT NULL CHECK (length(note) <= 200),
  done_on TEXT CHECK (done_on IS NULL OR done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  marked_at TEXT NOT NULL,
  CHECK ((status = 'done') = (done_on IS NOT NULL)),
  CHECK (status = 'fix_planned' OR note = '')
) STRICT;

CREATE INDEX finding_marks_by_finding ON finding_marks (finding_id, marked_at);

CREATE TRIGGER finding_marks_set_status AFTER INSERT ON finding_marks
BEGIN
  UPDATE findings SET status = NEW.status WHERE id = NEW.finding_id;
END;

CREATE TRIGGER finding_marks_never_change BEFORE UPDATE ON finding_marks
BEGIN
  SELECT RAISE(ABORT, 'a mark is kept as it was made');
END;

CREATE TABLE job_crew_cards (
  job_id TEXT NOT NULL,
  crew_id TEXT NOT NULL,
  card TEXT NOT NULL CHECK (json_valid(card) AND length(card) <= 4000),
  PRIMARY KEY (job_id, crew_id),
  FOREIGN KEY (job_id, crew_id) REFERENCES agent_job_crews (job_id, crew_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE mail_optouts (
  address TEXT PRIMARY KEY CHECK (length(address) BETWEEN 3 AND 320 AND address = lower(address)),
  requested_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER outbox_never_to_an_optout BEFORE INSERT ON outbox
WHEN EXISTS (
  SELECT 1 FROM agent_messages m
  JOIN agent_job_crews c ON c.job_id = m.job_id AND c.crew_id = m.crew_id
  JOIN mail_optouts o ON o.address = lower(json_extract(c.crew, '$.email'))
  WHERE m.id = NEW.message_id
)
BEGIN
  SELECT RAISE(ABORT, 'that address asked to be taken off the list');
END;

CREATE TABLE get_it_fixed_uses (
  kind TEXT NOT NULL CHECK (kind IN ('draft_run', 'reply_read', 'followup_run')),
  subject_id TEXT NOT NULL CHECK (length(subject_id) = 36),
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (kind, subject_id)
) STRICT;
