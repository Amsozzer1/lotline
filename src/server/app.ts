import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { loadToolRuns, toolHealth, type DetectorConfig } from "./health";
import { loadRunHistory } from "./history";
import type { Ingestor } from "./ingest";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/** JSON cannot carry NaN; send null instead (Float64Array becomes a plain array). */
function jsonSafe(_k: string, v: unknown): unknown {
  if (v instanceof Float64Array) return Array.from(v, (x) => (Number.isFinite(x) ? x : null));
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}

export interface AppDeps {
  pool: pg.Pool;
  ingestor: Ingestor;
  detectors: DetectorConfig;
  webDist: string;
  mqttStatus: () => string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const send = (data: unknown) => JSON.stringify(data, jsonSafe);

  app.get("/api/healthz", async () => ({ ok: true, mqtt: deps.mqttStatus() }));

  app.get("/api/tools", async (_req, reply) => {
    const { rows } = await deps.pool.query<{ id: string; display_name: string }>("select id, display_name from tool order by id");
    const out = [];
    for (const t of rows) {
      const runs = await loadToolRuns(deps.pool, t.id);
      const h = toolHealth(runs, deps.detectors);
      const last = h.signals.lotline[h.signals.lotline.length - 1] ?? null;
      out.push({
        id: t.id,
        displayName: t.display_name,
        runCount: h.n,
        live: deps.ingestor.toolState.get(t.id) ?? { state: "idle", runIdx: h.n || null, stepIdx: null },
        lastRunFlagged: h.n > 0 && h.signals.lotline.some((a) => a.run === h.n),
        lastSignalRun: last?.run ?? null,
      });
    }
    reply.type("application/json").send(send(out));
  });

  app.get<{ Params: { id: string } }>("/api/tools/:id/health", async (req, reply) => {
    const runs = await loadToolRuns(deps.pool, req.params.id);
    if (runs.length === 0) return reply.code(404).send({ error: "unknown tool or no finished runs" });
    reply.type("application/json").send(send(toolHealth(runs, deps.detectors)));
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const h = await loadRunHistory(deps.pool, req.params.id, deps.detectors);
    if (!h) return reply.code(404).send({ error: "unknown run" });
    reply.type("application/json").send(send(h));
  });

  // The built SPA: real files, otherwise index.html (client-side routes /tools/:id and /runs/:id).
  app.get("/*", async (req, reply) => {
    const url = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/^\/+/, ""));
    const file = normalize(join(deps.webDist, url));
    if (url && file.startsWith(deps.webDist) && existsSync(file) && statSync(file).isFile()) {
      return reply.type(TYPES[extname(file)] ?? "application/octet-stream").send(readFileSync(file));
    }
    const index = join(deps.webDist, "index.html");
    if (!existsSync(index)) return reply.code(404).send("web build missing: run pnpm web:build");
    return reply.type(TYPES[".html"]).send(readFileSync(index));
  });

  return app;
}
