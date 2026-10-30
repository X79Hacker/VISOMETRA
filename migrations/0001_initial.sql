-- Sector Map schema (D1). Apply with:  npm run db:migrate
-- "IF NOT EXISTS" because the first online version created these tables on first use.

-- Shared images' details, cell drawings and traces, as JSON text split into parts
-- (a D1 row holds at most 2 MB). store = files | patches | traces, id = image id.
CREATE TABLE IF NOT EXISTS records (
  store      TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  part       INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (store, id, part)
);

-- Deleted image ids, so a browser with an old cached copy does not upload them again.
CREATE TABLE IF NOT EXISTS deleted (
  id         TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL,
  deleted_by TEXT
);

-- Saved Results: one row per measurement, and its circles / cell areas,
-- each kept as the JSON the page reads and as finished CSV lines.
CREATE TABLE IF NOT EXISTS res_meas (
  seq            INTEGER PRIMARY KEY,
  measurement_id TEXT UNIQUE NOT NULL,
  json           TEXT NOT NULL,
  csv            TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS res_parts (
  seq            INTEGER PRIMARY KEY,
  measurement_id TEXT NOT NULL,
  kind           TEXT NOT NULL,   -- circles | cells
  json           TEXT NOT NULL,
  csv            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS res_parts_mid ON res_parts (measurement_id, kind);

-- History Log of deletes (was a KV namespace; the old entries are copied in once).
CREATE TABLE IF NOT EXISTS history (
  id           INTEGER PRIMARY KEY,
  time         TEXT NOT NULL,     -- ISO 8601, UTC
  user         TEXT NOT NULL,     -- who re-entered their password to confirm
  signed_in_as TEXT,              -- whose session it was
  action       TEXT NOT NULL,     -- delete | wipe
  images       TEXT NOT NULL      -- JSON array of image names
);
CREATE INDEX IF NOT EXISTS history_time ON history (time DESC);
