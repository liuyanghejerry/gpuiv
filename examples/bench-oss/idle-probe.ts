/**
 * Idle-cost probe: mounts N table rows in a plain scroll `div` or a
 * `<virtual-list>`, lets it settle, then reports how much CPU the process
 * burns while nothing changes, and how long a clear's applyBatch waits.
 *
 *   MODE=plain|virtual COUNT=1000 bun bench-oss/idle-probe.ts
 */
import { defineComponent, h, nextTick, shallowRef } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"

const MODE = process.env.MODE ?? "virtual"
const COUNT = Number(process.env.COUNT ?? 1000)
const native = new GpuixRenderer(() => {})
native.init({ width: 800, height: 600, title: "idle probe", focus: false })
const rawApply = native.applyBatch.bind(native)
let lastApplyMs = 0
native.applyBatch = (json: string) => {
  const t = performance.now()
  const out = rawApply(json)
  lastApplyMs = performance.now() - t
  return out
}

const text = { fontSize: 14, lineHeight: 20, color: "#333333" }
const cell = { width: "25%", padding: 8 }
const rows = shallowRef(Array.from({ length: COUNT }, (_, i) => i))
const Row = defineComponent({
  props: { i: { type: Number, required: true } },
  setup: (props) => () => h("div", { style: { display: "flex", flexShrink: 0, borderTopWidth: 1, borderColor: "#ddd" } }, [
    h("div", { style: cell }, [h("text", { style: text }, String(props.i))]),
    h("div", { style: cell }, [h("text", { style: text }, `label ${props.i}`)]),
  ]),
})
createApp(defineComponent({
  setup: () => () => h(MODE === "virtual" ? "virtual-list" : "div",
    MODE === "virtual"
      ? { estimatedItemHeight: 37, style: { width: "100%", height: "100%" } }
      : { style: { width: "100%", height: "100%", overflowY: "scroll", display: "flex", flexDirection: "column" } },
    rows.value.map((i) => h(Row, { key: i, i }))),
}), { renderer: native })

await Bun.sleep(1500)
const idle = async (label: string) => {
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  await Bun.sleep(2000)
  const cpu = process.cpuUsage(cpu0)
  const wall = performance.now() - t0
  console.log(`${MODE} ${label}: idle CPU ${(((cpu.user + cpu.system) / 1000) / wall * 100).toFixed(1)}% of one core over ${(wall / 1000).toFixed(1)}s`)
}
await idle(`${COUNT} rows mounted`)
const clears: number[] = []
const clearJs: number[] = []
for (let i = 0; i < 5; i++) {
  const t = performance.now()
  rows.value = []
  await nextTick()
  clearJs.push(performance.now() - t - lastApplyMs)
  await Bun.sleep(50)
  clears.push(lastApplyMs)
  rows.value = Array.from({ length: COUNT }, (_, j) => j + (i + 1) * COUNT)
  await Bun.sleep(400)
}
console.log(`${MODE} clear applyBatch ms: ${clears.map((x) => x.toFixed(1)).join(" ")}`)
console.log(`${MODE} clear JS (Vue unmount + mirror) ms: ${clearJs.map((x) => x.toFixed(1)).join(" ")}`)
await idle("after churn")
process.exit(0)
