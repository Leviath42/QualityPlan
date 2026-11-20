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

-- schema v2 : steps du flowchart (ex-postes) + arêtes
CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  step_kind TEXT NOT NULL DEFAULT 'etape',
  pos_x REAL NOT NULL DEFAULT 0,
  pos_y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flow_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
  from_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  to_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('line','station','control')),
  scope_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'modop',
  modop_ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope_type, scope_id, source, modop_ref, title)
);
CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS controls_ctqs (
  control_id INTEGER NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
  ctq_id INTEGER NOT NULL REFERENCES ctqs(id) ON DELETE CASCADE,
  PRIMARY KEY (control_id, ctq_id)
);

CREATE INDEX IF NOT EXISTS idx_stations_line ON stations(line_id, ordre);
CREATE INDEX IF NOT EXISTS idx_controls_station ON controls(station_id);
CREATE INDEX IF NOT EXISTS idx_controls_ctqs_ctq ON controls_ctqs(ctq_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader','author','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  auth_provider TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flow_edges_line ON flow_edges(line_id);
`;

// Migration v1 -> v2 : colonnes steps + layout grille auto + chainage des arêtes.
function migrate(db: Db): void {
  const hasKind = db
    .prepare(`SELECT count(*) AS n FROM pragma_table_info('stations') WHERE name='step_kind'`)
    .get() as { n: number };
  if (hasKind.n === 0) {
    db.exec(`ALTER TABLE stations ADD COLUMN step_kind TEXT NOT NULL DEFAULT 'etape';
             ALTER TABLE stations ADD COLUMN pos_x REAL NOT NULL DEFAULT 0;
             ALTER TABLE stations ADD COLUMN pos_y REAL NOT NULL DEFAULT 0;`);
    // layout auto des steps existants : grille 4 colonnes, ordre conservé
    const lines = db.prepare('SELECT id FROM lines').all() as Array<{ id: number }>;
    const upd = db.prepare('UPDATE stations SET pos_x=?, pos_y=? WHERE id=?');
    const all = db.prepare('SELECT id, line_id, ordre FROM stations ORDER BY line_id, ordre, id');
    const byLine = new Map<number, Array<{ id: number }>>();
    for (const s of all.all() as Array<{ id: number; line_id: number }>) {
      if (!byLine.has(s.line_id)) byLine.set(s.line_id, []);
      byLine.get(s.line_id)!.push({ id: s.id });
    }
    const insEdge = db.prepare('INSERT INTO flow_edges(line_id, from_station, to_station) VALUES (?,?,?)');
    db.exec('CREATE TABLE IF NOT EXISTS flow_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE, from_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, to_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE)');
    for (const [lineId, steps] of byLine) {
      steps.forEach((s, i) => {
        upd.run((i % 4) * 220, Math.floor(i / 4) * 120, s.id);
        if (i > 0) insEdge.run(lineId, steps[i - 1].id, s.id);
      });
    }
    db.prepare(`UPDATE meta SET value='2' WHERE key='schema_version'`).run();
  }
  db.exec('CREATE TABLE IF NOT EXISTS flow_edges (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE, from_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, to_station INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_flow_edges_line ON flow_edges(line_id)');
  const ver = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
  if (!ver || ver.value < '4') db.prepare("UPDATE meta SET value='4' WHERE key='schema_version'").run();
}

export function openDb(file: string): Db {
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  db.exec(`INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '2')`);
  migrate(db);
  return db;
}
