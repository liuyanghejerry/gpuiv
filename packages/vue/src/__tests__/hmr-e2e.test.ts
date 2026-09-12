/** End-to-end Vue Fast Refresh: a real `bun --hot` child process with the
 *  HMR transform preloaded. Saving the fixture edits one component's label;
 *  that component must remount with its new code (fresh local state, Vue
 *  reload semantics) while its parent's state survives — the classic
 *  full-remount path would reset both.
 *
 *  The fixture's preload imports the preload/transform/runtime from src via
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
import { createHmrPreload } from ${JSON.stringify(join(srcDir, "hmr", "preload.ts"))}

const RUNTIME = ${JSON.stringify(join(srcDir, "hmr", "index.ts"))}
const hmr = createHmrPreload({ importSpecifier: RUNTIME })

plugin({
  name: "gpuiv-hmr-e2e",
  setup(build) {
    build.onLoad({ filter: hmr.filter }, (args) => hmr.load(args.path))
  },
})
`
}

/** `theme` is a component-less sibling module: the entry imports it, and the
 *  preload filter matches it, so it exercises the onLoad return contract that
 *  used to abort the child at startup. `asset` is a JSON sibling — a save
 *  that changes no component, i.e. the classic-remount trigger (bun --hot
 *  does not re-evaluate a change in a module the preload loaded). */
function entrySource(
  label: string,
  options: { theme?: boolean; asset?: boolean; clickThrough?: number } = {}
): string {
  const imports = [
    options.theme ? 'import { THEME } from "./theme"' : "",
    options.asset ? 'import data from "./asset.json"' : "",
  ]
    .filter(Boolean)
    .join("\n")
  const childLabel = [
    JSON.stringify(`child ${label}`),
    options.theme ? "THEME" : "",
    options.asset ? "data.label" : "",
  ]
    .filter(Boolean)
    .join(" + ' ' + ")
  return `
import { defineComponent, h, ref } from "vue"
${imports}${imports ? "\n" : ""}import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
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
        ${childLabel} + " " + count.value
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

if (evals <= ${options.clickThrough ?? 1}) {
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

  it("starts with a component-less sibling and keeps reloading after a remount", async () => {
    const dir = join(srcDir, "tmp-hmr-e2e-remount")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const entry = join(dir, "hmr-entry.ts")
    const theme = join(dir, "theme.ts")
    const asset = join(dir, "asset.json")
    const preload = join(dir, "preload.ts")
    const assetSource = (version: string) => `{ "label": ${JSON.stringify(version)} }\n`
    writeFileSync(entry, entrySource("v1", { theme: true, asset: true, clickThrough: 2 }), "utf8")
    writeFileSync(theme, 'export const THEME = "theme1"\n', "utf8")
    writeFileSync(asset, assetSource("data1"), "utf8")
    writeFileSync(preload, preloadSource(), "utf8")
    const child = spawn("bun", ["--preload", preload, "--hot", entry], { cwd: srcDir })
    const output = collectOutput(child)
    try {
      // A component-less .ts import must not abort the child: the preload
      // matches it, so its onLoad has to resolve (Bun throws on undefined).
      await output.wait('HMR_STATE 1 ["parent 1","child v1 theme1 data1 1"]', 15_000)

      // An asset save changes no component hash, so the entry re-evaluates
      // into a new vue copy and createApp remounts the tree.
      writeFileSync(asset, assetSource("data2"), "utf8")
      await output.wait('HMR_STATE 2 ["parent 1","child v1 theme1 data2 1"]', 15_000)

      // A component save after that remount must still reload in place: the
      // child remounts with fresh state, the parent keeps its own.
      writeFileSync(entry, entrySource("v2", { theme: true, asset: true, clickThrough: 2 }), "utf8")
      await output.wait('HMR_STATE 3 ["parent 1","child v2 theme1 data2 0"]', 15_000)
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
  }, 60_000)
})
