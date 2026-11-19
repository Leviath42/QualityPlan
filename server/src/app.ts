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

const stationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ordre: z.number().int().min(0).max(999).optional().default(0),
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
export type StationRow = { id: number; line_id: number; name: string; ordre: number; created_at: string };
export type ControlRow = {
  id: number; station_id: number; characteristic: string; kind: string; doc_ref: string;
  method: string; support: string; frequency: string; responsible: string; reaction: string;
  created_at: string; updated_at: string;
};
export type CtqRow = { id: number; code: string; label: string; family: string; regime: string; created_at: string };

export function buildApp(db: Db): Express {
  const app = express();
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
    const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(Number(req.params.id));
    if (!line) { res.status(404).json({ error: 'ligne introuvable' }); return; }
    const data = stationSchema.parse(req.body);
    const info = db
      .prepare(`INSERT INTO stations(line_id, name, ordre) VALUES (?, ?, ?)`)
      .run(Number(req.params.id), data.name, data.ordre);
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
    db.prepare(`UPDATE stations SET name=?, ordre=? WHERE id=?`).run(merged.name, merged.ordre, row.id);
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
    out.push('');
    for (const st of line.stations) {
      out.push('## Poste ' + (st.ordre + 1) + ' — ' + st.name);
      out.push('');
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
