-- Figures an administrator copied from the Cloudflare dashboard (manual reconciliation).
-- Kept apart from usage_metrics, which holds only what the application measured about itself.
CREATE TABLE usage_official (
  day        TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  resource   TEXT NOT NULL,
  value      REAL NOT NULL CHECK (value >= 0),
  note       TEXT NOT NULL DEFAULT '',
  entered_by TEXT REFERENCES administrators (id) ON DELETE SET NULL,
  entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (day, resource)
) WITHOUT ROWID;
