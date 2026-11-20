import { useEffect, useState, useCallback } from 'react';
import { GET, POST, PUT, DEL } from './api';
import { FlowEditor } from './FlowEditor';
import type { Line, Station, Control, Ctq, Matrix } from './api';

// ---------------------------------------------------------------------------
// QualityPlan v0.2 : flowchart = source de vérité, PL = vue dérivée.
// Onglets par ligne : Flowchart (édition) / Plan de surveillance (dérivé) / Matrice CTQ.
// ---------------------------------------------------------------------------

type Tab = 'flow' | 'pl' | 'matrix';
type View = { page: 'home' } | { page: 'line'; id: number; tab: Tab } | { page: 'ctqs' };

export function App() {
  const [view, setView] = useState<View>({ page: 'home' });
  const [err, setErr] = useState('');
  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center gap-6">
        <button className="text-lg font-bold" onClick={() => setView({ page: 'home' })}>
          QualityPlan
        </button>
        <span className="text-slate-300 text-sm">Flowcharts process & plans de surveillance</span>
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
      <main className="p-6 max-w-7xl mx-auto">
        {view.page === 'home' && <Home onOpen={(id) => setView({ page: 'line', id, tab: 'flow' })} setErr={setErr} />}
        {view.page === 'line' && <LinePage id={view.id} tab={view.tab} setView={setView} setErr={setErr} />}
        {view.page === 'ctqs' && <CtqLib setErr={setErr} />}
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
      {lines.length === 0 && <p className="text-slate-500">Aucune ligne. Crée la première ci-dessous, puis dessine son flowchart.</p>}
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
// Page ligne — onglets Flowchart / PL dérivé / Matrice
// ---------------------------------------------------------------------------

function LinePage({ id, tab, setView, setErr }: { id: number; tab: Tab; setView: (v: View) => void; setErr: (s: string) => void }) {
  const [line, setLine] = useState<Line | null>(null);
  const [ctqs, setCtqs] = useState<Ctq[]>([]);
  const [bump, setBump] = useState(0);

  const load = useCallback(async () => {
    try {
      setLine(await GET<Line>('/api/lines/' + id));
      setCtqs(await GET<Ctq[]>('/api/ctqs'));
    } catch (e) { setErr(String(e)); }
  }, [id, setErr]);
  useEffect(() => { load(); bump; }, [load, bump]);

  if (!line) return <p>Chargement…</p>;

  async function saveHeader(patch: Partial<Line>) {
    try { await PUT('/api/lines/' + id, patch); load(); } catch (e) { setErr(String(e)); }
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <button className="text-blue-600 hover:underline text-sm" onClick={() => setView({ page: 'home' })}>← Lignes</button>
        <h1 className="text-xl font-bold">{line.code} — {line.name}</h1>
        <div className="ml-auto flex gap-1">
          {(['flow', 'pl', 'matrix'] as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'btn' : 'btn-alt'} onClick={() => setView({ page: 'line', id, tab: t })}>
              {t === 'flow' ? 'Flowchart' : t === 'pl' ? 'Plan de surveillance' : 'Matrice CTQ'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 bg-white rounded shadow p-3 text-sm mb-4">
        {([['ref', 'Réf (PL …)'], ['product_line', 'Ligne produit'], ['client', 'Client'],
           ['redacteur', 'Rédacteur'], ['verificateur', 'Vérificateur'], ['approbateur', 'Approbateur']] as Array<[keyof Line, string]>).map(([k, lbl]) => (
          <label key={String(k)} className="flex flex-col">
            <span className="text-xs text-slate-500">{lbl}</span>
            <input className="inp" defaultValue={String(line[k] ?? '')} key={k + '-' + String(line.updated_at)}
              onBlur={(e) => saveHeader({ [k]: e.target.value } as Partial<Line>)} />
          </label>
        ))}
      </div>

      {tab === 'flow' && <FlowEditor line={line} ctqs={ctqs} onLineChanged={() => setBump((b) => b + 1)} setErr={setErr} />}
      {tab === 'pl' && <PlView line={line} setView={setView} />}
      {tab === 'matrix' && <MatrixView id={id} setView={setView} setErr={setErr} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan de surveillance — VUE DÉRIVÉE DU FLOWCHART (lecture seule)
// Les contrôles se saisissent dans le flowchart ; ici on lit, on exporte.
// ---------------------------------------------------------------------------

const PL_FIELDS: Array<[keyof Control, string]> = [
  ['doc_ref', 'Doc de référence'],
  ['method', 'Moyen'],
  ['support', 'Support enregistrements'],
  ['frequency', 'Fréquence'],
  ['responsible', 'Responsable'],
  ['reaction', 'Mode de réaction NC'],
];

function PlView({ line, setView }: { line: Line; setView: (v: View) => void }) {
  const st = (line.stations || []) as Array<Station & { controls?: Control[]; step_kind?: string }>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-slate-500 text-sm">Généré depuis le flowchart — modifie les étapes dans l'onglet Flowchart.</span>
        <a className="btn-alt ml-auto" href={'/api/lines/' + line.id + '/export'} target="_blank" rel="noreferrer">Export MD</a>
      </div>
      {st.length === 0 && <p className="text-slate-500">Aucune étape définie. Onglet Flowchart → « + Étape ».</p>}
      {st.map((s, i) => (
        <div key={s.id} className="mb-6">
          <h2 className="font-bold mb-1">{i + 1}. {s.name} <span className="text-xs text-slate-400">[{s.step_kind ?? 'etape'}]</span></h2>
          <table className="w-full bg-white rounded shadow text-xs">
            <thead className="bg-slate-200 text-left">
              <tr>
                <th className="p-2">Caractéristique contrôlée</th>
                {PL_FIELDS.map(([, lbl]) => <th key={lbl} className="p-2">{lbl}</th>)}
                <th className="p-2">CTQ</th>
              </tr>
            </thead>
            <tbody>
              {((s.controls as Control[]) || []).length === 0 && (
                <tr className="border-t"><td className="p-2 text-slate-400" colSpan={PL_FIELDS.length + 2}>Aucun contrôle défini sur cette étape.</td></tr>
              )}
              {((s.controls as Control[]) || []).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2 font-medium">{c.characteristic}{c.kind === 'moyen' ? ' <moyen>' : ''}</td>
                  {PL_FIELDS.map(([f]) => <td key={f} className="p-2">{String(c[f] ?? '') || '—'}</td>)}
                  <td className="p-2">{(c.ctq_ids ?? []).length > 0 ? (c.ctq_ids ?? []).join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <button className="btn-alt" onClick={() => setView({ page: 'line', id: line.id, tab: 'matrix' })}>Voir la matrice CTQ →</button>
    </div>
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
                  onClick={async () => { await DEL('/api/ctqs/' + q.id); load(); }}>Suppr.</button>
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
    try { setM(await GET<Matrix>('/api/lines/' + id + '/matrix')); } catch (e) { setErr(String(e)); }
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
        <button className="text-blue-600 hover:underline text-sm" onClick={() => setView({ page: 'line', id, tab: 'pl' })}>← Plan</button>
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
