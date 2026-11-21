-- Phase 4: fewer rows written per game.
-- Each index adds one written row per inserted row (D1 bills rows written, 100,000 per day on Free).
-- Both indexes below are redundant: the UNIQUE constraints on (game_id, ...) already begin with game_id
-- and serve every lookup by game.
DROP INDEX IF EXISTS idx_game_results_game;
DROP INDEX IF EXISTS idx_game_participants_game;
