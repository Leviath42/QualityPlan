import { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Db } from "./db.js";

// Serveur MCP natif de QualityPlan - stateless, un serveur + transport neufs par requête.
// Même pattern que le canal MCP de modop (C-90) : POST seul, Bearer QP_MCP_TOKEN.

const lineIdSchema = z.string().describe("Identifiant de la ligne");
const scopeSchema = z.enum(["line", "station", "control"]).describe("Portée du document");
const idSchema = z.number().int().describe("Identifiant du scope");

export function mcpEnabled(): boolean {
  return Boolean(process.env.QP_MCP_TOKEN);
}

function docsOfScope(db: Db, scopeType: string, scopeId: number) {
  return db
    .prepare("SELECT id, source, modop_ref, title, url FROM documents WHERE scope_type = ? AND scope_id = ? ORDER BY id")
    .all(scopeType, scopeId);
}

function lineFlowJson(db: Db, lineId: string): unknown {
  const steps = db.prepare("SELECT id, kind, label, pos_x, pos_y FROM steps WHERE line_id = ? ORDER BY id").all(lineId);
  const edges = db
    .prepare("SELECT from_step_id, to_step_id FROM flow_edges WHERE line_id = ? ORDER BY from_step_id")
    .all(lineId) as Array<{ from_step_id: number; to_step_id: number }>;
  return {
    line_id: lineId,
    steps,
    edges: edges.map((e) => ({ from: e.from_step_id, to: e.to_step_id })),
  };
}

function lineMatrixJson(db: Db, lineId: string): unknown {
  const steps = (db.prepare("SELECT id, kind, label FROM steps WHERE line_id = ? ORDER BY id").all(lineId) as any[]);
  const controls = (db
    .prepare("SELECT id, station_id, label, ctq_codes FROM controls WHERE station_id IN (SELECT id FROM steps WHERE line_id = ?) ORDER BY id")
    .all(lineId) as any[]);
  const ctqs = db.prepare("SELECT code, label, family, regime FROM ctqs ORDER BY code").all() as any[];
  const covered = new Set<string>();
  const byStep = new Map<number, string[]>();
  for (const c of controls) {
    const codes = JSON.parse(c.ctq_codes ?? "[]") as string[];
    byStep.set(c.station_id, (byStep.get(c.station_id) ?? []).concat(codes));
    codes.forEach((k) => covered.add(k));
  }
  const families = new Map<string, { total: number; covered: number }>();
  for (const cq of ctqs) {
    const f = families.get(cq.family) ?? { total: 0, covered: 0 };
    f.total += 1;
    if (covered.has(cq.code)) f.covered += 1;
    families.set(cq.family, f);
  }
  const orphans = ctqs.filter((cq) => !covered.has(cq.code)).map((cq) => cq.code);
  const coverage = ctqs.length ? Math.round((covered.size / ctqs.length) * 100) : 0;
  return { coverage_pct: coverage, covered_count: covered.size, ctq_count: ctqs.length, orphans, families: Object.fromEntries(families) };
}

function linePlJson(db: Db, lineId: string): unknown {
  const line = db.prepare("SELECT id, name FROM lines WHERE id = ?").get(lineId) as { id: string; name: string } | undefined;
  if (!line) throw new Error("Ligne inconnue: " + lineId);
  const steps = (db.prepare("SELECT * FROM steps WHERE line_id = ? ORDER BY id").all(lineId) as any[]).map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    controls: (db.prepare("SELECT * FROM controls WHERE station_id = ? ORDER BY id").all(s.id) as any[]).map((ct) => ({
      id: ct.id,
      label: ct.label,
      ctq_codes: JSON.parse(ct.ctq_codes ?? "[]"),
      documents: docsOfScope(db, "control", Number(ct.id)),
    })),
    documents: docsOfScope(db, "station", Number(s.id)),
  }));
  return { line, generic_documents: docsOfScope(db, "line", Number(line.id)), steps };
}

function getDbClient(db: Db) { return db; }

export async function handleMcp(req: Request, res: Response): Promise<void> {
  const db = (req.app.locals.db as Db);
  const token = process.env.QP_MCP_TOKEN ?? "";
  const provided = req.headers.authorization ?? "";
  const got = provided.startsWith("Bearer ") ? provided.slice(7) : "";
  if (!token || !got || got.length !== token.length || !timingSafeEqual(Buffer.from(got), Buffer.from(token))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = new McpServer(
    { name: "qualityplan", version: "0.3.0" },
    { instructions: "API QualityPlan : lignes, steps/flowchart, contrôles, CTQ, plans de surveillance. Outils en lecture seule." }
  );

  const t = (name: string, title: string, data: unknown) =>
    server.tool(name, title, {}, async () => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] }));

  server.tool("list_lines", "Liste des lignes de production.", {}, async () => {
    const rows = db.prepare("SELECT id, name FROM lines ORDER BY id").all() as any[];
    return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
  });
  server.tool("get_line", "Plan de surveillance complet d'une ligne (steps, contrôles, CTQ, documents).", { line_id: lineIdSchema }, async (a) => ({
    content: [{ type: "text" as const, text: JSON.stringify(linePlJson(db, a.line_id)) }],
  }));
  server.tool("get_flow", "Flowchart d'une ligne : steps et edges.", { line_id: lineIdSchema }, async (a) => ({
    content: [{ type: "text" as const, text: JSON.stringify(lineFlowJson(db, a.line_id)) }],
  }));
  server.tool("get_matrix", "Matrice de couverture CTQ d'une ligne.", { line_id: lineIdSchema }, async (a) => ({
    content: [{ type: "text" as const, text: JSON.stringify(lineMatrixJson(db, a.line_id)) }],
  }));
  server.tool("list_ctqs", "Bibliothèque CTQ.", {}, async () => {
    const rows = db.prepare("SELECT code, label, family, regime FROM ctqs ORDER BY code").all();
    return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
  });
  server.tool("list_documents", "Documents liés pour un scope (line / station / control).", { scope_type: scopeSchema, scope_id: idSchema }, async (a) => ({
    content: [{ type: "text" as const, text: JSON.stringify(docsOfScope(db, a.scope_type, a.scope_id)) }],
  }));

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
