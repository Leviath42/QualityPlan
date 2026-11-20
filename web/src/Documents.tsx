import { useCallback, useEffect, useState } from 'react';
import { GET, POST, DEL } from './api';

// Documents liés à une cible (ligne / étape / contrôle) — refs modop.
// Édition : recherche via le MCP modop (proxy /api/modop/search) + ajout manuel.

type Scope = 'lines' | 'stations' | 'controls';

export interface Doc {
  id: number; source: string; modop_ref: string; title: string; url: string;
}

interface Wf {
  id?: number; title?: string; reference?: string; state?: string; category_path?: string;
}

export function DocSection({ scope, scopeId, label }: { scope: Scope; scopeId: number; label?: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Wf[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ title: '', modop_ref: '', url: '' });
  const [err, setLocalErr] = useState('');

  const load = useCallback(async () => {
    try { setDocs(await GET<Doc[]>('/api/' + scope + '/' + scopeId + '/documents')); }
    catch (e) { setLocalErr(String(e)); }
  }, [scope, scopeId]);
  useEffect(() => { load(); }, [load]);

  async function search() {
    if (!q.trim()) { setResults(null); return; }
    setBusy(true); setLocalErr('');
    try { setResults(await GET<Wf[]>('/api/modop/search?q=' + encodeURIComponent(q.trim()))); }
    catch (e) { setLocalErr(String(e)); }
    finally { setBusy(false); }
  }

  async function addDoc(body: { title: string; modop_ref?: string; url?: string }) {
    setLocalErr('');
    try {
      await POST('/api/' + scope + '/' + scopeId + '/documents', body);
      setResults(null); setQ(''); setManual({ title: '', modop_ref: '', url: '' });
      load();
    } catch (e) { setLocalErr(String(e)); }
  }

  async function del(id: number) {
    try { await DEL('/api/documents/' + id); load(); } catch (e) { setLocalErr(String(e)); }
  }

  return (
    <div className="mt-2 text-xs">
      {label && <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>}
      {docs.length === 0 && <p className="text-slate-400">Aucun document lié.</p>}
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-1">
          {d.url
            ? <a className="text-blue-600 hover:underline truncate" href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
            : <span className="truncate">{d.title}</span>}
          {d.modop_ref && <span className="text-slate-400 font-mono">[{d.modop_ref}]</span>}
          <button className="text-red-600 hover:underline ml-auto" onClick={() => del(d.id)}>×</button>
        </div>
      ))}
      <div className="flex gap-1 mt-1">
        <input className="cellinp flex-1" placeholder="Chercher dans modop…"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn-alt" disabled={busy} onClick={search}>{busy ? '…' : 'Chercher'}</button>
      </div>
      {results && results.length === 0 && <p className="text-slate-400 mt-1">Aucun résultat côté modop.</p>}
      {results && results.map((w, i) => (
        <button key={w.id ?? i} className="block w-full text-left hover:bg-slate-100 rounded px-1"
          onClick={() => addDoc({
            title: w.title || w.reference || ('modop #' + (w.id ?? i)),
            modop_ref: String(w.reference ?? w.id ?? ''),
            url: String((w as { url?: string }).url ?? ''),
          })}>
          + {w.title || w.reference} {w.reference ? <span className="text-slate-400 font-mono">[{w.reference}]</span> : null}
          {w.category_path ? <span className="text-slate-400"> — {w.category_path}</span> : null}
        </button>
      ))}
      <details className="mt-1">
        <summary className="text-slate-500 cursor-pointer">Ajout manuel</summary>
        <div className="flex flex-wrap gap-1 mt-1">
          <input className="cellinp flex-1" placeholder="Titre" value={manual.title}
            onChange={(e) => setManual({ ...manual, title: e.target.value })} />
          <input className="cellinp w-24" placeholder="Ref" value={manual.modop_ref}
            onChange={(e) => setManual({ ...manual, modop_ref: e.target.value })} />
          <input className="cellinp w-40" placeholder="URL" value={manual.url}
            onChange={(e) => setManual({ ...manual, url: e.target.value })} />
          <button className="btn-alt" onClick={() => manual.title.trim() && addDoc(manual)}>Ajouter</button>
        </div>
      </details>
      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}
