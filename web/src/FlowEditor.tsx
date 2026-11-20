import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GET, POST, PUT, DEL, getFlow, saveFlow, flowToMermaid } from './api';
import type { Station, Control, Ctq, Line, FlowEdge } from './api';
import { DocSection } from './Documents';

// ---------------------------------------------------------------------------
// v0.2 : le flowchart est le premier citoyen — les steps portent les contrôles,
// le plan de surveillance (PL) est une vue dérivée (voir PlView dans App.tsx).
// ---------------------------------------------------------------------------

type StepData = {
  name: string;
  step_kind: NonNullable<Station['step_kind']>;
  nControls: number;
  selected?: boolean;
};

export function FlowEditor({ line, ctqs, onLineChanged, setErr }: {
  line: Line;
  ctqs: Ctq[];
  onLineChanged: () => void;
  setErr: (s: string) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showText, setShowText] = useState(false);
  const [reload, setReload] = useState(0);
  const idSeq = useRef(1);

  const toNodes = useCallback((steps: Station[]): Node<StepData>[] =>
    steps.map((s) => ({
      id: String(s.id),
      type: 'step',
      position: { x: s.pos_x ?? 0, y: s.pos_y ?? 0 },
      data: {
        name: s.name,
        step_kind: s.step_kind ?? 'etape',
        nControls: s.controls?.length ?? 0,
      },
      selected: s.id === selectedStepId,
    })), [selectedStepId]);

  const load = useCallback(async () => {
    try {
      const flow = await getFlow(line.id);
      const full = await GET<Line>('/api/lines/' + line.id);
      const controlsByStep = new Map<number, Control[]>();
      for (const st of full.stations ?? []) controlsByStep.set(st.id, st.controls ?? []);
      setNodes(flow.steps.map((s) => ({
        id: String(s.id),
        type: 'step',
        position: { x: s.pos_x ?? 0, y: s.pos_y ?? 0 },
        data: {
          name: s.name,
          step_kind: s.step_kind ?? 'etape',
          nControls: (controlsByStep.get(s.id) ?? []).length,
        },
      })));
      setEdges(flow.edges.map((e) => ({
        id: 'e' + e.from + '-' + e.to,
        source: String(e.from),
        target: String(e.to),
        markerEnd: { type: MarkerType.ArrowClosed },
      })));
      setDirty(false);
    } catch (e) { setErr(String(e)); }
  }, [line.id, setErr, reload]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const steps = nodes.map((n, i) => ({
        id: Number(n.id),
        name: n.data.name,
        step_kind: n.data.step_kind,
        pos_x: Math.round(n.position.x),
        pos_y: Math.round(n.position.y),
        ordre: i,
      }));
      const es: FlowEdge[] = edges.map((e) => ({ from: Number(e.source), to: Number(e.target) }));
      await saveFlow(line.id, { steps: steps as unknown as Station[], edges: es });
      setDirty(false);
      onLineChanged();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  }

  async function addStep() {
    try {
      const st = await POST<Station>('/api/lines/' + line.id + '/stations', {
        name: 'Étape ' + idSeq.current++,
        ordre: nodes.length,
        pos_x: 60 + (nodes.length % 4) * 40,
        pos_y: 60 + Math.floor(nodes.length / 4) * 40,
      });
      const nn: Node<StepData> = {
        id: String(st.id), type: 'step',
        position: { x: st.pos_x ?? 0, y: st.pos_y ?? 0 },
        data: { name: st.name, step_kind: (st.step_kind ?? 'etape') as NonNullable<Station['step_kind']>, nControls: 0 },
      };
      setNodes((ns) => [...ns, nn]);
      setDirty(true);
    } catch (e) { setErr(String(e)); }
  }

  async function deleteStep(id: number) {
    try {
      await DEL('/api/stations/' + id);
      setNodes((ns) => ns.filter((n) => n.id !== String(id)));
      setEdges((es) => es.filter((e) => e.source !== String(id) && e.target !== String(id)));
      if (selectedStepId === id) setSelectedStepId(null);
      onLineChanged();
    } catch (e) { setErr(String(e)); }
  }

  function patchStepData(id: number, patch: Partial<StepData>) {
    setNodes((ns) => ns.map((n) => n.id === String(id) ? { ...n, data: { ...n.data, ...patch } } : n));
    setDirty(true);
  }

  const onConnect = useCallback((conn: Connection) => {
    setEdges((es) => addEdge({ ...conn, id: 'e' + conn.source + '-' + conn.target, markerEnd: { type: MarkerType.ArrowClosed } }, es));
    setDirty(true);
  }, []);

  const selectedNode = nodes.find((n) => n.id === String(selectedStepId));
  const mermaid = flowToMermaid({
    steps: nodes.map((n) => ({ id: Number(n.id), name: n.data.name, step_kind: n.data.step_kind, line_id: line.id, ordre: 0 })) as Station[],
    edges: edges.map((e) => ({ from: Number(e.source), to: Number(e.target) })),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button className="btn" onClick={addStep}>+ Étape</button>
        <button className="btn" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Sauvegarde…' : dirty ? 'Enregistrer le flow' : 'Enregistré'}
        </button>
        {dirty && <span className="text-amber-600 text-sm">modifications non enregistrées</span>}
        <button className="btn-alt ml-auto" onClick={() => setShowText((v) => !v)}>{showText ? 'Masquer' : 'Vue texte (Mermaid)'}</button>
      </div>
      {showText && (
        <pre className="bg-slate-900 text-emerald-300 text-xs rounded p-3 mb-2 overflow-auto">{mermaid}</pre>
      )}
      <div className="flex gap-3 items-start">
        <div className="flex-1 bg-white rounded shadow" style={{ height: 520 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => setDirty(true)}
            onEdgesChange={(c) => { onEdgesChange(c); setDirty(true); }}
            onConnect={onConnect}
            nodeTypes={{ step: StepNode }}
            onNodeClick={(_e, n) => setSelectedStepId(Number(n.id))}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {selectedNode && (
          <StepInspector
            key={selectedNode.id}
            stepId={Number(selectedNode.id)}
            name={selectedNode.data.name}
            stepKind={selectedNode.data.step_kind}
            ctqs={ctqs}
            onRename={(name) => patchStepData(Number(selectedNode.id), { name })}
            onKind={(k) => patchStepData(Number(selectedNode.id), { step_kind: k })}
            onControlAdded={() => patchStepData(Number(selectedNode.id), { nControls: selectedNode.data.nControls + 1 })}
            onControlDeleted={() => patchStepData(Number(selectedNode.id), { nControls: Math.max(0, selectedNode.data.nControls - 1) })}
            onDelete={() => deleteStep(Number(selectedNode.id))}
            setErr={setErr}
          />
        )}
      </div>
    </div>
  );
}

// Node custom : handle haut (entrées) / bas (sorties), badge type + nb contrôles
function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const KIND_LABEL: Record<string, string> = {
    debut: 'DÉBUT', etape: 'ÉTAPE', controle: 'CONTRÔLE', decision: 'DÉCISION', fin: 'FIN',
  };
  return (
    <div className={
      'stepnode border-2 rounded px-3 py-2 min-w-[110px] text-center bg-white ' +
      (selected ? 'border-blue-600 shadow-lg' : 'border-slate-400')
    }>
      <Handle type="target" position={Position.Top} />
      <div className="text-[10px] font-bold tracking-wide text-slate-500">{KIND_LABEL[data.step_kind] || 'ÉTAPE'}</div>
      <div className="text-sm font-medium">{data.name}</div>
      <div className="text-[10px] text-blue-600">{data.nControls} contrôle{data.nControls > 1 ? 's' : ''}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// Inspecteur latéral : step + ses contrôles (moyens, fréquence, CTQ…)
const FIELDS: Array<[keyof Control, string]> = [
  ['doc_ref', 'Doc réf'],
  ['method', 'Moyen'],
  ['support', 'Support'],
  ['frequency', 'Fréquence'],
  ['responsible', 'Responsable'],
  ['reaction', 'Réaction NC'],
];

function StepInspector({ stepId, name, stepKind, ctqs, onRename, onKind, onControlAdded, onControlDeleted, onDelete, setErr }: {
  stepId: number; name: string; stepKind: NonNullable<Station['step_kind']>; ctqs: Ctq[];
  onRename: (s: string) => void; onKind: (k: NonNullable<Station['step_kind']>) => void;
  onControlAdded: () => void; onControlDeleted: () => void; onDelete: () => void;
  setErr: (s: string) => void;
}) {
  const [controls, setControls] = useState<Control[]>([]);
  const [newName, setNewName] = useState('');
  const [newChar, setNewChar] = useState('');

  const load = useCallback(async () => {
    try {
      const line = await GET<Line>('/api/lines/' + (await GET<Station>('/api/stations/' + stepId)).line_id);
      const st = (line.stations ?? []).find((s) => s.id === stepId);
      setControls(st?.controls ?? []);
    } catch (e) { setErr(String(e)); }
  }, [stepId, setErr]);
  useEffect(() => { load(); }, [load]);

  async function addControl() {
    if (!newChar.trim()) return;
    try {
      await POST('/api/stations/' + stepId + '/controls', { characteristic: newChar });
      setNewChar(''); load(); onControlAdded();
    } catch (e) { setErr(String(e)); }
  }
  async function saveControl(c: Control) {
    try { await PUT('/api/controls/' + c.id, c); } catch (e) { setErr(String(e)); }
  }
  async function deleteControl(c: Control) {
    try { await DEL('/api/controls/' + c.id); load(); onControlDeleted(); } catch (e) { setErr(String(e)); }
  }
  async function link(c: Control, ids: number[]) {
    try { await PUT('/api/controls/' + c.id + '/ctqs', { ctq_ids: ids }); } catch (e) { setErr(String(e)); }
  }

  return (
    <div className="w-[420px] bg-white rounded shadow p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <input className="inp" defaultValue={name}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={() => newName.trim() && newName !== name && onRename(newName.trim())} />
        <select className="inp w-28" value={stepKind} onChange={(e) => onKind(e.target.value as NonNullable<Station['step_kind']>)}>
          {['debut', 'etape', 'controle', 'decision', 'fin'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <button className="text-red-600 hover:underline text-xs mb-2" onClick={onDelete}>Supprimer l'étape</button>

      <DocSection scope="stations" scopeId={stepId} label="Documents (modop) de l'étape" />

      <h3 className="font-bold text-sm mb-1">Contrôles de l'étape</h3>
      {controls.length === 0 && <p className="text-slate-500 text-xs mb-2">Aucun contrôle sur cette étape.</p>}
      {controls.map((c) => (
        <div key={c.id} className="border rounded p-2 mb-2">
          <input className="cellinp mb-1 w-full" defaultValue={c.characteristic}
            onChange={(e) => { c.characteristic = e.target.value; }}
            onBlur={() => saveControl(c)} placeholder="Caractéristique contrôlée" />
          <div className="grid grid-cols-2 gap-1">
            {FIELDS.map(([f, lbl]) => (
              <label key={f} className="text-[10px] text-slate-500">
                {lbl}
                <input className="cellinp w-full" defaultValue={String(c[f] ?? '')}
                  onChange={(e) => { (c as unknown as Record<string, string>)[f] = e.target.value; }}
                  onBlur={() => saveControl(c)} />
              </label>
            ))}
          </div>
          <div className="mt-1">
            <span className="text-[10px] text-slate-500">CTQ couverts (Ctrl+clic)</span>
            <select className="cellinp w-full" multiple size={3} value={(c.ctq_ids ?? []).map(String)}
              onChange={(e) => link(c, Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}>
              {ctqs.map((q) => <option key={q.id} value={q.id}>{q.code} — {q.label}</option>)}
            </select>
          </div>
          <DocSection scope="controls" scopeId={c.id} label="Documents du contrôle" />
          <button className="text-red-600 hover:underline text-[10px]" onClick={() => deleteControl(c)}>Supprimer ce contrôle</button>
        </div>
      ))}
      <div className="flex gap-1">
        <input className="cellinp flex-1" placeholder="+ Caractéristique…" value={newChar}
          onChange={(e) => setNewChar(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addControl()} />
        <button className="btn" onClick={addControl}>Ajouter</button>
      </div>
    </div>
  );
}
