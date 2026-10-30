ALTER TABLE tags ADD COLUMN light TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(light));
