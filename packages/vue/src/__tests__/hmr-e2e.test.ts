/** End-to-end Vue Fast Refresh: a real `bun --hot` child process with the
 *  HMR transform preloaded. Saving the fixture edits one component's label;
 *  that component must remount with its new code (fresh local state, Vue
 *  reload semantics) while its parent's state survives — the classic
 *  full-remount path would reset both.
 *
 *  The fixture's preload imports the transform and the runtime from src via
 *  absolute paths, so this test needs no built dist (CI runs Vue package
 *  tests before the package build). */

import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const srcDir = fileURLToPath(new URL("..", import.meta.url))

function preloadSource(): string {
  return `
import { plugin } from "bun"
import { transformHmrSource } from ${JSON.stringify(join(srcDir, "hmr", "transform.ts"))}

const RUNTIME = ${JSON.stringify(join(srcDir, "hmr", "index.ts"))}

plugin({
  name: "gpuiv-hmr-e2e",
  setup(build) {
    build.onLoad({ filter: /tmp-hmr-e2e.*\\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      const transformed = transformHmrSource(source, args.path, RUNTIME)
      if (transformed === source) return undefined
      return { contents: transformed, loader: "ts" }
    })
  },
})
`
}

function entrySource(label: string): string {
  return `
import { defineComponent, h, ref } from "vue"
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { createApp } from ${JSON.stringify(join(srcDir, "renderer.ts"))}

const slot = globalThis as Record<string, unknown>
slot.__e2eEvals = ((slot.__e2eEvals as number) ?? 0) + 1
const evals = slot.__e2eEvals as number
if (!slot.__e2eRenderer) slot.__e2eRenderer = new TestRenderer()
const renderer = slot.__e2eRenderer as TestRenderer

const Child = defineComponent({
  setup() {
    const count = ref(0)
    return () =>
      h(
        "div",
        {
          testId: "child",
          style: { height: 40, width: 200 },
          onClick: () => {
            count.value += 1
          },
        },
        ${JSON.stringify(`child ${label} `)} + count.value
      )
  },
})

const Parent = defineComponent({
  setup() {
    const count = ref(0)
    return () =>
      h("div", { style: { width: 400, height: 300 } }, [
        h(
          "div",
          {
            testId: "parent",
            style: { height: 40, width: 200 },
            onClick: () => {
              count.value += 1
            },
          },
          "parent " + count.value
        ),
        h(Child),
      ])
  },
})

const App = defineComponent({
  setup: () => () => h(Parent),
})

createApp(App, { renderer })

if (evals === 1) {
  const click = (testId: string) => {
    const el = renderer.findByTestId(testId)!
    const bounds = renderer.getElementBounds(el.id)!
    renderer.nativeSimulateClick(bounds.x + 4, bounds.y + 4)
  }
  click("parent")
  click("child")
}

setTimeout(() => {
  renderer.flush()
  const texts = renderer.getAllText().filter((text) => text.length > 0)
  console.log("HMR_STATE", evals, JSON.stringify(texts))
}, 0)

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

describeNative("vue fast refresh (bun --hot e2e)", () => {
  it("keeps unedited components' state across a save", async () => {
    // The entry must live under packages/vue so bun resolves the workspace's
    // node_modules (see hot-reload.test.ts).
    const dir = join(srcDir, "tmp-hmr-e2e")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const entry = join(dir, "hmr-entry.ts")
    const preload = join(dir, "preload.ts")
    writeFileSync(entry, entrySource("v1"), "utf8")
    writeFileSync(preload, preloadSource(), "utf8")
    // Windows locks a process's working directory, so the child runs from
    // srcDir while the fixture dir is deleted on teardown.
    const child = spawn("bun", ["--preload", preload, "--hot", entry], { cwd: srcDir })
    const output = collectOutput(child)
    try {
      await output.wait('HMR_STATE 1 ["parent 1","child v1 1"]', 15_000)

      writeFileSync(entry, entrySource("v2"), "utf8")
      await output.wait('HMR_STATE 2 ["parent 1","child v2 0"]', 15_000)
    } finally {
      child.kill()
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        child.on("exit", () => {
          clearTimeout(timer)
          resolve(null)
        })
      })
      rmSync(dir, { recursive: true, force: true })
    }
  }, 40_000)
})
