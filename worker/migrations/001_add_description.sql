-- Only needed if you already created the tables BEFORE this update.
-- (A 'duplicate column name' error just means you already have it - safe to ignore.)
ALTER TABLE room_overrides ADD COLUMN description TEXT;
