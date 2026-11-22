-- Seed data: system quiz templates and default application settings.
-- Templates only list what differs from the defaults in packages/shared/src/settings.ts.

INSERT INTO quiz_templates (id, name, description, is_system, settings_json) VALUES
  ('tpl_classic', 'Classic Quiz', 'Balanced timers with a moderate speed bonus and a live leaderboard.', 1,
   '{"defaultTimeLimitSec":20,"basePoints":1000,"speedBonusPercent":50}'),
  ('tpl_speed', 'Speed Challenge', 'Short timers and a large speed bonus; questions advance automatically.', 1,
   '{"defaultTimeLimitSec":10,"basePoints":1000,"speedBonusPercent":100,"countdownBeforeQuestionSec":2,"autoAdvance":true,"autoAdvanceDelaySec":5,"showExplanations":false}'),
  ('tpl_assessment', 'Knowledge Assessment', 'Fair, unhurried assessment: no speed bonus, randomised order, no live ranking.', 1,
   '{"defaultTimeLimitSec":30,"basePoints":1000,"speedBonusPercent":0,"randomizeQuestions":true,"randomizeAnswers":true,"leaderboardEnabled":false,"showFinalLeaderboard":false,"showCorrectAnswer":false,"showExplanations":false}'),
  ('tpl_truefalse', 'True or False', 'Quick two-option questions with a small speed bonus.', 1,
   '{"defaultTimeLimitSec":10,"basePoints":500,"speedBonusPercent":25,"countdownBeforeQuestionSec":2}'),
  ('tpl_training', 'Corporate Training', 'Learning focused: explanations always shown, late joiners welcome, host-paced.', 1,
   '{"defaultTimeLimitSec":45,"basePoints":1000,"speedBonusPercent":10,"allowLateJoin":true,"showCorrectAnswer":true,"showExplanations":true}'),
  ('tpl_cyber', 'Cybersecurity Awareness', 'Scenario questions with explanations and shuffled answers to avoid pattern guessing.', 1,
   '{"defaultTimeLimitSec":30,"basePoints":1000,"speedBonusPercent":20,"randomizeAnswers":true,"showExplanations":true}');

INSERT INTO application_settings (key, value_json) VALUES
  ('setup_completed', 'false'),
  ('locale', '{"default":"uk"}'),
  ('branding', '{"companyName":"","primaryColor":"#d7ff3a","secondaryColor":"#8fb300","backgroundColor":"#0b0b0c","accentColor":"#f4f4f0","logoPlacement":"top-left","logoMediaId":null,"backgroundMediaId":null,"welcomeMessage":"","finalMessage":""}'),
  ('retention', '{"participantDataDays":90,"gameResultsDays":365,"auditLogDays":365}'),
  ('usage_config', '{"safeMode":false,"thresholds":{"info":50,"warning":75,"critical":90,"reached":100}}');
