CREATE TABLE inspection_messages (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  walk_id TEXT NOT NULL UNIQUE REFERENCES walks (id) ON DELETE CASCADE,
  agency TEXT NOT NULL CHECK (length(agency) BETWEEN 1 AND 200),
  to_address TEXT NOT NULL CHECK (length(to_address) BETWEEN 3 AND 320),
  source TEXT NOT NULL CHECK (source GLOB 'https://*' AND length(source) <= 500),
  read_on TEXT NOT NULL CHECK (read_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sent')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  CHECK ((status = 'draft') = (approved_at IS NULL)),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
) STRICT;

CREATE TABLE inspection_approvals (
  message_id TEXT PRIMARY KEY REFERENCES inspection_messages (id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64),
  approved_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER inspection_approvals_only_a_draft BEFORE INSERT ON inspection_approvals
WHEN NOT EXISTS (SELECT 1 FROM inspection_messages m WHERE m.id = NEW.message_id AND m.status = 'draft')
BEGIN
  SELECT RAISE(ABORT, 'only a draft can be approved');
END;

CREATE TRIGGER inspection_approvals_only_by_the_homeowner BEFORE INSERT ON inspection_approvals
WHEN NOT EXISTS (
  SELECT 1 FROM inspection_messages m JOIN walks w ON w.id = m.walk_id
  WHERE m.id = NEW.message_id AND (
    w.visitor_id = NEW.visitor_id
    OR EXISTS (
      SELECT 1 FROM property_walks pw JOIN properties p ON p.id = pw.property_id JOIN portfolios o ON o.id = p.portfolio_id JOIN sessions s ON s.account_id = o.account_id
      WHERE pw.walk_id = w.id AND s.visitor_id = NEW.visitor_id AND s.ended_at IS NULL
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'only the homeowner who made the walk can approve its messages');
END;

CREATE TRIGGER inspection_approvals_never_on_a_sample_walk BEFORE INSERT ON inspection_approvals
WHEN EXISTS (
  SELECT 1 FROM inspection_messages m JOIN walks w ON w.id = m.walk_id
  WHERE m.id = NEW.message_id AND w.synthetic = 1
)
BEGIN
  SELECT RAISE(ABORT, 'a sample walk never messages a fire department');
END;

CREATE TRIGGER inspection_approvals_never_change BEFORE UPDATE ON inspection_approvals
BEGIN
  SELECT RAISE(ABORT, 'an approval never changes');
END;

CREATE TRIGGER inspection_messages_approved_by_the_homeowner BEFORE UPDATE ON inspection_messages
WHEN NEW.status = 'approved' AND OLD.status = 'draft'
  AND NOT EXISTS (SELECT 1 FROM inspection_approvals a WHERE a.message_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'a message is approved only by the homeowner');
END;

CREATE TABLE inspection_outbox (
  message_id TEXT PRIMARY KEY REFERENCES inspection_messages (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'failed')),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) BETWEEN 1 AND 200),
  error TEXT CHECK (error IS NULL OR length(error) BETWEEN 1 AND 500),
  updated_at TEXT NOT NULL,
  CHECK ((state = 'sent') = (provider_id IS NOT NULL)),
  CHECK ((state = 'failed') = (error IS NOT NULL))
) STRICT;

CREATE TRIGGER inspection_outbox_only_approved BEFORE INSERT ON inspection_outbox
WHEN NOT EXISTS (SELECT 1 FROM inspection_messages m WHERE m.id = NEW.message_id AND m.status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'only an approved message goes to the outbox');
END;

CREATE TABLE inspection_replies (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  message_id TEXT NOT NULL REFERENCES inspection_messages (id) ON DELETE CASCADE,
  from_address TEXT NOT NULL CHECK (length(from_address) BETWEEN 3 AND 320),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  received_at TEXT NOT NULL
) STRICT;

CREATE INDEX inspection_replies_by_message ON inspection_replies (message_id, received_at);

CREATE TRIGGER inspection_replies_only_to_a_sent_message BEFORE INSERT ON inspection_replies
WHEN NOT EXISTS (SELECT 1 FROM inspection_messages m WHERE m.id = NEW.message_id AND m.status = 'sent')
BEGIN
  SELECT RAISE(ABORT, 'a reply is only to a sent message');
END;
