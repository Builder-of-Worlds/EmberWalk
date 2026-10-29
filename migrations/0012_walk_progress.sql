ALTER TABLE walks ADD COLUMN progress_total INTEGER CHECK (progress_total IS NULL OR (progress_total >= 1 AND state = 'processing'));
ALTER TABLE walks ADD COLUMN progress_done INTEGER CHECK ((progress_done IS NULL) = (progress_total IS NULL) AND (progress_done IS NULL OR progress_done BETWEEN 0 AND progress_total));
