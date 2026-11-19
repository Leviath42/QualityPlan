// Seed manuel : npm run seed (dans server/) — insère les CTQ par défaut si vide.
import { openDb } from './db.js';
import { DEFAULT_CTQS } from './default-ctqs.js';

const dbFile = process.env.QP_DB || './data/qualityplan.db';
const db = openDb(dbFile);
const n = (db.prepare(`SELECT COUNT(*) AS n FROM ctqs`).get() as { n: number }).n;
if (n > 0) {
  console.log(`[${n} CTQ déjà présents, rien à faire]`);
  process.exit(0);
}
const ins = db.prepare(`INSERT INTO ctqs(code, label, family, regime) VALUES (?, ?, ?, ?)`);
const tx = db.transaction(() => {
  for (const c of DEFAULT_CTQS) ins.run(c.code, c.label, c.family, c.regime);
});
tx();
console.log(`[seed OK: ${DEFAULT_CTQS.length} CTQ]`);
