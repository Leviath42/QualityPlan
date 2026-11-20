import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

// CLI : creation d un compte QualityPlan.
// Usage : tsx src/create-user.ts <email> <password> [role]
// Roles : reader (defaut), author, admin. N affiche jamais le mot de passe.
const [emailArg, passwordArg, roleArg] = process.argv.slice(2);
if (!emailArg || !passwordArg) {
  console.error('Usage: tsx src/create-user.ts <email> <password> [role=admin|author|reader]');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const role = roleArg ?? 'reader';
if (!['reader', 'author', 'admin'].includes(role)) {
  console.error('Role invalide : ' + role + ' (reader|author|admin)');
  process.exit(1);
}

const dbPath = process.env.QP_DB ?? '/opt/qualityplan/data/qualityplan.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.error('Compte déjà existant : ' + email);
  process.exit(1);
}

const hash = bcrypt.hashSync(passwordArg, bcrypt.genSaltSync(10));
const info = db
  .prepare('INSERT INTO users (email, password_hash, role, active, auth_provider) VALUES (?, ?, ?, 1, ?)')
  .run(email, hash, role, 'local');

console.log('Compte créé : ' + email + ' (' + role + ', id ' + info.lastInsertRowid + ')');
db.close();
