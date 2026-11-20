import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

// Journal d'audit : qui a fait quoi, quand (reprise du standard modop).
export function auditLog(
  db: Database.Database,
  actorEmail: string,
  action: string,
  target = '',
  detail = ''
): void {
  db.prepare(
    'INSERT INTO audit_log (actor_email, action, target, detail) VALUES (?, ?, ?, ?)'
  ).run(actorEmail, action, target, detail);
}

// Nettoyage : purge au-delà de N jours (appelé au démarrage).
export function purgeAudit(db: Database.Database, days = 365): void {
  db.prepare("DELETE FROM audit_log WHERE at < datetime('now', ?)").run('-' + days + ' days');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
