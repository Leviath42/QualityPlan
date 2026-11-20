import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';

let server: Server;
let base: string;

async function start(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-test-'));
  const db = openDb(path.join(dir, 'test.db'));
  // seed CTQ de test (2 CTQ, 1 famille)
  const ins = db.prepare('INSERT INTO ctqs(code, label, family, regime) VALUES (?, ?, ?, ?)');
  ins.run('CTQ-A', 'CTQ alpha', 'famille1', 'R1');
  ins.run('CTQ-B', 'CTQ bêta', 'famille1', 'R2');
  const app: Express = buildApp(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}

async function stop(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

let seq = 0;
async function j(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(base + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

before(start);
after(stop);

test('health répond ok', async () => {
  const r = await j('GET', '/api/health');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.status, 'ok');
  assert.equal(d.db, true);
});

test('CRUD ligne complet', async () => {
  const r = await j('POST', '/api/lines', {
    code: 'LIGNE-' + (++seq), name: 'Gamme fusible NH',
    product_line: 'NH00', client: 'ACME', redacteur: 'N. Notamy',
  });
  assert.equal(r.status, 201);
  const line = await r.json();
  assert.equal(line.name, 'Gamme fusible NH');
  assert.ok(line.id > 0);

  const g = await j('GET', '/api/lines/' + line.id);
  assert.equal(g.status, 200);
  assert.deepEqual((await g.json()).stations, []);

  const u = await j('PUT', '/api/lines/' + line.id, { client: 'ACME2' });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).client, 'ACME2');

  const d = await j('DELETE', '/api/lines/' + line.id);
  assert.equal(d.status, 204);
  const g2 = await j('GET', '/api/lines/' + line.id);
  assert.equal(g2.status, 404);
});

test('payload invalide = 400 avec détails', async () => {
  const r = await j('POST', '/api/lines', { code: '', name: '' });
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.ok(Array.isArray(d.details));
});

test('code ligne unique = 409', async () => {
  const body = { code: 'DOUBLON', name: 'a' };
  const r1 = await j('POST', '/api/lines', body);
  assert.equal(r1.status, 201);
  const r2 = await j('POST', '/api/lines', body);
  assert.equal(r2.status, 409);
});

test('code CTQ unique = 409', async () => {
  await j('POST', '/api/ctqs', { code: 'UNIQ', label: 'x' });
  const r = await j('POST', '/api/ctqs', { code: 'UNIQ', label: 'y' });
  assert.equal(r.status, 409);
});

test('postes + contrôles + cascade delete', async () => {
  const line = await (await j('POST', '/api/lines', { code: 'CAS-' + (++seq), name: 'Cascade' })).json();
  const st = await (await j('POST', '/api/lines/' + line.id + '/stations', { name: 'Montage voyant', ordre: 0 })).json();
  const ctrl = await (await j('POST', '/api/stations/' + st.id + '/controls', {
    characteristic: 'Position du voyant', method: 'Visuel', frequency: 'Unitaire',
  })).json();
  assert.equal(ctrl.characteristic, 'Position du voyant');

  const upd = await j('PUT', '/api/controls/' + ctrl.id, { frequency: 'Chaque caisse' });
  assert.equal((await upd.json()).frequency, 'Chaque caisse');

  // suppression du poste = cascade sur contrôle
  const ds = await j('DELETE', '/api/stations/' + st.id);
  assert.equal(ds.status, 204);
  const gc = await j('GET', '/api/lines/' + line.id);
  assert.deepEqual((await gc.json()).stations, []);
});

test('matrice : angle mort -> partiel -> couvert, orphelins détectés', async () => {
  const line = await (await j('POST', '/api/lines', { code: 'MAT-' + (++seq), name: 'Matrice' })).json();
  const st = await (await j('POST', '/api/lines/' + line.id + '/stations', { name: 'P1' })).json();
  const ctqs = await (await j('GET', '/api/ctqs')).json();
  const ctqA = ctqs.find((c: { code: string }) => c.code === 'CTQ-A');
  const ctqB = ctqs.find((c: { code: string }) => c.code === 'CTQ-B');

  // état initial : tout angle mort, coverage 0 (>= 1 CTQ existe)
  let m = await (await j('GET', '/api/lines/' + line.id + '/matrix')).json();
  assert.equal(m.ctqs.find((x: { code: string }) => x.code === 'CTQ-A').status, 'angle_mort');
  assert.equal(m.coverage, 0);

  // 1 contrôle orphelin (aucun CTQ)
  const o = await (await j('POST', '/api/stations/' + st.id + '/controls', { characteristic: 'Orphelin' })).json();
  m = await (await j('GET', '/api/lines/' + line.id + '/matrix')).json();
  assert.equal(m.orphans.length, 1);
  assert.equal(m.orphans[0].id, o.id);

  // 1er point sur CTQ-A = partiel
  const c1 = await (await j('POST', '/api/stations/' + st.id + '/controls', { characteristic: 'C1' })).json();
  const lk1 = await j('PUT', '/api/controls/' + c1.id + '/ctqs', { ctq_ids: [ctqA.id] });
  assert.equal(lk1.status, 200);
  m = await (await j('GET', '/api/lines/' + line.id + '/matrix')).json();
  assert.equal(m.ctqs.find((x: { code: string }) => x.code === 'CTQ-A').status, 'partiel');
  assert.equal(m.ctqs.find((x: { code: string }) => x.code === 'CTQ-B').status, 'angle_mort');

  // 2e point sur CTQ-A, 1 sur CTQ-B
  const c2 = await (await j('POST', '/api/stations/' + st.id + '/controls', { characteristic: 'C2' })).json();
  await j('PUT', '/api/controls/' + c2.id + '/ctqs', { ctq_ids: [ctqA.id, ctqB.id] });
  m = await (await j('GET', '/api/lines/' + line.id + '/matrix')).json();
  const a = m.ctqs.find((x: { code: string }) => x.code === 'CTQ-A');
  const b = m.ctqs.find((x: { code: string }) => x.code === 'CTQ-B');
  assert.equal(a.status, 'couvert');
  assert.equal(a.points, 2);
  assert.equal(b.status, 'partiel');
  const allCtqs = await (await j('GET', '/api/ctqs')).json();
  assert.equal(m.coverage, Math.round((1 / allCtqs.length) * 100));
  const fam = m.families.find((f2) => f2.family === 'famille1');
  assert.ok(fam);
  assert.equal(fam.family, 'famille1');
  assert.equal(fam.covered, 1);

  // lien vers un CTQ inconnu = 400
  const bad = await j('PUT', '/api/controls/' + c1.id + '/ctqs', { ctq_ids: [99999] });
  assert.equal(bad.status, 400);

  // retrait complet des liens d'un contrôle
  await j('PUT', '/api/controls/' + c2.id + '/ctqs', { ctq_ids: [] });
  m = await (await j('GET', '/api/lines/' + line.id + '/matrix')).json();
  assert.equal(m.ctqs.find((x: { code: string }) => x.code === 'CTQ-A').status, 'partiel');
});

test('export markdown contient en-tête, contrôles et CTQ', async () => {
  const line = await (await j('POST', '/api/lines', { code: 'EXP-' + (++seq), name: 'Export', ref: 'PL 1234 A', client: 'ACME' })).json();
  const st = await (await j('POST', '/api/lines/' + line.id + '/stations', { name: 'Montage' })).json();
  const ctqs = await (await j('GET', '/api/ctqs')).json();
  const ctqA = ctqs.find((c: { code: string }) => c.code === 'CTQ-A');
  const c = await (await j('POST', '/api/stations/' + st.id + '/controls', { characteristic: 'Continuité du fil', method: 'OM30' })).json();
  await j('PUT', '/api/controls/' + c.id + '/ctqs', { ctq_ids: [ctqA.id] });

  const r = await j('GET', '/api/lines/' + line.id + '/export');
  assert.equal(r.status, 200);
  const md = await r.text();
  assert.ok(md.includes('Plan de déroulement et de contrôle'));
  assert.ok(md.includes('PL 1234 A'));
  assert.ok(md.includes('Continuité du fil'));
  assert.ok(md.includes('CTQ-A'));
  assert.ok(md.includes('Poste 1 — Montage'));
});

test('404 propres sur entités inexistantes', async () => {
  assert.equal((await j('GET', '/api/lines/999999')).status, 404);
  assert.equal((await j('PUT', '/api/stations/999999', { name: 'x' })).status, 404);
  assert.equal((await j('DELETE', '/api/controls/999999')).status, 404);
  assert.equal((await j('GET', '/api/lines/999999/matrix')).status, 404);
});


// ---------------------------------------------------------------------------
// v0.2 : flowchart — steps positionnables + arêtes, PL dérivé inchangé
// ---------------------------------------------------------------------------

test('flow : sauvegarde steps + arêtes, relecture conforme, step hors ligne rejeté', async () => {
  const line = await (await j('POST', '/api/lines', { code: 'FLOW-' + (++seq), name: 'Flow test' })).json();
  const s1 = await (await j('POST', '/api/lines/' + line.id + '/stations', { name: 'Découpe' })).json();
  const s2 = await (await j('POST', '/api/lines/' + line.id + '/stations', { name: 'Soudure' })).json();

  const put = await j('PUT', '/api/lines/' + line.id + '/flow', {
    steps: [
      { id: s1.id, pos_x: 100, pos_y: 50, step_kind: 'debut' },
      { id: s2.id, pos_x: 320, pos_y: 50 },
    ],
    edges: [{ from: s1.id, to: s2.id }],
  });
  assert.equal(put.status, 200);
  const f = await put.json();
  assert.equal(f.steps.length, 2);
  assert.equal(f.steps.find((x: { id: number }) => x.id === s1.id).pos_x, 100);
  assert.equal(f.steps.find((x: { id: number }) => x.id === s1.id).step_kind, 'debut');
  assert.equal(f.edges.length, 1);
  assert.equal(f.edges[0].from, s1.id);
  assert.equal(f.edges[0].to, s2.id);

  // relecture GET
  const g = await (await j('GET', '/api/lines/' + line.id + '/flow')).json();
  assert.equal(g.edges[0].from, s1.id);

  // step d'une autre ligne = 400
  const other = await (await j('POST', '/api/lines', { code: 'FLOW2-' + (++seq), name: 'Autre' })).json();
  const bad = await j('PUT', '/api/lines/' + other.id + '/flow', {
    steps: [{ id: s1.id, pos_x: 0, pos_y: 0 }],
    edges: [],
  });
  assert.equal(bad.status, 400);

  // export dérivé inchangé : les steps portent toujours les contrôles
  const ctl = await (await j('POST', '/api/stations/' + s2.id + '/controls', { characteristic: 'Contrôle soudure' })).json();
  const exp = await j('GET', '/api/lines/' + line.id + '/export');
  assert.equal(exp.status, 200);
  const md = await exp.text();
  assert.ok(md.includes('Découpe'));
  assert.ok(md.includes('Contrôle soudure'));
  assert.ok(ctl.id > 0);
});

