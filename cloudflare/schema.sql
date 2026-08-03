-- Run this once in the Cloudflare D1 Console for the `classboard-807` database.
CREATE TABLE IF NOT EXISTS classroom_state (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
