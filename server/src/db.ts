import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  product_line TEXT DEFAULT '',
  client TEXT DEFAULT '',
  ref TEXT DEFAULT '',
  redacteur TEXT DEFAULT '',
  verificateur TEXT DEFAULT '',
  approbateur TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  characteristic TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'produit',
  doc_ref TEXT DEFAULT '',
  method TEXT DEFAULT '',
  support TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  responsible TEXT DEFAULT '',
  reaction TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ctqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT '',
  regime TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS controls_ctqs (
  control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  ctq_id INTEGER NOT NULL REFERENCES ctqs(id) ON DELETE CASCADE,
  PRIMARY KEY (control_id, ctq_id)
);

CREATE INDEX IF NOT EXISTS idx_stations_line ON stations(line_id, ordre);
CREATE INDEX IF NOT EXISTS idx_controls_station ON controls(station_id);
CREATE INDEX IF NOT EXISTS idx_controls_ctqs_ctq ON controls_ctqs(ctq_id);
`;

export function openDb(file: string): Db {
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  db.exec(`INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1')`);
  return db;
}
