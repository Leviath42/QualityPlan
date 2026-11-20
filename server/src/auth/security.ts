import type { Request, Response, NextFunction } from 'express';

// En-têtes de sécurité appliques a toutes les reponses (reprise standard modop).
export function securityHeaders(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
  };
}

// Rate limiting login en memoire : par IP + email, fenetre glissante (standard modop).
const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function loginRateLimiter() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (req.ip ?? '?') + ':' + String(req.body?.email ?? '').toLowerCase();
    const now = Date.now();
    const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= MAX_ATTEMPTS) {
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Trop de tentatives — réessayez dans 15 minutes',
      });
      return;
    }
    list.push(now);
    attempts.set(key, list);
    next();
  };
}

// Cookies secure : QP_SECURE_COOKIES=1 force Secure ; sinon auto derriere TLS (tunnel).
// Amelioration vs modop (env statique) : QP sert LAN http ET tunnel https, le flag
// doit suivre l'origine de la requete de login pour ne pas casser le LAN.
export function cookieSecure(req: Request): boolean {
  if (process.env.QP_SECURE_COOKIES === '1') return true;
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

// Tests : purge des compteurs de rate limit (jamais appele en prod).
export function resetRateLimits(): void {
  attempts.clear();
}
