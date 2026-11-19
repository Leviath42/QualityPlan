// Client API QualityPlan — wrappers fetch, erreurs remontées en Error lisibles.
export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const msg = typeof data === 'object' && data && 'error' in data
      ? String((data as { error: string }).error)
      : 'Erreur ' + r.status;
    throw new Error(msg);
  }
  return data as T;
}

export const GET = <T>(u: string) => api<T>('GET', u);
export const POST = <T>(u: string, b?: unknown) => api<T>('POST', u, b);
export const PUT = <T>(u: string, b?: unknown) => api<T>('PUT', u, b);
export const DEL = <T>(u: string) => api<T>('DELETE', u);

// ---- Types -----------------------------------------------------------------

export interface Line {
  id: number; code: string; name: string; product_line: string; client: string; ref: string;
  redacteur: string; verificateur: string; approbateur: string;
  created_at: string; updated_at: string;
  stations?: Station[];
}
export interface Station { id: number; line_id: number; name: string; ordre: number; controls?: Control[] }
export interface Control {
  id: number; station_id: number; characteristic: string; kind: string; doc_ref: string;
  method: string; support: string; frequency: string; responsible: string; reaction: string;
  ctq_ids?: number[];
}
export interface Ctq { id: number; code: string; label: string; family: string; regime: string }
export interface MatrixCtq {
  ctq_id: number; code: string; label: string; family: string; regime: string;
  points: number; status: 'couvert' | 'partiel' | 'angle_mort';
  controls: Array<{ id: number; characteristic: string; station_id: number }>;
}
export interface Matrix {
  line_id: number; line_code: string; coverage: number | null;
  ctqs: MatrixCtq[];
  orphans: Array<{ id: number; characteristic: string; station_id: number }>;
  families: Array<{ family: string; total: number; covered: number; partial: number; blind: number }>;
}
