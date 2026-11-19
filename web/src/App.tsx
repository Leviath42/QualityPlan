import { useEffect, useState, useCallback } from 'react';
import { GET, POST, PUT, DEL } from './api';
import type { Line, Station, Control, Ctq, Matrix } from './api';

// ---------------------------------------------------------------------------
// Chantier v0.1 : lignes/gammes > postes > contrôles + matrice CTQ.
// Standard modop (React+Vite+Tailwind), périmètre CDC (pas d'auth, single-user).
// ---------------------------------------------------------------------------

type View = { page: 'home' } | { page: 'line'; id: number } | { page: 'ctqs' } | { page: 'matrix'; id: number };

export function App() {
  const [view, setView] = useState<View>({ page: 'home' });
  const [err, setErr] = useState('');
  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-6">
        <button className="text-lg font-bold" onClick={() => setView({ page: 'home' })}>
          QualityPlan
        </button>
        <span className="text-slate-300 text-sm">Plans de surveillance &amp; CTQ</span>
        <nav className="ml-auto flex gap-4 text-sm">
          <button className="hover:underline" onClick={() => setView({ page: 'home' })}>Lignes</button>
          <button className="hover:underline" onClick={() => setView({ page: 'ctqs' })}>CTQ</button>
        </nav>
      </header>
      {err && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 flex items-center">
          <span className="flex-1">{err}</span>
          <button className="font-bold" onClick={() => setErr('')}>×</button>
        </div>
      )}
      <main className="p-6 max-w-6xl mx-auto">
        {view.page === 'home' && <Home onOpen={(id) => setView({ page: 'line', id })} setErr={setErr} />}
        {view.page === 'line' && <LineDetail id={view.id} setView={setView} setErr={setErr} />}
        {view.page === 'ctqs' && <CtqLib setErr={setErr} />}
        {view.page === 'matrix' && <MatrixView id={view.id} setView={setView} setErr={setErr} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home — liste des lignes
// ---------------------------------------------------------------------------

function Home({ onOpen, setErr }: { onOpen: (id: number) => void; setErr: (s: string) => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [form, setForm] = useState({ code: '', name: '', product_line: '', client: '' });

  const load = useCallback(async () => {
    try { setLines(await GET<Line[]>('/api/lines')); } catch (e) { setErr(String(e)); }
  }, [setErr]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const l = await POST<Line>('/api/lines', form);
      setForm({ code: '', name: '', product_line: '', client: '' });
      onOpen(l.id);
    } catch (e) { setErr(String(e)); }
  }

  return (
    <section>
      <h1 className="text-xl font-bold mb-4">Lignes / gammes</h1>
      {lines.length === 0 && <p className="text-slate-500">Aucune ligne. Crée la première ci-dessous.</p>}
      <table className="w-full bg-white rounded shadow text-sm">
        <thead className="bg-slate-200 text-left">
          <tr><th className="p-2">Code</th><th className="p-2">Nom</th><th className="p-2">Produit</th><th className="p-2">Client</th><th className="p-2">MAJ</th><th className="p-2"></th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="p-2 font-mono">{l.code}</td>
              <td className="p-2">{l.name}</td>
              <td className="p-2">{l.product_line}</td>
              <td className="p-2">{l.client}</td>
              <td className="p-2 text-slate-500">{l.updated_at}</td>
              <td className="p-2 text-right">
                <button className="text-blue-600 hover:underline" onClick={() => onOpen(l.id)}>Ouvrir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-8 mb-2 font-bold">Nouvelle ligne</h2>
      <div className="flex flex-wrap gap-2">
        <input className="inp" placeholder="Code (ex. L1-NH00)" value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <input className="inp flex-1" placeholder="Nom (ex. Gamme fusible NH00)" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="inp" placeholder="Ligne produit" value={form.product_line}
          onChange={(e) => setForm({ ...form, product_line: e.target.value })} />
        <input className="inp" placeholder="Client" value={form.client}
          onChange={(e) => setForm({ ...form, client: e.target.value })} />
        <button className="btn" onClick={create}>Créer</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Détail ligne — en-tête, postes, contrôles, CTQ par contrôle
// ---------------------------------------------------------------------------

const FIELDS: Array<[keyof Control, string]> = [
  ['doc_ref', 'Doc réf'],
  ['method', 'Moyen'],
  ['support', 'Support enregistrement'],
  ['frequency', 'Fréquence'],
  ['responsible', 'Responsable'],
  ['reaction', 'Réaction NC'],
];

function LineDetail({ id, setView, setErr }: { id: number; setView: (v: View) => void; setErr: (s: string) => void }) {
  const [line, setLine] = useState<Line | null>(null);
  const [ctqs, setCtqs] = useState<Ctq[]>([]);
  const [stName, setStName] = useState('');

  const load = useCallback(async () => {
    try {
      setLine(await GET<Line>(`/api/lines/${id}`));
      setCtqs(await GET<Ctq[]>('/api/ctqs'));
    } catch (e) { setErr(String(e)); }
  }, [id, setErr]);
  useEffect(() => { load(); }, [load]);

  if (!line) return <p>Chargement…</p>;
  const st = (line.stations || []) as Array<Station & { controls?: Control[] }>;

  async function saveHeader(patch: Partial<Line>) {
    try { await PUT(`/api/lines/${id}`, patch); } catch (e) { setErr(String(e)); }
  }
  async function addStation() {
    if (!stName.trim()) return;
    try {
      await POST(`/api/lines/${id}/stations`, { name: stName, ordre: st.length });
      setStName(''); load();
    } catch (e) { setErr(String(e)); }
  }
  async function addControl(stationId: number, characteristic: string) {
    try {
      await POST(`/api/stations/${stationId}/controls`, { characteristic });
      load();
    } catch (e) { setErr(String(e)); }
  }
  async function saveControl(c: Control) {
    try { await PUT(`/api/controls/${c.id}`, c); } catch (e) { setErr(String(e)); }
  }
  async function linkCtq(controlId: number, ctqIds: number[]) {
    try { await PUT(`/api/controls/${controlId}/ctqs`, { ctq_ids: ctqIds }); } catch (e) { setErr(String(e)); }
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <button className="text-blue-600 hover:underline text-sm" onClick={() => setView({ page: 'home' })}>← Lignes</button>
        <h1 className="text-xl font-bold">{line.code} — {line.name}</h1>
        <button className="btn ml-auto" onClick={() => setView({ page: 'matrix', id })}>Matrice CTQ</button>
        <a className="btn-alt" href={`/api/lines/${id}/export`} target="_blank" rel="noreferrer">Export MD</a>
      </div>

      <div className="grid grid-cols-4 gap-2 bg-white rounded shadow p-3 text-sm mb-6">
        {([['ref', 'Réf (PL …)'], ['product_line', 'Ligne produit'], ['client', 'Client'],
           ['redacteur', 'Rédacteur'], ['verificateur', 'Vérificateur'], ['approbateur', 'Approbateur']] as Array<[keyof Line, string]>).map(([k, lbl]) => (
          <label key={String(k)} className="flex flex-col">
            <span className="text-xs text-slate-500">{lbl}</span>
            <input className="inp" defaultValue={String(line[k] ?? '')}
              onBlur={(e) => saveHeader({ [k]: e.target.value } as Partial<Line>)} />
          </label>
        ))}
      </div>

      {st.map((s) => (
        <div key={s.id} className="mb-6">
          <h2 className="font-bold mb-1">Poste {s.ordre + 1} — {s.name}</h2>
          <table className="w-full bg-white rounded shadow text-xs">
            <thead className="bg-slate-200 text-left">
              <tr>
                <th className="p-2">Caractéristique contrôlée</th>
                {FIELDS.map(([f, lbl]) => <th key={f} className="p-2">{lbl}</th>)}
                <th className="p-2">CTQ couverts</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {((s.controls as Control[]) || []).map((c) => (
                <ControlRow key={c.id} c={c} ctqs={ctqs} onSave={saveControl} onLink={linkCtq} />
              ))}
              <tr className="border-t bg-slate-50">
                <NewControlRow colCount={FIELDS.length + 3} onAdd={(v) => addControl(s.id, v)} />
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex gap-2">
        <input className="inp" placeholder="Nouveau poste (ex. Montage voyant)" value={stName}
          onChange={(e) => setStName(e.target.value)} />
        <button className="btn" onClick={addStation}>Ajouter poste</button>
      </div>
    </section>
  );
}

function ControlRow({ c, ctqs, onSave, onLink }: {
  c: Control; ctqs: Ctq[];
  onSave: (c: Control) => void; onLink: (id: number, ids: number[]) => void;
}) {
  const [ctrl, setCtrl] = useState<Control>(c);
  const [links, setLinks] = useState<number[]>(c.ctq_ids || []);

  function upd(patch: Partial<Control>) {
    const next = { ...ctrl, ...patch };
    setCtrl(next);
    onSave(next);
  }

  return (
    <tr className="border-t">
      <td className="p-1">
        <input className="cellinp" value={ctrl.characteristic}
          onChange={(e) => upd({ characteristic: e.target.value })} />
      </td>
      {FIELDS.map(([f]) => (
        <td key={f} className="p-1">
          <input className="cellinp" value={String(ctrl[f] ?? '')}
            onChange={(e) => upd({ [f]: e.target.value } as Partial<Control>)} />
        </td>
      ))}
      <td className="p-1">
        <select className="cellinp" multiple size={Math.max(2, Math.min(6, ctqs.length))} value={links.map(String)}
          onChange={(e) => {
            const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
            setLinks(ids);
            onLink(c.id, ids);
          }}>
          {ctqs.map((q) => <option key={q.id} value={q.id}>{q.code} — {q.label}</option>)}
        </select>
      </td>
      <td className="p-1 text-center">
        <button className="text-red-600 hover:underline"
          onClick={async () => { await DEL(`/api/controls/${c.id}`); window.location.reload(); }}>Suppr.</button>
      </td>
    </tr>
  );
}

function NewControlRow({ colCount, onAdd }: { colCount: number; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <>
      <td className="p-1">
        <input className="cellinp" placeholder="+ Caractéristique…" value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onAdd(v); setV(''); } }} />
      </td>
      <td colSpan={colCount - 1}></td>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bibliothèque CTQ
// ---------------------------------------------------------------------------

function CtqLib({ setErr }: { setErr: (s: string) => void }) {
  const [ctqs, setCtqs] = useState<Ctq[]>([]);
  const [form, setForm] = useState({ code: '', label: '', family: '', regime: '' });

  const load = useCallback(async () => {
    try { setCtqs(await GET<Ctq[]>('/api/ctqs')); } catch (e) { setErr(String(e)); }
  }, [setErr]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    try { await POST('/api/ctqs', form); setForm({ code: '', label: '', family: '', regime: '' }); load(); }
    catch (e) { setErr(String(e)); }
  }

  return (
    <section>
      <h1 className="text-xl font-bold mb-4">Bibliothèque CTQ</h1>
      <table className="w-full bg-white rounded shadow text-sm">
        <thead className="bg-slate-200 text-left">
          <tr><th className="p-2">Code</th><th className="p-2">Libellé</th><th className="p-2">Famille</th><th className="p-2">Régime</th><th className="p-2"></th></tr>
        </thead>
        <tbody>
          {ctqs.map((q) => (
            <tr key={q.id} className="border-t">
              <td className="p-2 font-mono">{q.code}</td>
              <td className="p-2">{q.label}</td>
              <td className="p-2">{q.family}</td>
              <td className="p-2">{q.regime}</td>
              <td className="p-2 text-right">
                <button className="text-red-600 hover:underline"
                  onClick={async () => { await DEL(`/api/ctqs/${q.id}`); load(); }}>Suppr.</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-6 mb-2 font-bold">Nouveau CTQ</h2>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(form) as Array<keyof typeof form>).map((k) => (
          <input key={k} className="inp" placeholder={k} value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        ))}
        <button className="btn" onClick={add}>Ajouter</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Matrice CTQ × contrôles (règle PQG-FUS : couvert >= 2 points)
// ---------------------------------------------------------------------------

function MatrixView({ id, setView, setErr }: { id: number; setView: (v: View) => void; setErr: (s: string) => void }) {
  const [m, setM] = useState<Matrix | null>(null);

  const load = useCallback(async () => {
    try { setM(await GET<Matrix>(`/api/lines/${id}/matrix`)); } catch (e) { setErr(String(e)); }
  }, [id, setErr]);
  useEffect(() => { load(); }, [load]);

  if (!m) return <p>Chargement…</p>;

  function badge(status: string): string {
    if (status === 'couvert') return 'badge-couvert';
    if (status === 'partiel') return 'badge-partiel';
    return 'badge-angle';
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <button className="text-blue-600 hover:underline text-sm" onClick={() => setView({ page: 'line', id })}>← Plan</button>
        <h1 className="text-xl font-bold">Matrice CTQ — {m.line_code}</h1>
        <span className="ml-auto text-sm">
          Couverture globale :
          <strong className="ml-1">{m.coverage === null ? '-' : m.coverage + ' %'}</strong>
        </span>
      </div>

      {m.families.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          {m.families.map((f) => (
            <span key={f.family} className="bg-white rounded shadow px-3 py-1">
              <strong>{f.family}</strong> : {f.covered} couverts / {f.partial} partiels / {f.blind} angles morts
            </span>
          ))}
        </div>
      )}

      <table className="w-full bg-white rounded shadow text-sm">
        <thead className="bg-slate-200 text-left">
          <tr>
            <th className="p-2">Code</th><th className="p-2">CTQ</th><th className="p-2">Régime</th>
            <th className="p-2">Points</th><th className="p-2">Statut</th><th className="p-2">Contrôles</th>
          </tr>
        </thead>
        <tbody>
          {m.ctqs.map((x) => (
            <tr key={x.ctq_id} className="border-t align-top">
              <td className="p-2 font-mono">{x.code}</td>
              <td className="p-2">{x.label}</td>
              <td className="p-2">{x.regime}</td>
              <td className="p-2">{x.points}</td>
              <td className="p-2"><span className={badge(x.status)}>{x.status.replace('_', ' ')}</span></td>
              <td className="p-2 text-xs text-slate-600">
                {x.controls.map((c) => c.characteristic).join(' · ') || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {m.orphans.length > 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-300 rounded p-3 text-sm">
          <strong>Contrôles orphelins (aucun CTQ) :</strong>
          <ul className="list-disc ml-5 mt-1">
            {m.orphans.map((o) => <li key={o.id}>{o.characteristic}</li>)}
          </ul>
        </div>
      )}
      {m.orphans.length === 0 && (
        <p className="mt-4 text-green-700 text-sm">Aucun contrôle orphelin.</p>
      )}
    </section>
  );
}
