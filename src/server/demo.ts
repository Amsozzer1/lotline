/** pnpm demo: reset the database, backfill the demo tools from results/demo.json, then serve. */
import { buildApp } from "./app";
import { backfillTool } from "./backfill";
import { loadServerConfig, WEB_DIST } from "./config";
import { createPool, resetDb } from "./db";
import { Ingestor } from "./ingest";

const PORT = Number(process.env.PORT ?? 8787);
const cfg = loadServerConfig();
const pool = createPool();
const log = (m: string) => console.log(m);
await resetDb(pool);
const ingestor = new Ingestor(pool, { log });
for (const t of cfg.demo.tools) {
  const t0 = Date.now();
  await backfillTool(ingestor, { ...t, delta: cfg.demo.delta }, cfg.demo.nRuns, cfg.r);
  log(`backfilled ${t.displayId}: ${cfg.demo.nRuns} runs (${t.scenario}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const app = buildApp({ pool, ingestor, detectors: cfg, webDist: WEB_DIST, mqttStatus: () => "off" });
await app.listen({ port: PORT, host: "127.0.0.1" });
log(`lotline demo: http://localhost:${PORT}/tools/${cfg.demo.tools[0].displayId}`);
