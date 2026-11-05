CREATE TABLE accounts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  email TEXT NOT NULL UNIQUE CHECK (
    length(email) BETWEEN 5 AND 254 AND email = lower(email) AND email NOT GLOB '*[^!-~]*'
    AND length(email) - length(replace(email, '@', '')) = 1 AND email GLOB '?*@?*.?*' AND email NOT GLOB '*@.*' AND email NOT GLOB '*.'
  ),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE TABLE sign_in_links (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  email TEXT NOT NULL CHECK (
    length(email) BETWEEN 5 AND 254 AND email = lower(email) AND email NOT GLOB '*[^!-~]*'
    AND length(email) - length(replace(email, '@', '')) = 1 AND email GLOB '?*@?*.?*' AND email NOT GLOB '*@.*' AND email NOT GLOB '*.'
  ),
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64 AND visitor_id NOT GLOB '*[^0-9a-f]*'),
  ip_hash TEXT CHECK (ip_hash IS NULL OR (length(ip_hash) = 64 AND ip_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(expires_at) > julianday(created_at)),
  used_at TEXT CHECK (used_at IS NULL OR (used_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(used_at) >= julianday(created_at)))
) STRICT;

CREATE INDEX sign_in_links_by_email ON sign_in_links (email, created_at);
CREATE INDEX sign_in_links_by_visitor ON sign_in_links (visitor_id, created_at);
CREATE INDEX sign_in_links_by_ip ON sign_in_links (ip_hash, created_at);
CREATE INDEX sign_in_links_by_time ON sign_in_links (created_at);

CREATE TRIGGER sign_in_links_used_once BEFORE UPDATE ON sign_in_links WHEN OLD.used_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a sign in link is used once');
END;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL CHECK (length(visitor_id) = 64 AND visitor_id NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(expires_at) > julianday(created_at)),
  ended_at TEXT CHECK (ended_at IS NULL OR (ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(ended_at) >= julianday(created_at))),
  same_phone INTEGER NOT NULL DEFAULT 0 CHECK (same_phone IN (0, 1))
) STRICT;

CREATE INDEX sessions_by_account ON sessions (account_id, visitor_id);
CREATE INDEX sessions_by_visitor ON sessions (visitor_id);

CREATE TABLE portfolios (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE TABLE properties (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  portfolio_id TEXT NOT NULL REFERENCES portfolios (id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120 AND label = trim(label)),
  synthetic INTEGER NOT NULL DEFAULT 0 CHECK (synthetic IN (0, 1)),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  removed_at TEXT CHECK (removed_at IS NULL OR (removed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(removed_at) >= julianday(created_at)))
) STRICT;

CREATE INDEX properties_by_portfolio ON properties (portfolio_id, created_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  expires_at TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(expires_at) > julianday(created_at)),
  used_at TEXT CHECK (used_at IS NULL OR (used_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' AND julianday(used_at) >= julianday(created_at))),
  walk_id TEXT UNIQUE REFERENCES walks (id) ON DELETE CASCADE,
  CHECK (walk_id IS NULL OR used_at IS NOT NULL)
) STRICT;

CREATE INDEX invites_by_property ON invites (property_id, created_at);

CREATE TRIGGER invites_used_once BEFORE UPDATE ON invites WHEN OLD.used_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an invite is used once');
END;

CREATE TABLE property_walks (
  walk_id TEXT PRIMARY KEY REFERENCES walks (id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  invite_id TEXT REFERENCES invites (id) ON DELETE SET NULL,
  linked_at TEXT NOT NULL CHECK (linked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
) STRICT;

CREATE INDEX property_walks_by_property ON property_walks (property_id, linked_at);

DROP TRIGGER message_approvals_only_by_the_homeowner;

CREATE TRIGGER message_approvals_only_by_the_homeowner BEFORE INSERT ON message_approvals
WHEN NOT EXISTS (
  SELECT 1 FROM agent_messages m JOIN agent_jobs j ON j.id = m.job_id JOIN walks w ON w.id = j.walk_id
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
