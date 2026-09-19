/** macOS packaged acceptance: actual Launch Services cold/warm delivery.
 * Run after release native + Vue builds: bun scripts/test-file-associations.ts
 * Creates its own temporary app, opens it in the background, then removes it.
 * No default file handler is changed. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { buildPackage } from "../packages/packager/src/index.js"

if (process.platform !== "darwin") throw new Error("This acceptance test requires macOS Launch Services")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dir = mkdtempSync(path.join(root, "examples/.file-open-test-"))
const log = path.join(dir, "requests.jsonl")
const output = path.join(dir, "process.log")
const bundleId = `dev.gpuiv.open-test-${process.pid}`
let pid: number | undefined
let appPath: string | undefined
const records = (): any[] => existsSync(log)
  ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for packaged open request\n${existsSync(output) ? readFileSync(output, "utf8") : ""}`)
    await Bun.sleep(50)
  }
}

try {
  writeFileSync(path.join(dir, "app.ts"), `
import { appendFileSync } from "node:fs";
import { h } from "vue";
import { createApp, onOpenRequests } from "@gpuiv/vue";
const record = (value) => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, ...value }) + "\\n");
record({ type: "starting" });
const app = createApp({ render: () => h("div", { testId: "app-root" }, [h("text", "File-open acceptance")]) }, { focus: false, width: 400, height: 160 });
record({ type: "mounted" });
// Deliberately leave JS unarmed while AppKit delivers cold-start URLs.
setTimeout(() => {
  record({ type: "subscribing" });
  onOpenRequests(app.renderer, (request) => record({ type: "request", ...request }));
}, 500);
// A failed parent test must not leave a stray process running.
setTimeout(() => process.exit(0), 60000).unref();
`)
  const configPath = path.join(dir, "gpuiv.package.json")
  writeFileSync(configPath, JSON.stringify({
    entry: "./app.ts", productName: `GPUIV Open Test ${process.pid}`, bundleId, version: "0.0.0",
    outDir: "./dist", smokeTestId: null,
    mac: {
      documentTypes: [{ name: "GPUIV test document", contentTypes: [`${bundleId}.document`] }],
      typeDeclarations: [{ identifier: `${bundleId}.document`, conformsTo: ["public.data"], extensions: ["gpuivtest"], exported: true }],
      plist: { CFBundleURLTypes: [{ CFBundleURLName: bundleId, CFBundleURLSchemes: ["gpuiv-open-test"] }] },
    },
  }))
  const [result] = await buildPackage({ configPath, smoke: false })
  appPath = result.productDir
  const first = path.join(dir, "中文 notes #1%.gpuivtest")
  const second = path.join(dir, "second document.gpuivtest")
  writeFileSync(first, "first")
  writeFileSync(second, "second")
  execFileSync("open", ["-g", "-n", "--stdout", output, "--stderr", output, "-a", appPath, first, second])
  await waitFor(() => records().some((record) => record.type === "starting"))
  pid = records()[0].pid
  await waitFor(() => records().filter((record) => record.type === "request").flatMap((record) => record.paths).length === 2)
  assert.deepEqual(records().filter((record) => record.type === "request").flatMap((record) => record.paths), [first, second])
  execFileSync("open", ["-g", "-a", appPath, second, "gpuiv-open-test://settings"])
  await waitFor(() => records().filter((record) => record.type === "request").flatMap((record) => record.urls).length === 1)
  const requests = records().filter((record) => record.type === "request")
  assert.deepEqual(requests.flatMap((record) => record.paths), [first, second, second])
  assert.deepEqual(requests.flatMap((record) => record.urls), ["gpuiv-open-test://settings"])
  assert.deepEqual(requests.flatMap((record) => record.errors), [])
  assert.equal(new Set(records().map((record) => record.pid)).size, 1)
  console.log("PASS: packaged cold/warm opens, delayed registration, Unicode/spaces/#/%, multiple paths, repeated opens and deep links; one process")
} finally {
  pid ??= records()[0]?.pid
  if (pid) { try { process.kill(pid, "SIGTERM") } catch {} }
  if (appPath) {
    try { execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-u", appPath]) } catch {}
  }
  rmSync(dir, { recursive: true, force: true })
}
