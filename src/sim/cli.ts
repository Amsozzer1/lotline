/**
 * pnpm sim --tool <id> [--speed N]
 * Streams the next run of a demo tool over MQTT, continuing that tool's own schedule (seed and
 * simulator tool from results/demo.json) at the next run index. Frames go out at 10 Hz x speed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mqtt from "mqtt";
import { schedule } from "../domain/schedule";
import { MQTT_URL, RUN_TOPIC } from "../server/mqtt";
import { runMessages } from "./runMessages";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const toolId = arg("tool");
const speed = Number(arg("speed") ?? 20);
const base = process.env.LOTLINE_URL ?? "http://localhost:8787";
const demo = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "results", "demo.json"), "utf8"));
const tool = demo.tools.find((t: { displayId: string }) => t.displayId === toolId);
if (!tool) {
  console.error(`usage: pnpm sim --tool <${demo.tools.map((t: { displayId: string }) => t.displayId).join("|")}> [--speed N]`);
  process.exit(1);
}
const health = await (await fetch(`${base}/api/healthz`)).json();
if (health.mqtt !== "subscribed") {
  console.error(`the server is not subscribed to MQTT yet (status: ${health.mqtt}); start it with pnpm demo`);
  process.exit(1);
}
const tools = (await (await fetch(`${base}/api/tools`)).json()) as { id: string; runCount: number }[];
const runIdx = (tools.find((t) => t.id === tool.displayId)?.runCount ?? 0) + 1;
const run = schedule(tool.seed, tool.simToolId, runIdx)[runIdx - 1];

const client = await mqtt.connectAsync(MQTT_URL, { clientId: `lotline-sim-${tool.displayId}-${process.pid}` });
const topic = RUN_TOPIC(tool.displayId);
const frameDelayMs = 100 / speed;
const t0 = Date.now();
let frames = 0;
console.log(`${tool.displayId}: streaming run ${runIdx} (recipe v${run.versionIdx}, ${run.recipe.tempC} °C) at ${speed}x`);
for (const msg of runMessages({ ...tool, delta: demo.delta }, run, demo.r)) {
  await client.publishAsync(topic, JSON.stringify(msg), { qos: 1 });
  if (msg.kind === "frame") {
    frames++;
    const due = t0 + frames * frameDelayMs;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
await client.endAsync();
console.log(`${tool.displayId}: run ${runIdx} sent, ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
