ALTER TABLE sign_in_links ADD COLUMN code_hash TEXT CHECK (code_hash IS NULL OR (length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*'));

ALTER TABLE sign_in_links ADD COLUMN code_tries INTEGER NOT NULL DEFAULT 0 CHECK (code_tries BETWEEN 0 AND 5);

ALTER TABLE sign_in_links ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign_in' CHECK (purpose IN ('sign_in', 'change_email'));

ALTER TABLE sign_in_links ADD COLUMN account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE CHECK ((account_id IS NOT NULL) = (purpose = 'change_email'));
