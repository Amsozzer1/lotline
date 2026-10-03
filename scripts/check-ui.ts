/**
 * pnpm check-ui: browser checks for the tool page against a running `pnpm demo`.
 * - the flag at run X sits on the same pixel column in the version strip and both charts
 * - the shaded band spans X to the first out-of-spec wafer; the trend marker sits at its run
 * - the printed temperature bound is >= the API's raw maximum
 * - one click on the flag opens that run's page, with the banner
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.LOTLINE_URL ?? "http://localhost:8787";
const demo = JSON.parse(readFileSync(join(import.meta.dirname, "..", "results", "demo.json"), "utf8"));
const tool = demo.tools.find((t: { flagRun: number | null }) => t.flagRun !== null);
const health = await (await fetch(`${base}/api/tools/${tool.displayId}/health`)).json();
let ok = true;
const check = (cond: boolean, msg: string) => {
  ok &&= cond;
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1040, height: 900 } });
await page.goto(`${base}/tools/${tool.displayId}`);
await page.waitForSelector("[data-testid=lotline-flag]");

// x of the flag line in each chart, the strip tick, and the markers
// Plain-string script: the TypeScript runner would otherwise inject helpers the page does not have.
const geo = (await page.evaluate(`(() => {
  const lines = [...document.querySelectorAll(".recharts-reference-line line")].map((l) => {
    const r = l.getBoundingClientRect();
    return { x: r.left, w: r.width, h: r.height };
  });
  const tick = document.querySelector("[data-testid=strip-flag]").getBoundingClientRect().left;
  function center(sel) {
    const el = document.querySelector(sel + " circle, " + sel + " path");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }
  const areas = [...document.querySelectorAll(".recharts-reference-area path, .recharts-reference-area rect")].map((a) => {
    const r = a.getBoundingClientRect();
    return { left: r.left, right: r.right, h: r.height };
  });
  return { lines, tick, flag: center("[data-testid=lotline-flag]"), trend: center("[data-testid=trend-marker]"), oos: center("[data-testid=oos-marker]"), areas };
})()`)) as {
  lines: { x: number; w: number; h: number }[];
  tick: number;
  flag: number | null;
  trend: number | null;
  oos: number | null;
  areas: { left: number; right: number; h: number }[];
};
const vertical = geo.lines.filter((l) => l.w < 2 && l.h > 50);
// the flag line is the one closest to the flag marker in each chart
const flagX = geo.flag!;
const nearest = vertical.map((l) => l.x).sort((a, b) => Math.abs(a - flagX) - Math.abs(b - flagX)).slice(0, 2);
check(nearest.length === 2 && nearest.every((x) => Math.abs(x - flagX) <= 1.5), `flag line in both charts at the flag's column (${nearest.map((x) => x.toFixed(1)).join(", ")} vs ${flagX.toFixed(1)})`);
check(Math.abs(geo.tick - flagX) <= 1.5, `strip tick at the same column (${geo.tick.toFixed(1)})`);
const pxPerRun = (nearest[0] - (geo.trend ?? 0)) / (tool.flagRun - tool.trendRun);
check(geo.trend !== null && Math.abs((geo.trend! - flagX) / pxPerRun - (tool.trendRun - tool.flagRun)) < 0.05, `trend marker at run ${tool.trendRun}`);
check(geo.oos !== null && Math.abs((geo.oos! - flagX) / pxPerRun - (tool.firstOosRun - tool.flagRun)) < 0.05, `first out-of-spec marker at run ${tool.firstOosRun}`);
const band = geo.areas.find((a) => Math.abs(a.left - flagX) <= 1.5);
check(!!band && Math.abs((band.right - flagX) / pxPerRun - (tool.firstOosRun - tool.flagRun)) < 0.05, `shaded band spans run ${tool.flagRun} to ${tool.firstOosRun}`);

const generated = await page.locator(".generated").innerText();
const bound = Number(generated.match(/within ([0-9.]+) °C/)![1]);
check(bound >= health.maxTempDev, `printed bound ${bound} °C >= raw max ${health.maxTempDev.toExponential(3)} °C`);
const label = await page.getByTestId("generated-label").innerText();
check(label === health.label.text, `label text matches the API: "${label}"`);

await page.getByTestId("lotline-flag").click();
await page.waitForSelector("[data-testid=banner]");
const url = new URL(page.url());
check(url.pathname === `/runs/${tool.displayId}-r${String(tool.flagRun).padStart(4, "0")}`, `one click opens ${url.pathname}`);
const banner = await page.getByTestId("banner").innerText();
check(banner.startsWith("Tool health:"), "run page banner leads with tool health");
await browser.close();
if (!ok) process.exit(1);
console.log("check-ui: all checks passed");
