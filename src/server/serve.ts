/** pnpm dev: serve the API and the built SPA on the existing database (no reset, no backfill). */
import { buildApp } from "./app";
import { loadServerConfig, WEB_DIST } from "./config";
import { createPool } from "./db";
import { Ingestor } from "./ingest";

const PORT = Number(process.env.PORT ?? 8787);
const cfg = loadServerConfig();
const pool = createPool();
const ingestor = new Ingestor(pool, { log: (m) => console.log(m) });
const app = buildApp({ pool, ingestor, detectors: cfg, webDist: WEB_DIST, mqttStatus: () => "off", driftStart: (id) => (cfg.demo.tools.find((t) => t.displayId === id && t.scenario !== "none") ? cfg.s : null) });
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`lotline: http://localhost:${PORT}`);
