/**
 * Memory probe: RSS split into JS heap and everything else, for N table rows
 * in a plain scroll `div` or a `<virtual-list>`, after mount and after a few
 * repaints. Used to find where a large plain tree's memory goes.
 *
 *   MODE=plain|virtual COUNT=10000 bun bench-oss/memory-probe.ts
 */
import { defineComponent, h, ref } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"

const MODE = process.env.MODE ?? "plain"
const COUNT = Number(process.env.COUNT ?? 10000)
const native = new GpuixRenderer(() => {})
native.init({ width: 800, height: 600, title: "memory probe", focus: false })

const mb = (n: number) => (n / 1048576).toFixed(0)
// glibc's per-arena "system bytes" vs "in use bytes" (stderr), when
// MALLOC_STATS=1: separates live allocations from allocator retention.
const mallocStats = process.env.MALLOC_STATS === "1"
  ? (await import("bun:ffi")).dlopen("libc.so.6", { malloc_stats: { args: [], returns: "void" } }).symbols.malloc_stats
  : null
const report = (label: string) => {
  Bun.gc(true)
  const m = process.memoryUsage()
  if (mallocStats) { console.error(`--- malloc_stats ${label}`); mallocStats() }
  console.log(`${MODE} ${label}: rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB external=${mb(m.external)}MB native≈${mb(m.rss - m.heapTotal)}MB`)
}

await Bun.sleep(500)
report("empty window")

const tick = ref(1)
const text = { fontSize: 14, lineHeight: 20, color: "#333333" }
const cell = { width: "25%", padding: 8 }
const Row = defineComponent({
  props: { i: { type: Number, required: true } },
  setup: (props) => () => h("div", { style: { display: "flex", flexShrink: 0, borderTopWidth: 1, borderColor: "#ddd" } }, [
    h("div", { style: cell }, [h("text", { style: text }, String(props.i))]),
    h("div", { style: cell }, [h("text", { style: text }, `label ${props.i}`)]),
    h("div", { style: cell }, [h("text", { style: text }, "×")]),
    h("div", { style: cell }),
  ]),
})
const items = Array.from({ length: COUNT }, (_, i) => i)
createApp(defineComponent({
  setup: () => () => h("div", { style: { width: "100%", height: "100%" } }, [
    h(MODE === "virtual" ? "virtual-list" : "div",
      MODE === "virtual"
        ? { estimatedItemHeight: 37, style: { width: "100%", height: "100%" } }
        : { style: { width: "100%", height: "100%", overflowY: "scroll", display: "flex", flexDirection: "column" } },
      items.map((i) => h(Row, { key: i, i }))),
    h("div", { style: { position: "absolute", width: tick.value, height: 1 } }),
  ]),
}), { renderer: native })

await Bun.sleep(3000)
report(`${COUNT} rows, first frames`)
const REPAINTS = Number(process.env.REPAINTS ?? 10)
for (let i = 1; i <= REPAINTS; i++) {
  tick.value = i + 1
  await Bun.sleep(300)
  if (i % 10 === 0 || i === REPAINTS) report(`${COUNT} rows, after ${i} repaints`)
}
process.exit(0)
