import { launch } from "@gpuiv/vue/automation"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { execSync, spawn } from "node:child_process"

const cwd = path.dirname(fileURLToPath(import.meta.url))
const app = await launch({ command: "bun", args: ["beautiful-ui.tsx"], cwd, env: { GPUIX_BACKGROUND: "1", VITEST: "", NODE_ENV: "production" } })
try {
  await app.getByTestId("theme-toggle").waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 4000))
  const pid = Number(execSync(`pgrep -f "bun beautiful-ui.tsx" | tail -1`).toString().trim())
  const sampler = spawn("sample", [String(pid), "6", "-file", "/tmp/sample-wheel.txt"], { stdio: "ignore" })
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 120; i++) {
      await app.mouse.wheel({ x: 480, y: 400 }, 0, 44)
      await new Promise((r) => setTimeout(r, 16))
    }
    for (let i = 0; i < 120; i++) {
      await app.mouse.wheel({ x: 480, y: 400 }, 0, -44)
      await new Promise((r) => setTimeout(r, 16))
    }
  }
  await new Promise((r) => sampler.on("exit", r))
  console.log("done")
} finally { await app.close() }
process.exit(0)
