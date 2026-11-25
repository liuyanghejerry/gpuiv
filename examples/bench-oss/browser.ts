/**
 * Chromium DOM baseline for bench-oss: serves browser.html (same Vue render
 * functions as gpuiv.ts, DOM host) and launches Chromium against it.
 *
 *   CHROME=/path/to/chrome bun bench-oss/browser.ts
 *
 * Like gpuiv.ts this opens a real window — point WAYLAND_DISPLAY/DISPLAY at a
 * display nobody is using (CI or a headless compositor).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { createDataSource, JSFB_OPS, RN_SCENARIOS, stats, writeTestPng } from "./shared"

const here = import.meta.dirname
const OUT_DIR = resolve(here, "../../tmp/bench-oss")
mkdirSync(OUT_DIR, { recursive: true })
const PNG = resolve(OUT_DIR, "kitten.png")
await writeTestPng(PNG)

// shared.ts as a browser module (only the pure helpers).
const sharedJs = [
  `export const RN_SCENARIOS = ${JSON.stringify(RN_SCENARIOS)};`,
  `export const JSFB_OPS = ${JSON.stringify(JSFB_OPS)};`,
  `export ${createDataSource.toString()}`,
  `export ${stats.toString()}`,
].join("\n")
  .replace(/const adjectives[^\n]*/g, "")
const sharedSrc = await Bun.file(resolve(here, "shared.ts")).text()
const arrays = sharedSrc.split("\n").filter((l) => /^const (adjectives|colours|nouns) =/.test(l)).join("\n")

let resolveResults: (v: unknown) => void
const results = new Promise((r) => (resolveResults = r))
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/") return new Response(Bun.file(resolve(here, "browser.html")))
    if (url.pathname === "/vue.global.prod.js") return new Response(Bun.file(resolve(here, "../node_modules/vue/dist/vue.global.prod.js")))
    if (url.pathname === "/shared.js") return new Response(arrays + "\n" + sharedJs, { headers: { "content-type": "text/javascript" } })
    if (url.pathname === "/kitten.png") return new Response(Bun.file(PNG))
    if (url.pathname === "/results") { resolveResults(await req.json()); return new Response("ok") }
    return new Response("not found", { status: 404 })
  },
})

// Default: the distro (snap) Chromium, which keeps its sandbox. Set HEADLESS=1
// when no free display is reachable from the browser.
const chrome = process.env.CHROME ?? "/snap/bin/chromium"
const headless = process.env.HEADLESS === "1"
const query = new URLSearchParams({
  rnRuns: process.env.RN_RUNS ?? "5", jsfbRuns: process.env.JSFB_RUNS ?? "10",
  jsfbWarmup: process.env.JSFB_WARMUP ?? "3", suite: process.env.SUITE ?? "all",
})
const profile = process.env.CHROME_PROFILE ?? resolve(homedir(), "snap/chromium/common/gpuiv-bench-oss")
const proc = Bun.spawn([
  chrome, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=800,600", "--js-flags=--expose-gc", "--enable-precise-memory-info",
  ...(headless ? ["--headless=new", "--enable-gpu"] : process.env.WAYLAND_DISPLAY ? ["--ozone-platform=wayland"] : []),
  ...(process.env.CHROME_ARGS?.split(" ").filter(Boolean) ?? []),
  headless ? `http://localhost:${server.port}/?${query}` : `--app=http://localhost:${server.port}/?${query}`,
], { stdout: "ignore", stderr: "ignore" })

const data = (await Promise.race([results, Bun.sleep(600_000).then(() => { throw new Error("timeout") })])) as Record<string, any>
proc.kill()
server.stop()
writeFileSync(resolve(OUT_DIR, "chromium.json"), JSON.stringify(data, null, 2))
console.log(JSON.stringify(data.meta))
for (const [k, v] of Object.entries<any>(data.rn ?? {})) console.log(`${k.padEnd(14)} mean=${v.total.mean.toFixed(1)}ms median=${v.total.median.toFixed(1)} [js=${v.js.toFixed(1)} frame=${v.frame.toFixed(1)}]`)
for (const [k, v] of Object.entries<any>(data.jsfb ?? {})) console.log(`${k.padEnd(34)} median=${v.total.median.toFixed(1)}ms mean=${v.total.mean.toFixed(1)} [js=${v.js.toFixed(1)} frame=${v.frame.toFixed(1)}]`)
console.log(`wrote ${resolve(OUT_DIR, "chromium.json")}`)
process.exit(0)
