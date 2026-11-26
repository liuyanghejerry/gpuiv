/**
 * Headless GPU benchmark tracking for CI (macOS M-series runner).
 *
 * Ports the key scenarios from `examples/bench-oss/` (React Native New
 * Architecture time-to-render and krausest/js-framework-benchmark) onto
 * `TestGpuixRenderer` (`createTestApp`), so they run without opening a real
 * window and publish a Markdown table to `$GITHUB_STEP_SUMMARY` plus
 * `tmp/bench-oss-perf-gate/metrics.json`.
 *
 * Budgets gate only on gross regressions (3–4x headroom over expected M1
 * macOS times, scaled by 1.5x on CI) so hosted-runner noise does not flake.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { resolve } from "node:path"
import { defineComponent, h, ref, shallowRef, triggerRef, type PropType } from "vue"
import { afterAll, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "@gpuiv/vue/testing"
import { createDataSource, type RowData } from "./bench-oss/shared"

const gate = process.env.GPUIV_PERF_GATE === "1"
if (gate && (!hasNativeTestRenderer || process.platform !== "darwin" || process.env.THROTTLE)) {
  throw new Error(
    "The OSS benchmark gate requires the macOS native test renderer and THROTTLE unset; it must not skip budgets."
  )
}
const describeNative =
  hasNativeTestRenderer && process.platform === "darwin" ? describe : describe.skip

const scale = process.env.CI ? 1.5 : 1
const now = () => Number(process.hrtime.bigint()) / 1e6

interface Metric {
  label: string
  samplesMs: number[]
  p50Ms: number
  p95Ms: number
  maxMs: number
  budgetMs: number
  enforced: boolean
  passed: boolean
}

const metrics: Metric[] = []

function reportBudget(label: string, samplesMs: number[], budgetMs: number) {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const metric: Metric = {
    label,
    samplesMs,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    maxMs: sorted[sorted.length - 1]!,
    budgetMs,
    enforced: !process.env.THROTTLE,
    passed: false,
  }
  metric.passed = metric.p95Ms < budgetMs
  metrics.push(metric)
  console.log(
    `[bench-oss.perf] ${label} n=${samplesMs.length} p50=${metric.p50Ms.toFixed(2)}ms p95=${metric.p95Ms.toFixed(2)}ms budget=${budgetMs.toFixed(2)}ms`
  )
  if (metric.enforced) {
    expect(
      metric.p95Ms,
      `${label} p95 (${metric.p95Ms.toFixed(2)}ms) exceeds ${budgetMs.toFixed(2)}ms; see metrics.json for every sample`
    ).toBeLessThan(budgetMs)
  }
}

afterAll(() => {
  if (!gate) return
  const output = resolve(import.meta.dirname, "../tmp/bench-oss-perf-gate")
  mkdirSync(output, { recursive: true })
  writeFileSync(
    resolve(output, "metrics.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        runtime: process.version,
        nodeEnv: process.env.NODE_ENV,
        ci: !!process.env.CI,
        commit: process.env.GITHUB_SHA,
        scale,
        metrics,
      },
      null,
      2
    ) + "\n"
  )
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Open-source benchmark tracking (macOS GPU)",
        "",
        "| Scenario | Samples | p50 (ms) | p95 (ms) | Budget (ms) | Result |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
        ...metrics.map(
          (m) =>
            `| ${m.label} | ${m.samplesMs.length} | ${m.p50Ms.toFixed(2)} | ${m.p95Ms.toFixed(2)} | ${m.budgetMs.toFixed(2)} | ${m.passed ? "Pass" : "Fail"} |`
        ),
        "",
      ].join("\n")
    )
  }
})

async function measureStep(app: TestApp, action: () => void): Promise<number> {
  const start = now()
  action()
  await app.settle()
  app.renderer.flush()
  return now() - start
}

// ── Shared styles ─────────────────────────────────────────────────────

const viewStyle = { width: 100, height: 100, backgroundColor: "red", margin: 5, flexShrink: 0 }
const textStyle = { fontSize: 14, color: "#000000", flexShrink: 0 }
const scrollStyle = {
  width: "100%",
  height: "100%",
  overflowY: "scroll",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  backgroundColor: "#ffffff",
}

const cellText = { fontSize: 14, lineHeight: 20, color: "#333333" }
const rowStyle = {
  display: "flex",
  flexDirection: "row",
  flexShrink: 0,
  borderTopWidth: 1,
  borderColor: "#dddddd",
}
const rowSelectedStyle = { ...rowStyle, backgroundColor: "#f2dede" }
const col1 = { width: "8.333%", padding: 8 }
const col4 = { width: "33.333%", padding: 8, cursor: "pointer" }
const col6 = { width: "50%", padding: 8 }

describeNative("bench-oss performance tracking", () => {
  it("tracks React Native New Architecture mount scenarios", async () => {
    const scenario = shallowRef<{ kind: "view" | "text"; count: number } | null>(null)
    const RnApp = defineComponent({
      setup: () => () => {
        const s = scenario.value
        const children = []
        if (s) {
          for (let i = 0; i < s.count; i++) {
            children.push(
              s.kind === "view"
                ? h("div", { key: i, style: viewStyle })
                : h("text", { key: i, style: textStyle }, `Nice text: ${i}`)
            )
          }
        }
        return h("div", { style: scrollStyle }, children)
      },
    })

    const app = createTestApp(RnApp, { width: 800, height: 600 })
    try {
      await app.settle()
      app.renderer.flush()

      const cases: Array<{ label: string; kind: "view" | "text"; count: number; budget: number }> = [
        { label: "RN 1500 <View> (plain)", kind: "view", count: 1500, budget: 80 * scale },
        { label: "RN 5000 <Text> (plain)", kind: "text", count: 5000, budget: 400 * scale },
      ]
      for (const c of cases) {
        const samples: number[] = []
        for (let i = 0; i < 6; i++) {
          scenario.value = null
          await app.settle()
          app.renderer.flush()
          const elapsed = await measureStep(app, () => {
            scenario.value = { kind: c.kind, count: c.count }
          })
          if (i >= 1) samples.push(elapsed)
        }
        reportBudget(c.label, samples, c.budget)
      }
    } finally {
      app.unmount()
    }
  })

  it("tracks js-framework-benchmark operations on <virtual-list> and plain scroll div", async () => {
    const buildData = createDataSource()

    async function runTableSuite(virtual: boolean) {
      const suffix = virtual ? "virtual-list" : "plain"
      const rows = shallowRef<RowData[]>([])
      const selected = ref<number | undefined>()

      const store = {
        run: () => {
          rows.value = buildData(1000)
          selected.value = undefined
        },
        runLots: () => {
          rows.value = buildData(10000)
          selected.value = undefined
        },
        update: () => {
          const r = rows.value
          for (let i = 0; i < r.length; i += 10) r[i] = { ...r[i]!, label: r[i]!.label + " !!!" }
          triggerRef(rows)
        },
        clear: () => {
          rows.value = []
          selected.value = undefined
        },
        swapRows: () => {
          const r = rows.value
          if (r.length > 998) {
            const a = r[1]!
            r[1] = r[998]!
            r[998] = a
            triggerRef(rows)
          }
        },
        select: (id: number) => {
          selected.value = id
        },
      }

      const Row = defineComponent({
        props: { row: { type: Object as PropType<RowData>, required: true }, selected: Boolean },
        setup: (props) => () => {
          const { id, label } = props.row
          return h("div", { style: props.selected ? rowSelectedStyle : rowStyle }, [
            h("div", { style: col1 }, [h("text", { style: cellText }, String(id))]),
            h("div", { style: col4 }, [h("text", { style: cellText }, label)]),
            h("div", { style: col1 }, [h("text", { style: cellText }, "×")]),
            h("div", { style: col6 }),
          ])
        },
      })

      const TableApp = defineComponent({
        setup: () => () =>
          h(
            virtual ? "virtual-list" : "div",
            virtual
              ? { estimatedItemHeight: 37, style: { width: "100%", height: "100%", backgroundColor: "#ffffff" } }
              : {
                  style: {
                    width: "100%",
                    height: "100%",
                    overflowY: "scroll",
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "#ffffff",
                  },
                },
            rows.value.map((row) => h(Row, { key: row.id, row, selected: row.id === selected.value }))
          ),
      })

      const app = createTestApp(TableApp, { width: 800, height: 600 })
      try {
        await app.settle()
        app.renderer.flush()

        const runOp = async (
          label: string,
          setup: () => void,
          act: () => void,
          budgetMs: number,
          runs = 5,
          warmup = 2
        ) => {
          const samples: number[] = []
          for (let i = 0; i < warmup + runs; i++) {
            setup()
            await app.settle()
            app.renderer.flush()
            const elapsed = await measureStep(app, act)
            if (i >= warmup) samples.push(elapsed)
          }
          reportBudget(`${label} (${suffix})`, samples, budgetMs)
        }

        await runOp("create 1k rows", store.clear, store.run, (virtual ? 150 : 350) * scale)
        await runOp(
          "select row",
          store.run,
          () => store.select(rows.value[1]!.id),
          (virtual ? 30 : 250) * scale
        )
        if (virtual) {
          await runOp("partial update", store.run, store.update, 40 * scale)
          await runOp("swap rows", store.run, store.swapRows, 40 * scale)
        }
        await runOp("clear 1k rows", store.run, store.clear, 40 * scale)
        if (virtual) {
          await runOp("create 10k rows", store.clear, store.runLots, 900 * scale, 3, 1)
        }
      } finally {
        app.unmount()
      }
    }

    await runTableSuite(true)
    await runTableSuite(false)
  })
})
