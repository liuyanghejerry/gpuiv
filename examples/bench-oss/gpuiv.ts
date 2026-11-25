/**
 * GPUIV port of two open-source UI benchmarks (see shared.ts).
 *
 *   bun bench-oss/gpuiv.ts                # both suites
 *   SUITE=rn bun bench-oss/gpuiv.ts       # React Native New Architecture scenarios
 *   SUITE=jsfb bun bench-oss/gpuiv.ts     # js-framework-benchmark operations
 *
 * Opens a real GPUI window (real Vue → applyBatch → RetainedTree → Taffy →
 * GPU paint). Run it on a machine/display you are not using: CI, or a headless
 * compositor (see docs in the report). Never on a shared desktop.
 *
 * Timing mirrors RN's RTNTimeToRender: t0 is taken right before the state
 * change; the run ends when a marker element committed in the same Vue flush
 * shows up in the *published* (painted) frame bounds. `getElementBounds`
 * reads the last completed frame without forcing a render, so the poll does
 * not perturb the pipeline.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { resolve } from "node:path"
import { defineComponent, h, nextTick, ref, shallowRef, triggerRef, type PropType } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import { createApp } from "@gpuiv/vue"
import { createDataSource, JSFB_OPS, RN_PUBLISHED, RN_SCENARIOS, stats, writeTestPng, type RowData } from "./shared"

const SUITE = process.env.SUITE ?? "all"
/** VIRTUAL=1 swaps the plain scroll container for <virtual-list>: GPUIV's
 *  idiomatic long-list host (the RN equivalent would be FlatList/FlashList). */
const VIRTUAL = process.env.VIRTUAL === "1"
const RN_RUNS = Number(process.env.RN_RUNS ?? 5)
const JSFB_RUNS = Number(process.env.JSFB_RUNS ?? 10)
const JSFB_WARMUP = Number(process.env.JSFB_WARMUP ?? 3)
const OUT_DIR = resolve(import.meta.dirname, "../../tmp/bench-oss")
mkdirSync(OUT_DIR, { recursive: true })
const PNG = resolve(OUT_DIR, "kitten.png")
await writeTestPng(PNG)

// ── Native renderer with applyBatch timing ────────────────────────────────
const native = new GpuixRenderer(() => {})
native.init({ width: 800, height: 600, title: "gpuiv bench-oss", focus: false })
let lastBatch = { start: 0, end: 0, bytes: 0 }
const rawApply = native.applyBatch.bind(native)
native.applyBatch = (json: string) => {
  const start = performance.now()
  const out = rawApply(json)
  lastBatch = { start, end: performance.now(), bytes: json.length }
  return out
}

// ── Paint marker (RTNTimeToRender equivalent) ─────────────────────────────
const markerWidth = ref(1)
let markerId: number | null = null
const Marker = defineComponent({
  setup() {
    const el = ref<{ id: number | null } | null>(null)
    return () => {
      queueMicrotask(() => { markerId = el.value?.id ?? markerId })
      return h("div", {
        ref: el,
        style: { position: "absolute", left: 0, top: 0, width: markerWidth.value, height: 1, backgroundColor: "#00000001" },
      })
    }
  },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const immediate = () => new Promise<void>((r) => setImmediate(r))
let seq = 0

interface Sample { total: number; js: number; batch: number; frame: number; batchBytes: number }

/** Run `action`, then wait for the frame that contains it. */
async function measure(action: () => void): Promise<Sample> {
  seq++
  const expected = (seq % 300) + 1
  const batchBefore = lastBatch.start
  const t0 = performance.now()
  markerWidth.value = expected
  action()
  for (;;) {
    await immediate()
    if (markerId != null && lastBatch.start !== batchBefore) {
      const b = native.getElementBounds(markerId)
      if (b && Math.round(b.width) === expected) break
    }
    if (performance.now() - t0 > 30_000) throw new Error("timed out waiting for paint")
  }
  const t1 = performance.now()
  return {
    total: t1 - t0,
    js: lastBatch.start - t0,
    batch: lastBatch.end - lastBatch.start,
    frame: t1 - lastBatch.end,
    batchBytes: lastBatch.bytes,
  }
}

async function settleIdle() {
  await sleep(60)
  Bun.gc(true)
  await sleep(40)
}

function summarize(samples: Sample[]) {
  return {
    total: stats(samples.map((s) => s.total)),
    js: stats(samples.map((s) => s.js)).median,
    batch: stats(samples.map((s) => s.batch)).median,
    frame: stats(samples.map((s) => s.frame)).median,
    batchKB: stats(samples.map((s) => s.batchBytes)).median / 1024,
  }
}

// ── React Native New Architecture scenarios ───────────────────────────────
type RnKind = "view" | "text" | "image"
const rnScenario = shallowRef<{ kind: RnKind; count: number } | null>(null)
const viewStyle = { width: 100, height: 100, backgroundColor: "red", margin: 5, flexShrink: 0 }
const textStyle = { fontSize: 14, color: "#000000", flexShrink: 0 }
const imageStyle = { width: 100, height: 100, margin: 5, flexShrink: 0 }
const separatorStyle = { margin: 10, height: 5, width: "100%", backgroundColor: "black", flexShrink: 0 }
const scrollStyle = {
  width: "100%", height: "100%", overflowY: "scroll", display: "flex",
  flexDirection: "column", alignItems: "center", backgroundColor: "#ffffff",
}

const RnApp = defineComponent({
  setup() {
    return () => {
      const s = rnScenario.value
      const children = []
      if (s) {
        children.push(h("div", { style: separatorStyle }))
        for (let i = 0; i < s.count; i++) {
          if (s.kind === "view") children.push(h("div", { key: i, style: viewStyle }))
          else if (s.kind === "text") children.push(h("text", { key: i, style: textStyle }, `Nice text: ${i}`))
          else children.push(h("img", { key: i, src: PNG, style: imageStyle }))
        }
      }
      return h("div", { style: { width: "100%", height: "100%" } }, [
        VIRTUAL
          ? h("virtual-list", { estimatedItemHeight: s?.kind === "text" ? 17 : 110, style: { width: "100%", height: "100%", backgroundColor: "#ffffff" } }, children)
          : h("div", { style: scrollStyle }, children),
        h(Marker),
      ])
    }
  },
})

// ── js-framework-benchmark (keyed) ────────────────────────────────────────
const rows = shallowRef<RowData[]>([])
const selected = ref<number | undefined>()
const buildData = createDataSource()
const store = {
  run: () => { rows.value = buildData(1000); selected.value = undefined },
  runLots: () => { rows.value = buildData(10000); selected.value = undefined },
  add: () => { rows.value = rows.value.concat(buildData(1000)) },
  update: () => {
    const r = rows.value
    for (let i = 0; i < r.length; i += 10) r[i] = { ...r[i]!, label: r[i]!.label + " !!!" }
    triggerRef(rows)
  },
  clear: () => { rows.value = []; selected.value = undefined },
  swapRows: () => {
    const r = rows.value
    if (r.length > 998) { const a = r[1]!; r[1] = r[998]!; r[998] = a; triggerRef(rows) }
  },
  remove: (id: number) => {
    const r = rows.value
    r.splice(r.findIndex((d) => d.id === id), 1)
    triggerRef(rows)
  },
  select: (id: number) => { selected.value = id },
}

const cellText = { fontSize: 14, lineHeight: 20, color: "#333333" }
const rowStyle = { display: "flex", flexDirection: "row", flexShrink: 0, borderTopWidth: 1, borderColor: "#dddddd" }
const rowSelectedStyle = { ...rowStyle, backgroundColor: "#f2dede" }
const col1 = { width: "8.333%", padding: 8 }
const col4 = { width: "33.333%", padding: 8, cursor: "pointer" }
const col6 = { width: "50%", padding: 8 }

const Row = defineComponent({
  props: { row: { type: Object as PropType<RowData>, required: true }, selected: Boolean },
  setup(props) {
    return () => {
      const { id, label } = props.row
      return h("div", { style: props.selected ? rowSelectedStyle : rowStyle }, [
        h("div", { style: col1 }, [h("text", { style: cellText }, String(id))]),
        h("div", { style: col4, onClick: () => store.select(id) }, [h("text", { style: cellText }, label)]),
        h("div", { style: col1, onClick: () => store.remove(id) }, [h("text", { style: cellText }, "×")]),
        h("div", { style: col6 }),
      ])
    }
  },
})

const JsfbApp = defineComponent({
  setup() {
    return () => h("div", { style: { width: "100%", height: "100%", backgroundColor: "#ffffff" } }, [
      h(VIRTUAL ? "virtual-list" : "div", VIRTUAL
        ? { estimatedItemHeight: 37, style: { width: "100%", height: "100%" } }
        : { style: { width: "100%", height: "100%", overflowY: "scroll", display: "flex", flexDirection: "column" } },
        rows.value.map((row) => h(Row, { key: row.id, row, selected: row.id === selected.value }))),
      h(Marker),
    ])
  },
})

// ── Runner ─────────────────────────────────────────────────────────────────
const meta = {
  host: VIRTUAL ? "gpuiv-virtual-list" : "gpuiv",
  platform: `${process.platform}-${process.arch}`,
  cpu: cpus()[0]?.model,
  runtime: `bun ${Bun.version}`,
  display: process.env.WAYLAND_DISPLAY ?? process.env.DISPLAY,
}
const results: Record<string, unknown> = { meta }

const Root = defineComponent({
  props: { which: String },
  setup(props) { return () => h(props.which === "rn" ? RnApp : JsfbApp) },
})
const which = ref<"rn" | "jsfb">("rn")
const handle = createApp(defineComponent({ setup: () => () => h(Root, { which: which.value }) }), { renderer: native })
await nextTick()
await measure(() => {})

if (SUITE === "all" || SUITE === "rn") {
  which.value = "rn"
  await measure(() => {})
  const rn: Record<string, unknown> = {}
  console.log(`\n== React Native New Architecture scenarios (mean of ${RN_RUNS}, +1 discarded warm-up) ==`)
  for (const sc of RN_SCENARIOS) {
    const samples: Sample[] = []
    for (let i = 0; i <= RN_RUNS; i++) {
      await measure(() => { rnScenario.value = null })
      await settleIdle()
      const s = await measure(() => { rnScenario.value = { kind: sc.kind, count: sc.count } })
      if (i > 0) samples.push(s)
    }
    const sum = summarize(samples)
    const pub = RN_PUBLISHED[sc.name]!
    rn[sc.name] = { ...sum, samples }
    console.log(
      `${sc.name.padEnd(14)} gpuiv mean=${sum.total.mean.toFixed(1)}ms median=${sum.total.median.toFixed(1)} ` +
      `[js=${sum.js.toFixed(1)} batch=${sum.batch.toFixed(1)} frame=${sum.frame.toFixed(1)} payload=${sum.batchKB.toFixed(0)}KB]  ` +
      `RN-new: Pixel4=${pub.pixel4New} iPhone12Pro=${pub.iphone12New}`,
    )
  }
  await measure(() => { rnScenario.value = null })
  results.rn = rn
}

if (SUITE === "all" || SUITE === "jsfb") {
  which.value = "jsfb"
  await measure(() => {})
  const jsfb: Record<string, unknown> = {}
  console.log(`\n== js-framework-benchmark (keyed), median of ${JSFB_RUNS} after ${JSFB_WARMUP} warm-ups ==`)
  const plans: Record<(typeof JSFB_OPS)[number], { setup: () => Promise<void>; act: () => void }> = {
    "create 1k rows": { setup: async () => { await measure(store.clear) }, act: store.run },
    "replace all 1k rows": { setup: async () => { await measure(store.run) }, act: store.run },
    "partial update (every 10th of 1k)": { setup: async () => { await measure(store.run) }, act: store.update },
    "select row": { setup: async () => { await measure(store.run) }, act: () => store.select(rows.value[1]!.id) },
    "swap rows": { setup: async () => { await measure(store.run) }, act: store.swapRows },
    "remove row": { setup: async () => { await measure(store.run) }, act: () => store.remove(rows.value[4]!.id) },
    "create 10k rows": { setup: async () => { await measure(store.clear) }, act: store.runLots },
    "append 1k to 10k rows": { setup: async () => { await measure(store.runLots) }, act: store.add },
    "clear 1k rows": { setup: async () => { await measure(store.run) }, act: store.clear },
  }
  for (const op of JSFB_OPS) {
    const samples: Sample[] = []
    for (let i = 0; i < JSFB_WARMUP + JSFB_RUNS; i++) {
      await plans[op].setup()
      await settleIdle()
      const s = await measure(plans[op].act)
      if (i >= JSFB_WARMUP) samples.push(s)
    }
    const sum = summarize(samples)
    jsfb[op] = { ...sum, samples }
    console.log(
      `${op.padEnd(34)} median=${sum.total.median.toFixed(1)}ms mean=${sum.total.mean.toFixed(1)} ` +
      `[js=${sum.js.toFixed(1)} batch=${sum.batch.toFixed(1)} frame=${sum.frame.toFixed(1)} payload=${sum.batchKB.toFixed(0)}KB]`,
    )
  }
  await measure(store.runLots)
  results.memory10kRowsMB = process.memoryUsage().rss / 1024 / 1024
  console.log(`RSS with 10k rows: ${(results.memory10kRowsMB as number).toFixed(0)} MB`)
  results.jsfb = jsfb
}

const out = resolve(OUT_DIR, VIRTUAL ? "gpuiv-virtual.json" : "gpuiv.json")
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(`\nwrote ${out}`)
handle.unmount()
process.exit(0)
