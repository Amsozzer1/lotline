/**
 * pnpm record-gif: records docs/demo.gif from a running `pnpm demo` (run pnpm verify-demo first).
 * Playwright records a video of the tool page, a move to the lotline flag and one click to the run
 * page; ffmpeg turns it into a GIF (palette, 10 fps, 960 px wide). Needs ffmpeg on PATH.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.LOTLINE_URL ?? "http://localhost:8787";
const out = join(import.meta.dirname, "..", "docs", "demo.gif");
const dir = mkdtempSync(join(tmpdir(), "lotline-gif-"));
const size = { width: 1040, height: 840 };

// A visible pointer: headless recordings do not draw the mouse.
const CURSOR = `(() => {
  const c = document.createElement("div");
  c.id = "fake-cursor";
  c.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;z-index:99999;pointer-events:none;transform:translate(-2px,-2px)";
  c.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1 L2 15 L6 11 L9 17 L11 16 L8 10 L14 10 Z" fill="#111" stroke="#fff" stroke-width="1.2"/></svg>';
  document.body.appendChild(c);
  addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
})()`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
const page = await context.newPage();
const t0 = Date.now();
const tool = (await (await fetch(`${base}/api/tools`)).json())[0].id as string;
await page.goto(`${base}/tools/${tool}`);
await page.waitForSelector("[data-testid=lotline-flag]");
await page.evaluate(CURSOR);
await page.mouse.move(980, 120); // start outside the charts, so no tooltip covers them
await page.waitForTimeout(400);
const start = (Date.now() - t0) / 1000;

await page.waitForTimeout(4500); // read the two charts
const flag = await page.getByTestId("lotline-flag").locator("path").boundingBox();
const fx = flag!.x + flag!.width / 2;
const fy = flag!.y + flag!.height / 2;
await page.mouse.move(fx, fy, { steps: 25 });
await page.waitForTimeout(700);
await page.mouse.click(fx, fy);
await page.waitForSelector("[data-testid=banner]");
await page.mouse.move(520, 120, { steps: 10 });
await page.waitForTimeout(4800); // read the banner and the traces
const end = (Date.now() - t0) / 1000;
const video = page.video()!;
await context.close();
await browser.close();
const webm = await video.path();

const dur = end - start;
const vf = "fps=10,scale=960:-1:flags=lanczos";
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", start.toFixed(2), "-t", dur.toFixed(2), "-i", webm, "-vf", `${vf},palettegen=stats_mode=diff`, join(dir, "palette.png")]);
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", "-ss", start.toFixed(2), "-t", dur.toFixed(2), "-i", webm, "-i", join(dir, "palette.png"),
  "-lavfi", `${vf} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, out,
]);
const mb = statSync(out).size / 1e6;
console.log(`wrote ${out}: ${dur.toFixed(1)} s, ${mb.toFixed(2)} MB (${readdirSync(dir).length} temp files in ${dir})`);
if (mb >= 5) {
  console.error("GIF is 5 MB or more");
  process.exit(1);
}
