/**
 * Frame-cost probe for bench-oss: mounts N js-framework-benchmark rows (or RN
 * texts) and repeatedly toggles a cheap state change, so a sampling profiler
 * (`perf record -g -p <pid>`) sees nearly only per-frame render cost.
 *
 *   KIND=rows|texts|views COUNT=1000 LOOPS=40 bun bench-oss/frame-probe.ts
 */
import { defineComponent, h, ref } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"

const KIND = process.env.KIND ?? "rows"
const COUNT = Number(process.env.COUNT ?? 1000)
const LOOPS = Number(process.env.LOOPS ?? 40)
const native = new GpuixRenderer(() => {})
native.init({ width: 800, height: 600, title: "frame probe", focus: false })

const tick = ref(1)
let markerId: number | null = null
const Marker = defineComponent({
  setup() {
    const el = ref<{ id: number | null } | null>(null)
    return () => {
      queueMicrotask(() => { markerId = el.value?.id ?? markerId })
      return h("div", { ref: el, style: { position: "absolute", left: 0, top: 0, width: tick.value, height: 1 } })
    }
  },
})
const text = { fontSize: 14, lineHeight: 20, color: "#333333" }
const cell = { width: "25%", padding: 8 }
const items = Array.from({ length: COUNT }, (_, i) => i)
const List = defineComponent({
  setup: () => () => h("div", { style: { width: "100%", height: "100%", overflowY: "scroll", display: "flex", flexDirection: "column" } },
    items.map((i) => KIND === "texts"
      ? h("text", { key: i, style: { ...text, flexShrink: 0 } }, `Nice text: ${i}`)
      : KIND === "views"
        ? h("div", { key: i, style: { width: 100, height: 100, margin: 5, flexShrink: 0, backgroundColor: "red" } })
        : h("div", { key: i, style: { display: "flex", flexShrink: 0, borderTopWidth: 1, borderColor: "#ddd" } }, [
          h("div", { style: cell }, [h("text", { style: text }, String(i))]),
          h("div", { style: cell }, [h("text", { style: text }, `label ${i}`)]),
          h("div", { style: cell }, [h("text", { style: text }, "×")]),
          h("div", { style: cell }),
        ]))),
})
createApp(defineComponent({ setup: () => () => h("div", { style: { width: "100%", height: "100%" } }, [h(List), h(Marker)]) }), { renderer: native })

const waitFor = async (w: number) => {
  for (;;) {
    await new Promise((r) => setImmediate(r))
    const b = markerId != null ? native.getElementBounds(markerId) : null
    if (b && Math.round(b.width) === w) return
  }
}
await waitFor(1)
console.log(`PID ${process.pid} mounted ${COUNT} ${KIND}; sleeping 3s for profiler attach`)
await Bun.sleep(3000)
const samples: number[] = []
for (let i = 0; i < LOOPS; i++) {
  const w = (i % 100) + 2
  const t0 = performance.now()
  tick.value = w
  await waitFor(w)
  samples.push(performance.now() - t0)
}
samples.sort((a, b) => a - b)
console.log(`frame after trivial change: median=${samples[samples.length >> 1]!.toFixed(1)}ms min=${samples[0]!.toFixed(1)} max=${samples.at(-1)!.toFixed(1)}`)
process.exit(0)
