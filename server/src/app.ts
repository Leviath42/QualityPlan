import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import type { Db } from './db.js';

// ---------------------------------------------------------------------------
// Helpers SQL
// ---------------------------------------------------------------------------

function touchLine(db: Db, id: number): void {
  db.prepare(`UPDATE lines SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function getLine(db: Db, id: number) {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(id) as LineRow | undefined;
  if (!line) return undefined;
  const stations = (
    db.prepare(`SELECT * FROM stations WHERE line_id = ? ORDER BY ordre, id`).all(id) as StationRow[]
  ).map((s) => ({
    ...s,
    controls: (db.prepare(`SELECT * FROM controls WHERE station_id = ? ORDER BY id`).all(s.id) as ControlRow[]).map((c) => ({
      ...c,
      ctq_ids: (
        db.prepare(`SELECT ctq_id FROM controls_ctqs WHERE control_id = ? ORDER BY ctq_id`).all(c.id) as Array<{ ctq_id: number }>
      ).map((r) => r.ctq_id),
    })),
  }));
  return { ...line, stations };
}

function controlsOfLine(db: Db, lineId: number): Array<ControlRow & { ctq_ids: number[] }> {
  return db
    .prepare(
      `SELECT c.* FROM controls c JOIN stations s ON s.id = c.station_id WHERE s.line_id = ? ORDER BY s.ordre, s.id, c.id`
    )
    .all(lineId)
    .map((row) => ({
      ...(row as ControlRow),
      ctq_ids: (
        db.prepare(`SELECT ctq_id FROM controls_ctqs WHERE control_id = ? ORDER BY ctq_id`).all(
          (row as ControlRow).id
        ) as Array<{ ctq_id: number }>
      ).map((r) => r.ctq_id),
    }));
}

// Docs d'une cible (ligne / step / contrôle).
function docsOf(db: Db, scopeType: string, scopeId: number) {
  return db
    .prepare('SELECT id, source, modop_ref, title, url FROM documents WHERE scope_type = ? AND scope_id = ? ORDER BY id')
    .all(scopeType, scopeId);
}

function lineOfScoped(db: Db, scopeType: string, scopeId: number): number | null {
  if (scopeType === 'station') {
    const r = db.prepare('SELECT line_id FROM stations WHERE id = ?').get(scopeId) as { line_id: number } | undefined;
    return r?.line_id ?? null;
  }
  if (scopeType === 'control') {
    const r = db.prepare('SELECT s.line_id AS lid FROM controls c JOIN stations s ON s.id = c.station_id WHERE c.id = ?').get(scopeId) as { lid: number } | undefined;
    return r?.lid ?? null;
  }
  return scopeId;
}

// Recherche de MO modop via son MCP natif (stateless, Bearer).
async function modopWorkflows(search: string): Promise<Array<Record<string, unknown>>> {
  const base = (process.env.MODOP_MCP_URL ?? '').replace(/\/$/, '');
  const token = process.env.MODOP_MCP_TOKEN ?? '';
  if (!base || !token) return [];
  const body = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'list_workflows', arguments: { state: 'published', ...(search ? { search } : {}) } },
  };
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token, 'user-agent': 'qualityplan/0.3' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = (await r.json()) as { result?: { content?: Array<{ text?: string }> } };
  const text = j.result?.content?.[0]?.text ?? '[]';
  const parsed = JSON.parse(text) as unknown;
  const rows: Array<Record<string, unknown>> = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  const baseUrl = (process.env.MODOP_BASE_URL ?? '').replace(/\/$/, '');
  if (baseUrl) {
    for (const r of rows) {
      if (!r.url && (r.reference || r.id)) r.url = baseUrl + '/' + String(r.slug ?? r.reference ?? r.id);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Schémas zod
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  product_line: z.string().trim().max(200).optional().default(''),
  client: z.string().trim().max(200).optional().default(''),
  ref: z.string().trim().max(64).optional().default(''),
  redacteur: z.string().trim().max(120).optional().default(''),
  verificateur: z.string().trim().max(120).optional().default(''),
  approbateur: z.string().trim().max(120).optional().default(''),
});

const stepKindSchema = z.enum(['debut', 'etape', 'controle', 'decision', 'fin']);
const stationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ordre: z.number().int().min(0).max(999).optional().default(0),
  step_kind: stepKindSchema.optional().default('etape'),
  pos_x: z.number().optional(),
  pos_y: z.number().optional(),
});

const controlSchema = z.object({
  characteristic: z.string().trim().min(1).max(500),
  kind: z.enum(['produit', 'moyen']).optional().default('produit'),
  doc_ref: z.string().trim().max(200).optional().default(''),
  method: z.string().trim().max(200).optional().default(''),
  support: z.string().trim().max(200).optional().default(''),
  frequency: z.string().trim().max(200).optional().default(''),
  responsible: z.string().trim().max(200).optional().default(''),
  reaction: z.string().trim().max(200).optional().default(''),
});

const ctqSchema = z.object({
  code: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(500),
  family: z.string().trim().max(120).optional().default(''),
  regime: z.string().trim().max(120).optional().default(''),
});

const ctqLinkSchema = z.object({ ctq_ids: z.array(z.number().int()).max(50) });

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type LineRow = {
  id: number; code: string; name: string; product_line: string; client: string; ref: string;
  redacteur: string; verificateur: string; approbateur: string;
  created_at: string; updated_at: string;
};
export type StationRow = { id: number; line_id: number; name: string; ordre: number; step_kind: string; pos_x: number; pos_y: number; created_at: string };
export type ControlRow = {
  id: number; station_id: number; characteristic: string; kind: string; doc_ref: string;
  method: string; support: string; frequency: string; responsible: string; reaction: string;
  created_at: string; updated_at: string;
};
export type CtqRow = { id: number; code: string; label: string; family: string; regime: string; created_at: string };

export function buildApp(db: Db): Express {
  const app = express();
  app.locals.db = db;
  app.use(express.json({ limit: '2mb' }));

  const wrap = (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response, next: NextFunction) => {
      try { fn(req, res); } catch (e) { next(e); }
    };

  // ---- Health -------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM lines`).get() as { n: number };
    res.json({ status: 'ok', db: true, lines: n.n });
  });

  // ---- Bibliothèque CTQ -----------------------------------------------------
  app.get('/api/ctqs', (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ctqs ORDER BY family, code`).all());
  });

  app.post('/api/ctqs', wrap((req, res) => {
    const data = ctqSchema.parse(req.body);
    try {
      const info = db
        .prepare(`INSERT INTO ctqs(code, label, family, regime) VALUES (?, ?, ?, ?)`)
        .run(data.code, data.label, data.family, data.regime);
      res.status(201).json(db.prepare(`SELECT * FROM ctqs WHERE id = ?`).get(info.lastInsertRowid));
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'code CTQ déjà existant' });
        return;
      }
      throw e;
    }
  }));

  app.put('/api/ctqs/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM ctqs WHERE id = ?`).get(Number(req.params.id)) as CtqRow | undefined;
    if (!row) { res.status(404).json({ error: 'CTQ introuvable' }); return; }
    const data = ctqSchema.partial().parse(req.body);
    const merged = { ...row, ...data };
    try {
      db.prepare(`UPDATE ctqs SET code=?, label=?, family=?, regime=? WHERE id=?`)
        .run(merged.code, merged.label, merged.family, merged.regime, row.id);
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'code CTQ déjà existant' });
        return;
      }
      throw e;
    }
    res.json(db.prepare(`SELECT * FROM ctqs WHERE id = ?`).get(row.id));
  }));

  app.delete('/api/ctqs/:id', wrap((req, res) => {
    const info = db.prepare(`DELETE FROM ctqs WHERE id = ?`).run(Number(req.params.id));
    if (info.changes === 0) { res.status(404).json({ error: 'CTQ introuvable' }); return; }
    res.status(204).end();
  }));

  // ---- Lignes / gammes -----------------------------------------------------
  app.get('/api/lines', (_req, res) => {
    res.json(db.prepare(`SELECT * FROM lines ORDER BY code`).all());
  });

  app.post('/api/lines', wrap((req, res) => {
    const data = lineSchema.parse(req.body);
    try {
      const info = db
        .prepare(
          `INSERT INTO lines(code, name, product_line, client, ref, redacteur, verificateur, approbateur)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(data.code, data.name, data.product_line, data.client, data.ref,
          data.redacteur, data.verificateur, data.approbateur);
      res.status(201).json(getLine(db, Number(info.lastInsertRowid)));
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'code ligne déjà existant' });
        return;
      }
      throw e;
    }
  }));

  app.get('/api/lines/:id', wrap((req, res) => {
    const line = getLine(db, Number(req.params.id));
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    res.json(line);
  }));

  app.put('/api/lines/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(Number(req.params.id)) as LineRow | undefined;
    if (!row) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const data = lineSchema.partial().parse(req.body);
    const merged = { ...row, ...data };
    try {
      db.prepare(
        `UPDATE lines SET code=?, name=?, product_line=?, client=?, ref=?, redacteur=?, verificateur=?, approbateur=?,
         updated_at = datetime('now') WHERE id=?`
      ).run(merged.code, merged.name, merged.product_line, merged.client, merged.ref,
        merged.redacteur, merged.verificateur, merged.approbateur, row.id);
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'code ligne déjà existant' });
        return;
      }
      throw e;
    }
    res.json(getLine(db, row.id));
  }));

  app.delete('/api/lines/:id', wrap((req, res) => {
    const info = db.prepare(`DELETE FROM lines WHERE id = ?`).run(Number(req.params.id));
    if (info.changes === 0) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    res.status(204).end();
  }));

  // ---- Postes ---------------------------------------------------------------
  app.post('/api/lines/:id/stations', wrap((req, res) => {
    const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(Number(req.params.id)) as { id: number } | undefined;
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const data = stationSchema.parse(req.body);
    const info = db
      .prepare(`INSERT INTO stations(line_id, name, ordre, step_kind, pos_x, pos_y) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(Number(req.params.id), data.name, data.ordre, data.step_kind, data.pos_x ?? 0, data.pos_y ?? 0);
    touchLine(db, Number(req.params.id));
    res.status(201).json(
      db.prepare(`SELECT * FROM stations WHERE id = ?`).get(Number(info.lastInsertRowid))
    );
  }));

  app.put('/api/stations/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM stations WHERE id = ?`).get(Number(req.params.id)) as StationRow | undefined;
    if (!row) { res.status(404).json({ error: 'poste introuvable' }); return; }
    const data = stationSchema.partial().parse(req.body);
    const merged = { ...row, ...data };
    db.prepare(`UPDATE stations SET name=?, ordre=?, step_kind=?, pos_x=?, pos_y=? WHERE id=?`).run(merged.name, merged.ordre, merged.step_kind ?? row.step_kind, merged.pos_x ?? row.pos_x, merged.pos_y ?? row.pos_y, row.id);
    touchLine(db, row.line_id);
    res.json(db.prepare(`SELECT * FROM stations WHERE id = ?`).get(row.id));
  }));

  app.delete('/api/stations/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM stations WHERE id = ?`).get(Number(req.params.id)) as StationRow | undefined;
    if (!row) { res.status(404).json({ error: 'poste introuvable' }); return; }
    db.prepare(`DELETE FROM stations WHERE id = ?`).run(row.id);
    touchLine(db, row.line_id);
    res.status(204).end();
  }));

  // ---- Flowchart (steps + aretes) ------------------------------------------
  app.get('/api/lines/:id/flow', wrap((req, res) => {
    const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(Number(req.params.id)) as { id: number } | undefined;
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const steps = db
      .prepare(`SELECT * FROM stations WHERE line_id = ? ORDER BY ordre, id`)
      .all(Number(req.params.id));
    const edges = (db
      .prepare(`SELECT from_station, to_station FROM flow_edges WHERE line_id = ? ORDER BY id`)
      .all(Number(req.params.id)) as Array<{ from_station: number; to_station: number }>)
      .map((e) => ({ from: e.from_station, to: e.to_station }));
    res.json({ steps, edges });
  }));

  const flowSaveSchema = z.object({
    steps: z.array(z.object({
      id: z.number().int(),
      name: z.string().trim().min(1).max(200).optional(),
      step_kind: stepKindSchema.optional(),
      pos_x: z.number(),
      pos_y: z.number(),
      ordre: z.number().int().min(0).max(999).optional(),
    })).max(200),
    edges: z.array(z.object({ from: z.number().int(), to: z.number().int() })).max(500),
  });

  app.put('/api/lines/:id/flow', wrap((req, res) => {
    const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(Number(req.params.id)) as { id: number } | undefined;
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const data = flowSaveSchema.parse(req.body);
    const own = new Set(
      (db.prepare(`SELECT id FROM stations WHERE line_id = ?`).all(line.id) as Array<{ id: number }>).map((r) => r.id)
    );
    for (const st of data.steps) {
      if (!own.has(st.id)) { res.status(400).json({ error: 'step hors ligne', id: st.id }); return; }
    }
    for (const e of data.edges) {
      if (!own.has(e.from) || !own.has(e.to)) { res.status(400).json({ error: 'arete vers step hors ligne' }); return; }
    }
    const tx = db.transaction(() => {
      const updStep = db.prepare(`UPDATE stations SET name=?, step_kind=?, pos_x=?, pos_y=?, ordre=? WHERE id=?`);
      const cur = db.prepare(`SELECT * FROM stations WHERE id = ?`);
      for (const [i, st] of data.steps.entries()) {
        const row = cur.get(st.id) as StationRow;
        updStep.run(st.name ?? row.name, st.step_kind ?? row.step_kind, st.pos_x, st.pos_y, st.ordre ?? i, st.id);
      }
      db.prepare(`DELETE FROM flow_edges WHERE line_id = ?`).run(line.id);
      const insEdge = db.prepare(`INSERT INTO flow_edges(line_id, from_station, to_station) VALUES (?,?,?)`);
      for (const e of data.edges) insEdge.run(line.id, e.from, e.to);
      touchLine(db, line.id);
    });
    tx();
    const steps = db.prepare(`SELECT * FROM stations WHERE line_id = ? ORDER BY ordre, id`).all(line.id);
    const edges = (db.prepare(`SELECT from_station, to_station FROM flow_edges WHERE line_id = ? ORDER BY id`).all(line.id) as Array<{ from_station: number; to_station: number }>)
      .map((e) => ({ from: e.from_station, to: e.to_station }));
    res.json({ steps, edges });
  }));

  // ---- Contrôles ------------------------------------------------------------
  app.post('/api/stations/:id/controls', wrap((req, res) => {
    const station = db.prepare(`SELECT * FROM stations WHERE id = ?`).get(Number(req.params.id)) as StationRow | undefined;
    if (!station) { res.status(404).json({ error: 'poste introuvable' }); return; }
    const data = controlSchema.parse(req.body);
    const info = db
      .prepare(
        `INSERT INTO controls(station_id, characteristic, kind, doc_ref, method, support, frequency, responsible, reaction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(station.id, data.characteristic, data.kind, data.doc_ref, data.method,
        data.support, data.frequency, data.responsible, data.reaction);
    touchLine(db, station.line_id);
    res.status(201).json(db.prepare(`SELECT * FROM controls WHERE id = ?`).get(Number(info.lastInsertRowid)));
  }));

  app.put('/api/controls/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM controls WHERE id = ?`).get(Number(req.params.id)) as ControlRow | undefined;
    if (!row) { res.status(404).json({ error: 'contrôle introuvable' }); return; }
    const data = controlSchema.partial().parse(req.body);
    const merged = { ...row, ...data };
    db.prepare(
      `UPDATE controls SET characteristic=?, kind=?, doc_ref=?, method=?, support=?, frequency=?, responsible=?, reaction=?,
       updated_at = datetime('now') WHERE id=?`
    ).run(merged.characteristic, merged.kind, merged.doc_ref, merged.method, merged.support,
      merged.frequency, merged.responsible, merged.reaction, row.id);
    const station = db.prepare(`SELECT line_id FROM stations WHERE id = ?`).get(row.station_id) as { line_id: number };
    touchLine(db, station.line_id);
    res.json(db.prepare(`SELECT * FROM controls WHERE id = ?`).get(row.id));
  }));

  app.delete('/api/controls/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM controls WHERE id = ?`).get(Number(req.params.id)) as ControlRow | undefined;
    if (!row) { res.status(404).json({ error: 'contrôle introuvable' }); return; }
    db.prepare(`DELETE FROM controls WHERE id = ?`).run(row.id);
    const station = db.prepare(`SELECT line_id FROM stations WHERE id = ?`).get(row.station_id) as { line_id: number };
    touchLine(db, station.line_id);
    res.status(204).end();
  }));

  app.put('/api/controls/:id/ctqs', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM controls WHERE id = ?`).get(Number(req.params.id)) as ControlRow | undefined;
    if (!row) { res.status(404).json({ error: 'contrôle introuvable' }); return; }
    const { ctq_ids } = ctqLinkSchema.parse(req.body);
    const known = new Set(
      (db.prepare(`SELECT id FROM ctqs`).all() as Array<{ id: number }>).map((r) => r.id)
    );
    const invalid = ctq_ids.filter((id) => !known.has(id));
    if (invalid.length > 0) { res.status(400).json({ error: 'CTQ inconnus', invalid }); return; }
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM controls_ctqs WHERE control_id = ?`).run(row.id);
      const ins = db.prepare(`INSERT OR IGNORE INTO controls_ctqs(control_id, ctq_id) VALUES (?, ?)`);
      for (const id of ctq_ids) ins.run(row.id, id);
    });
    tx();
    const station = db.prepare(`SELECT line_id FROM stations WHERE id = ?`).get(row.station_id) as { line_id: number };
    touchLine(db, station.line_id);
    res.json({ control_id: row.id, ctq_ids });
  }));

  // ---- Matrice CTQ (cartographie) --------------------------------------------
  // Règle PQG-FUS : Couvert si >= 2 points de contrôle, Partiel si 1, Angle mort si 0.
  app.get('/api/lines/:id/matrix', wrap((req, res) => {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(Number(req.params.id)) as LineRow | undefined;
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const controls = controlsOfLine(db, line.id);
    const ctqs = db.prepare(`SELECT * FROM ctqs ORDER BY family, code`).all() as CtqRow[];
    const perCtq = ctqs.map((ctq) => {
      const cids = controls.filter((c) => c.ctq_ids.includes(ctq.id));
      const status = cids.length >= 2 ? 'couvert' : cids.length === 1 ? 'partiel' : 'angle_mort';
      return {
        ctq_id: ctq.id, code: ctq.code, label: ctq.label, family: ctq.family,
        regime: ctq.regime, points: cids.length, status,
        controls: cids.map((c) => ({ id: c.id, characteristic: c.characteristic, station_id: c.station_id })),
      };
    });
    const orphans = controls.filter((c) => c.ctq_ids.length === 0)
      .map((c) => ({ id: c.id, characteristic: c.characteristic, station_id: c.station_id }));
    const total = perCtq.length;
    const covered = perCtq.filter((x) => x.status === 'couvert').length;
    const families: Record<string, { family: string; total: number; covered: number; partial: number; blind: number }> = {};
    for (const x of perCtq) {
      if (!families[x.family]) families[x.family] = { family: x.family, total: 0, covered: 0, partial: 0, blind: 0 };
      families[x.family].total += 1;
      if (x.status === 'couvert') families[x.family].covered += 1;
      else if (x.status === 'partiel') families[x.family].partial += 1;
      else families[x.family].blind += 1;
    }
    res.json({
      line_id: line.id, line_code: line.code,
      coverage: total === 0 ? null : Math.round((covered / total) * 100),
      ctqs: perCtq, orphans, families: Object.values(families),
    });
  }));

  // ---- Documents (3 niveaux : ligne / step / contrôle, refs modop) -------
  const docSchema = z.object({
    title: z.string().trim().min(1).max(300),
    modop_ref: z.string().trim().max(120).optional().default(''),
    url: z.string().trim().max(500).optional().default(''),
    source: z.string().trim().max(60).optional().default('modop'),
  });
  const SCOPES: Record<string, string> = { lines: 'line', stations: 'station', controls: 'control' };

  // vue agrégée par ligne : docs génériques + par step + par contrôle
  app.get('/api/lines/:id/documents', wrap((req, res) => {
    const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(Number(req.params.id));
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const generic = docsOf(db, 'line', Number(req.params.id));
    const stations: Record<number, unknown[]> = {};
    for (const st of db.prepare(`SELECT id FROM stations WHERE line_id = ?`).all(Number(req.params.id)) as Array<{ id: number }>) {
      stations[st.id] = docsOf(db, 'station', st.id);
    }
    const controls: Record<number, unknown[]> = {};
    for (const ct of controlsOfLine(db, Number(req.params.id))) {
      controls[ct.id] = docsOf(db, 'control', ct.id);
    }
    res.json({ generic, stations, controls });
  }));

  app.get('/api/:scope(lines|stations|controls)/:id/documents', wrap((req, res) => {
    const t = SCOPES[(req.params as { scope: string }).scope];
    const rows = db
      .prepare(`SELECT * FROM documents WHERE scope_type = ? AND scope_id = ? ORDER BY id`)
      .all(t, Number(req.params.id));
    res.json(docsOf(db, t, Number(req.params.id)));
  }));

  app.post('/api/:scope(lines|stations|controls)/:id/documents', wrap((req, res) => {
    const t = SCOPES[(req.params as { scope: string }).scope];
    const id = Number(req.params.id);
    const owner = db.prepare(`SELECT id FROM ${t === 'line' ? 'lines' : t === 'station' ? 'stations' : 'controls'} WHERE id = ?`).get(id);
    if (!owner) { res.status(404).json({ error: 'cible introuvable' }); return; }
    const data = docSchema.parse(req.body);
    try {
      const info = db
        .prepare(`INSERT INTO documents(scope_type, scope_id, source, modop_ref, title, url) VALUES (?,?,?,?,?,?)`)
        .run(t, id, data.source, data.modop_ref, data.title, data.url);
      if (t !== 'line') {
        const lid = lineOfScoped(db, t, id);
        if (lid) touchLine(db, lid);
      } else { touchLine(db, id); }
      res.status(201).json(db.prepare(`SELECT * FROM documents WHERE id = ?`).get(Number(info.lastInsertRowid)));
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        res.status(409).json({ error: 'document déjà lié à cette cible' }); return;
      }
      throw e;
    }
  }));

  app.delete('/api/documents/:id', wrap((req, res) => {
    const row = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(Number(req.params.id)) as { scope_type: string; scope_id: number } | undefined;
    if (!row) { res.status(404).json({ error: 'document introuvable' }); return; }
    db.prepare(`DELETE FROM documents WHERE id = ?`).run(Number(req.params.id));
    if (row.scope_type === 'line') touchLine(db, row.scope_id);
    else { const lid = lineOfScoped(db, row.scope_type, row.scope_id); if (lid) touchLine(db, lid); }
    res.status(204).end();
  }));


  // Proxy recherche modop (via son MCP natif, outil list_workflows) — jamais de
  // secret en dur : env MODOP_MCP_URL / MODOP_MCP_TOKEN.
  app.get('/api/modop/search', wrap(async (req, res) => {
    try {
      const q = String(req.query.q ?? '').slice(0, 100);
      const rows = await modopWorkflows(q);
      res.json(rows);
    } catch (e) { res.status(502).json({ error: 'modop injoignable', detail: String(e).slice(0, 200) }); }
  }));

  // ---- API publique (token X-API-Token) — consommée par modop & co --------
  const publicApi = () => Boolean(process.env.QP_PUBLIC_TOKEN);
  const publicGuard = wrap((req: import('express').Request, res: import('express').Response, next?: import('express').NextFunction) => {
    res.status(501).json({ error: 'disabled' });
  });
  app.use('/api/public', (req, res, next) => {
    if (!publicApi()) { res.status(501).json({ error: 'api publique désactivée (QP_PUBLIC_TOKEN absent)' }); return; }
    const presented = (req.headers['x-api-token'] ?? '') as string;
    const expected = process.env.QP_PUBLIC_TOKEN ?? '';
    const ok = presented.length === expected.length && Buffer.compare(Buffer.from(presented), Buffer.from(expected)) === 0;
    if (!ok) { res.status(401).json({ error: 'token invalide ou absent' }); return; }
    next();
  });
  app.get('/api/public/lines', (_req, res) => {
    res.json(db.prepare(`SELECT id, code, name, product_line, client, updated_at FROM lines ORDER BY code`).all());
  });
  app.get('/api/public/lines/:id/flow', wrap((req, res) => {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(Number(req.params.id)) as LineRow | undefined;
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const steps = db.prepare(`SELECT * FROM stations WHERE line_id = ? ORDER BY ordre, id`).all(line.id);
    const edges = (db.prepare(`SELECT from_station, to_station FROM flow_edges WHERE line_id = ? ORDER BY id`).all(line.id) as Array<{ from_station: number; to_station: number }>).map((e) => ({ from: e.from_station, to: e.to_station }));
    res.json({ line: { id: line.id, code: line.code, name: line.name }, steps, edges });
  }));
  app.get('/api/public/lines/:id/pl', wrap((req, res) => {
    const full = getLine(db, Number(req.params.id));
    if (!full) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const docs = {
      generic: docsOf(db, 'line', full.id),
      stations: Object.fromEntries((full.stations ?? []).map((s) => [s.id, docsOf(db, 'station', s.id)])),
      controls: Object.fromEntries((full.stations ?? []).flatMap((s) => s.controls ?? []).map((c) => [c.id, docsOf(db, 'control', c.id)])),
    };
    res.json({ ...full, documents: docs });
  }));

  // ---- Export markdown --------------------------------------------------------
  app.get('/api/lines/:id/export', wrap((req, res) => {
    const line = getLine(db, Number(req.params.id));
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const ctqById = new Map(
      (db.prepare(`SELECT * FROM ctqs`).all() as CtqRow[]).map((c) => [c.id, c])
    );
    const out: string[] = [];
    out.push('# Plan de déroulement et de contrôle');
    out.push('');
    out.push('**Référence** : ' + (line.ref || 'PL ' + line.code) + ' — ligne ' + line.name);
    out.push('**Ligne produit** : ' + (line.product_line || '-') + ' — **Client** : ' + (line.client || '-'));
    out.push('**Rédacteur** : ' + (line.redacteur || '-') + ' — **Vérificateur** : ' + (line.verificateur || '-') + ' — **Approbateur** : ' + (line.approbateur || '-'));
    const generic = docsOf(db, 'line', Number(line.id)) as Array<{ title: string; modop_ref: string; url: string }>;
    if (generic.length > 0) {
      out.push('### Documents génériques (ligne)');
      for (const g of generic) {
        out.push('- [' + g.title + '](' + (g.url || '#') + ')' + (g.modop_ref ? ' — ref ' + g.modop_ref : ''));
      }
      out.push('');
    }
    out.push('');
    for (const st of line.stations) {
      out.push('## Poste ' + (st.ordre + 1) + ' — ' + st.name);
      out.push('');
      for (const d of docsOf(db, 'station', Number(st.id)) as Array<{ title: string; modop_ref: string; url: string }>) {
        out.push('- Document : [' + d.title + '](' + (d.url || '#') + ')' + (d.modop_ref ? ' — ref ' + d.modop_ref : ''));
      }
      if (st.controls.length === 0) { out.push('_Aucun contrôle défini._'); out.push(''); continue; }
      out.push('| Caractéristique | Doc réf | Moyen | Support | Fréquence | Responsable | Réaction NC | CTQ |');
      out.push('|---|---|---|---|---|---|---|---|');
      for (const c of st.controls) {
        const linked = (
          db.prepare(`SELECT ctq_id FROM controls_ctqs WHERE control_id = ? ORDER BY ctq_id`).all(c.id) as Array<{ ctq_id: number }>
        ).map((r) => ctqById.get(r.ctq_id)?.code ?? '#' + r.ctq_id).join(', ');
        const esc = (s: string) => s.replace(/\|/g, '\\|');
        out.push(
          '| ' + esc(c.characteristic) + ' | ' + esc(c.doc_ref) + ' | ' + esc(c.method) + ' | ' + esc(c.support)
            + ' | ' + esc(c.frequency) + ' | ' + esc(c.responsible) + ' | ' + esc(c.reaction) + ' | ' + esc(linked) + ' |'
        );
      }
      out.push('');
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(out.join('\n'));
  }));

  // ---- Erreurs ----------------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'payload invalide', details: err.issues.map((i) => ({ path: i.path, message: i.message })) });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'erreur interne' });
  });

  return app;
}
