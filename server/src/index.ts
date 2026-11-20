import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { handleMcp, mcpEnabled } from './mcp.js';
import { DEFAULT_CTQS } from './default-ctqs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

const dbFile = process.env.QP_DB || '/opt/qualityplan/data/qualityplan.db';
const db = openDb(dbFile);

// Seed CTQ par défaut si bibliothèque vide (première exécution uniquement)
const n = (db.prepare('SELECT COUNT(*) AS n FROM ctqs').get() as { n: number }).n;
if (n === 0) {
  const ins = db.prepare('INSERT INTO ctqs(code, label, family, regime) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const c of DEFAULT_CTQS) ins.run(c.code, c.label, c.family, c.regime);
  });
  tx();
  console.log('[qualityplan] seed: ' + DEFAULT_CTQS.length + ' CTQ par défaut insérés');
}

const app = buildApp(db);

// Canal MCP natif (POST /mcp, Bearer QP_MCP_TOKEN)
if (mcpEnabled()) {
  app.post('/mcp', handleMcp as any);
}

// Front statique (build web) si présent, sinon message d'info sur les routes non-API
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => { res.sendFile(path.join(webDist, 'index.html')); });
} else {
  app.get('*', (_req, res) => {
    res.status(200).send('QualityPlan API — front non déployé (web/dist absent)');
  });
}

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log('[qualityplan] API sur http://' + host + ':' + port + ' (db: ' + dbFile + ')');
});
