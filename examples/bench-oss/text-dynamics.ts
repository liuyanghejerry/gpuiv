/**
 * Dynamic layout check for retained text layouts: mutates text content,
 * wrap width, and inherited font size across frames, recording the painted
 * bounds of the text after every step. Run under two `.node` builds and diff
 * the output — a retained-measurement bug shows up as stale bounds.
 *
 *   NAPI_RS_NATIVE_LIBRARY_PATH=... bun bench-oss/text-dynamics.ts > out.txt
 */
import { defineComponent, h, ref } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"

const native = new GpuixRenderer(() => {})
native.init({ width: 600, height: 400, title: "text dynamics", focus: false })

const content = ref("short")
const boxWidth = ref(120)
const fontSize = ref(14)
const bold = ref(false)
const ids: Record<string, number | null> = {}
const track = (name: string) => (el: unknown) => { const id = (el as { id?: number | null } | null)?.id; if (id != null) ids[name] = id }

const App = defineComponent({
  setup: () => () => h("div", { style: { display: "flex", flexDirection: "column", gap: 4, padding: 8 } }, [
    h("div", { ref: track("box"), style: { width: boxWidth.value, fontSize: fontSize.value, fontWeight: bold.value ? "bold" : "normal" } }, [
      h("text", { ref: track("wrapped") }, content.value),
    ]),
    h("div", { style: { display: "flex", gap: 8, fontSize: fontSize.value } }, [
      h("text", { ref: track("flexA") }, content.value),
      h("text", { ref: track("flexB"), style: { flexGrow: 1 } }, "fixed sibling"),
    ]),
    h("text", { ref: track("nowrap"), style: { whiteSpace: "nowrap", width: boxWidth.value, overflow: "hidden", textOverflow: "ellipsis" } }, content.value),
  ]),
})
createApp(App, { renderer: native })

const frame = async () => { for (let i = 0; i < 6; i++) await Bun.sleep(20) }
const snap = (step: string) => {
  const parts = Object.entries(ids).sort().map(([k, id]) => {
    const b = id != null ? native.getElementBounds(id) : null
    return `${k}=${b ? `${b.width.toFixed(1)}x${b.height.toFixed(1)}@${b.x.toFixed(1)},${b.y.toFixed(1)}` : "none"}`
  })
  console.log(`${step.padEnd(22)} ${parts.join(" ")}`)
}

await frame(); snap("initial")
const steps: Array<[string, () => void]> = [
  ["long content", () => { content.value = "a much longer piece of text that will need to wrap across lines" }],
  ["narrow box", () => { boxWidth.value = 80 }],
  ["wide box", () => { boxWidth.value = 300 }],
  ["bigger font", () => { fontSize.value = 20 }],
  ["bold", () => { bold.value = true }],
  ["short again", () => { content.value = "tiny" }],
  ["back to long", () => { content.value = "a much longer piece of text that will need to wrap across lines" }],
  ["smaller font", () => { fontSize.value = 12; bold.value = false }],
  ["narrow again", () => { boxWidth.value = 120 }],
]
for (const [name, act] of steps) { act(); await frame(); snap(name) }
console.log("painted:", JSON.stringify(native.getPaintedText()))
process.exit(0)
