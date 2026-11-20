import type { Request, Response, NextFunction } from 'express';

// Anti-CSRF (standard modop) : sur toute requete mutante, l origine doit
// correspondre a l hote servi. Absence d Origin acceptee (curl, tests).
// Hote de reference : X-Forwarded-Host (tunnel Cloudflare qui preserve l hote
// public) sinon Host. Allowlist optionnelle QP_ALLOWED_HOSTS (separee par virgules).
function allowedForwardedHosts(): Set<string> | null {
  const raw = process.env.QP_ALLOWED_HOSTS;
  if (!raw) return null;
  return new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

function forwardedHost(req: Request): string | null {
  const xfh = req.headers['x-forwarded-host'];
  const first = Array.isArray(xfh) ? xfh[0] : xfh;
  if (typeof first === 'string' && first.trim()) {
    const host = first.split(',')[0].trim().toLowerCase();
    const allow = allowedForwardedHosts();
    if (!allow || allow.has(host)) return host;
  }
  const host = req.headers.host;
  return typeof host === 'string' ? host.toLowerCase() : null;
}

export function assertSameOrigin(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      res.status(403).json({ error: 'forbidden', message: 'Requête cross-site refusée' });
      return;
    }
    if (typeof origin === 'string' && origin !== 'null') {
      const refHost = forwardedHost(req);
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null;
      }
      if (!refHost || !originHost || originHost !== refHost) {
        res.status(403).json({ error: 'forbidden', message: 'Requête cross-site refusée' });
        return;
      }
    }
    next();
  };
}
