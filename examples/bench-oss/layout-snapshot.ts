/**
 * Layout snapshot for refactors of native elements: mounts a real example
 * app, waits for paint to settle, and writes the automation tree (every
 * element's painted bounds) plus the painted-text log.
 *
 *   APP=chat|beautiful|animal|markdown|diff|bench TAG=before bun bench-oss/layout-snapshot.ts
 *
 * Diff `tmp/layout-snap/<app>-before.json` against `-after.json`.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineComponent, h, type Component } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"

const APP = process.env.APP ?? "chat"
const TAG = process.env.TAG ?? "snap"
const sizes: Record<string, [number, number]> = {
  chat: [1180, 820], beautiful: [960, 760], animal: [1120, 820], markdown: [940, 760], diff: [900, 600], bench: [800, 600],
}

async function load(): Promise<Component> {
  switch (APP) {
    case "chat": { const m = await import("../chat"); return defineComponent({ setup: () => () => h(m.ChatApp, { turnCount: 40 }) }) }
    case "beautiful": return (await import("../beautiful-ui")).App
    case "animal": return (await import("../animal-island")).App
    case "markdown": return (await import("../markdown-editor")).App
    case "diff": return (await import("../diff")).App
    default: {
      const text = { fontSize: 14, lineHeight: 20, color: "#333" }
      return defineComponent({ setup: () => () => h("div", { style: { display: "flex", flexDirection: "column", gap: 4, padding: 8, width: "100%", height: "100%", overflowY: "scroll" } }, [
        h("text", { style: { fontSize: 20, fontWeight: "bold" } }, "Heading text"),
        h("text", null, ["mixed ", "children ", String(42)]),
        h("div", { style: { display: "flex", gap: 8 } }, [h("text", { style: text }, "flex a"), h("text", { style: { ...text, flexGrow: 1 } }, "flex b grows"), h("text", { style: text }, "×")]),
        h("div", { style: { width: 120 } }, [h("text", { style: text }, "A long sentence that must wrap inside a 120px wide box to test wrapping.")]),
        h("div", { style: { userSelect: "none" } }, [h("text", { style: text }, "chrome label")]),
        h("text", { style: { ...text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: 90 } }, "truncated label that is long"),
        ...Array.from({ length: 20 }, (_, i) => h("div", { key: i, style: { display: "flex", borderTopWidth: 1, borderColor: "#ddd" } }, [
          h("div", { style: { width: "10%", padding: 8 } }, [h("text", { style: text }, String(i))]),
          h("div", { style: { width: "40%", padding: 8 } }, [h("text", { style: text }, `row label ${i}`)]),
        ])),
      ]) })
    }
  }
}

const [width, height] = sizes[APP] ?? [900, 700]
const native = new GpuixRenderer(() => {})
native.init({ width, height, title: `snap ${APP}`, focus: false })
createApp(await load(), { renderer: native })

// Wait until two consecutive automation trees agree (animations, images, fonts).
let last = ""
let stable = 0
const start = performance.now()
while (stable < 4 && performance.now() - start < 15_000) {
  await Bun.sleep(250)
  const tree = native.getAutomationTree()
  stable = tree === last ? stable + 1 : 0
  last = tree
}
const out = resolve(import.meta.dirname, "../../tmp/layout-snap")
mkdirSync(out, { recursive: true })
const file = resolve(out, `${APP}-${TAG}.json`)
writeFileSync(file, JSON.stringify({ stable: stable >= 4, tree: JSON.parse(last), painted: native.getPaintedText() }, null, 1))
console.log(`${APP}: stable=${stable >= 4} wrote ${file}`)
process.exit(0)
