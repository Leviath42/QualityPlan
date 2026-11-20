import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { createSession, destroySession, SESSION_COOKIE } from '../auth/sessions.js';
import { auditLog } from '../auth/audit.js';
import { requireAuth } from '../auth/middleware.js';
import { isTotpEnabled, validateTOTPCode } from '../auth/totp.js';
import { cookieSecure } from '../auth/security.js';

export function authRouter(db: Database.Database): Router {
  const router = Router();

  const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(200),
    totpCode: z.string().trim().regex(/^[0-9]{6}$/).optional(),
  });

  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
  });

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_request', message: 'Email ou mot de passe invalide' });
      return;
    }
    const { email, password, totpCode } = parsed.data;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | { id: number; email: string; password_hash: string; role: string; active: number }
      | undefined;
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      auditLog(db, email, 'login_echec', 'auth', 'Identifiants invalides (pas affiché)');
      res.status(401).json({ error: 'unauthorized', message: 'Email ou mot de passe incorrect' });
      return;
    }
    if (!user.active) {
      auditLog(db, email, 'login_refuse', 'auth', 'Compte désactivé');
      res.status(403).json({ error: 'forbidden', message: 'Compte désactivé' });
      return;
    }
    if (isTotpEnabled() && user.role === 'admin') {
      if (!totpCode || !validateTOTPCode(totpCode)) {
        auditLog(db, email, 'login_echec', 'auth', 'Code TOTP invalide ou absent');
        res.status(401).json({ error: 'unauthorized', message: 'Code de vérification requis' });
        return;
      }
    }
    const token = createSession(db, user.id);
    auditLog(db, email, 'login', 'auth', 'Connexion réussie');
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure(req),
      maxAge: Number(process.env.QP_SESSION_TTL_HOURS ?? 24) * 3600_000,
      path: '/',
    });
    res.json({ id: user.id, email: user.email, role: user.role });
  });

  // POST /api/auth/logout
  router.post('/logout', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = (req as any).user;
    if (token) destroySession(db, String(token));
    if (user?.email) auditLog(db, user.email, 'logout', 'auth', 'Déconnexion');
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth(), (req: Request, res: Response) => {
    const user = (req as any).user;
    res.json({ id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name });
  });

  // POST /api/auth/change-password
  router.post('/change-password', requireAuth(), (req: Request, res: Response) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_request', message: 'Champs invalides (minimum 8 caractères)' });
      return;
    }
    const user = (req as any).user;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined;
    if (!row || !row.password_hash || !bcrypt.compareSync(parsed.data.currentPassword, row.password_hash)) {
      auditLog(db, user.email, 'mdp_echec', 'auth', 'Mot de passe actuel incorrect');
      res.status(401).json({ error: 'unauthorized', message: 'Mot de passe actuel incorrect' });
      return;
    }
    const hash = bcrypt.hashSync(parsed.data.newPassword, bcrypt.genSaltSync(10));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    if (req.cookies?.[SESSION_COOKIE]) destroySession(db, String(req.cookies[SESSION_COOKIE]));
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    auditLog(db, user.email, 'mdp_change', 'auth', 'Mot de passe modifié — sessions fermées');
    res.json({ ok: true });
  });

  return router;
}
