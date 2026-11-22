-- Games started from the showcase without an account. Only the hash of the host's secret is stored.
ALTER TABLE game_sessions ADD COLUMN guest_token_hash TEXT;
CREATE INDEX idx_game_sessions_guest ON game_sessions (guest_token_hash) WHERE guest_token_hash IS NOT NULL;
