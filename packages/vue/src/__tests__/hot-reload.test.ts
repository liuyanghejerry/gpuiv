/// Real `bun --hot` regression: a save re-evaluates the entry module, and the
/// native renderer plus its element-id allocator must survive module
/// re-evaluation, so click handlers stay live in the replacement root and its
/// ids never collide with the retained Rust tree.

import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const srcDir = fileURLToPath(new URL("..", import.meta.url))

function hotAppSource(label: string): string {
  return `
import { h } from "vue"
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { createApp } from ${JSON.stringify(join(srcDir, "renderer.ts"))}

const slot = globalThis
slot.__hotEvals = (slot.__hotEvals ?? 0) + 1
if (!slot.__hotRenderer) {
  slot.__hotRenderer = new TestRenderer()
}
const renderer = slot.__hotRenderer
createApp(
  {
    setup: () => () =>
      h(
        "div",
        {
          style: { width: 100, height: 100 },
          onClick: () => console.log("HOT_CLICK", ${JSON.stringify(label)}),
        },
        ${JSON.stringify(label)}
      ),
  },
  { renderer }
)
renderer.nativeSimulateClick(10, 10)
const rootId = renderer.getRoot()?.id
if (slot.__hotRootId !== undefined) {
  console.log("HOT_NEW_ROOT_ID", rootId !== slot.__hotRootId)
}
slot.__hotRootId = rootId
console.log("HOT_LABEL", ${JSON.stringify(label)})
setInterval(() => {}, 1 << 30)
`
}

function collectOutput(child: ReturnType<typeof spawn>) {
  let buf = ""
  child.stdout?.on("data", (chunk) => {
    buf += String(chunk)
  })
  child.stderr?.on("data", (chunk) => {
    buf += String(chunk)
  })
  return {
    wait: async (match: string, timeoutMs: number) => {
      const start = Date.now()
      while (!buf.includes(match)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out waiting for ${JSON.stringify(match)}\n${buf}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return buf
    },
  }
}

describeNative("bun --hot reloads", () => {
  it("keeps events live and root ids unique across a reload", async () => {
    // The entry must live under packages/vue so bun resolves the workspace's
    // node_modules; a tmpdir outside the repo falls back to the global bun
    // cache, which cannot resolve @vue/compiler-core's deps.
    const dir = join(srcDir, "tmp-hot")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const entry = join(dir, "hot-entry.ts")
    writeFileSync(entry, hotAppSource("hello"), "utf8")
    const child = spawn("bun", ["--hot", entry], { cwd: dir })
    const output = collectOutput(child)
    try {
      await output.wait("HOT_CLICK hello", 10_000)

      writeFileSync(entry, hotAppSource("world"), "utf8")
      await output.wait("HOT_CLICK world", 10_000)
      await output.wait("HOT_NEW_ROOT_ID true", 10_000)
    } finally {
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 25_000)
})
