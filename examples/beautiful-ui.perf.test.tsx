import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { resolve } from "node:path"
import { defineComponent, h, ref } from "vue"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { createTheme, FineTuneCard, LoadingState, provideTheme, RecordsTable, Shimmer, INITIAL_ROWS, type FineTuneState } from "@gpuiv/beautiful-ui"
import { App } from "./beautiful-ui"

const gate = process.env.GPUIV_PERF_GATE === "1"
if (gate && (!hasNativeTestRenderer || process.platform !== "darwin" || process.env.THROTTLE)) {
  throw new Error("The performance gate requires the macOS native test renderer and THROTTLE unset; it must not skip budgets.")
}
const describeNative = hasNativeTestRenderer && process.platform === "darwin" ? describe : describe.skip
// Fixed budgets allow hosted-runner headroom without ratcheting the threshold
// up with each commit. Cadence, batching and scroll ownership are also checked
// deterministically below; wall-clock FPS is not a reliable hosted-CI gate.
const scale = process.env.CI ? 1.5 : 1
const budget = { frame: 16.7 * scale, interaction: 16.7 * scale, drag: 100 * scale }
const metrics: Array<{
  label: string, samplesMs: number[], p50Ms: number, p95Ms: number, maxMs: number,
  budgetMs: number, enforced: boolean, passed: boolean,
}> = []
const now = () => Number(process.hrtime.bigint()) / 1e6
function reportBudget(label: string, samplesMs: number[], budgetMs: number) {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const metric = {
    label, samplesMs, p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1]!,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, maxMs: sorted.at(-1)!,
    budgetMs, enforced: !process.env.THROTTLE, passed: false,
  }
  metric.passed = metric.p95Ms < budgetMs
  metrics.push(metric)
  console.log(`[beautiful-ui.perf] ${label} n=${samplesMs.length} p95=${metric.p95Ms.toFixed(2)}ms budget=${budgetMs.toFixed(2)}ms`)
  if (metric.enforced) {
    expect(metric.p95Ms, `${label} p95 exceeds ${budgetMs.toFixed(2)}ms; see metrics.json for every sample`).toBeLessThan(budgetMs)
  }
}
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] })
afterEach(() => vi.useRealTimers())
afterAll(() => {
  if (!gate) return
  const output = resolve(import.meta.dirname, "../tmp/beautiful-ui-perf-gate")
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, "metrics.json"), JSON.stringify({
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    runtime: process.version, nodeEnv: process.env.NODE_ENV, ci: !!process.env.CI,
    commit: process.env.GITHUB_SHA,
    scale, metrics,
  }, null, 2) + "\n")
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      "### Beautiful UI performance", "",
      "| Measurement | Samples | p95 (ms) | Budget (ms) | Result |",
      "| --- | ---: | ---: | ---: | --- |",
      ...metrics.map(m => `| ${m.label} | ${m.samplesMs.length} | ${m.p95Ms.toFixed(2)} | ${m.budgetMs.toFixed(2)} | ${m.passed ? "Pass" : "Fail"} |`),
      "", "See the test report for cadence, timer cleanup, section reclamation and wheel-routing assertions.", "",
    ].join("\n"))
  }
})

describeNative("beautiful-ui smooth interactions", () => {
  it("responds promptly to layout clicks, hover, and captured scrub drags", async () => {
    fakeClock()
    const changes: FineTuneState[] = []
    const root = defineComponent({
      setup() {
        provideTheme()
        return () => h("div", { style: { width: 500 } }, [h(FineTuneCard, {
          fields: [{ key: "width", label: "Width", value: 100, min: 0, max: 1000 }],
          onChange: state => changes.push(state),
        })])
      },
    })
    const app = createTestApp(root)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.clock.pause()
    const timed = async (action: () => Promise<unknown>) => {
      const before = now()
      await action()
      return now() - before
    }
    try {
      await automation.clock.fastForward(400)
      await vi.advanceTimersByTimeAsync(200)
      await app.settle()
      const clicks: number[] = []
      const hovers: number[] = []
      for (let i = 0; i < 24; i++) {
        const locator = automation.getByTestId(i % 2 ? "fine-tune-segment-row" : "fine-tune-segment-grid")
        const hover = await timed(() => locator.hover())
        const click = await timed(() => locator.click())
        if (i >= 4) { hovers.push(hover); clicks.push(click) }
        expect(changes.at(-1)!.segment).toBe(i % 2 ? 0 : 2)
        await automation.clock.fastForward(300)
      }
      const dragMs = await timed(() => automation.getByTestId("fine-tune-scrub-width").dragBy(120, 0, { steps: 12 }))
      expect(changes.at(-1)!.values.width).toBe(160)
      reportBudget("layout click", clicks, budget.interaction)
      reportBudget("hover", hovers, budget.interaction)
      reportBudget("12-step scrub drag", [dragMs], budget.drag)
    } finally {
      app.unmount()
    }
  })

  it("samples multiple loaders smoothly in one batch and releases pinned/reduced clocks", async () => {
    fakeClock()
    const theme = createTheme()
    const phase = ref<number | undefined>(undefined)
    const root = defineComponent({
      setup() {
        provideTheme(theme)
        return () => h("div", {}, [
          ...(["Drive", "Dots", "Orbit", "Surfer"] as const).map(variant => h(LoadingState, { variant, phase: phase.value })),
          h(Shimmer, { phase: phase.value }, () => "Working"),
        ])
      },
    })
    const app = createTestApp(root)
    const automation = await connectTest(app.renderer, app.settle)
    await automation.clock.pause()
    const commits = vi.spyOn(app.renderer, "applyBatch")
    try {
      await vi.advanceTimersByTimeAsync(64)
      await app.settle()
      // Four 16ms ticks, shared across four grids and all five labels.
      // Independent loader/label timers used to produce separate commits.
      expect(commits.mock.calls.length).toBe(4)
      const animatedCells = app.renderer.findByType("div").filter(node => node.style.width === 4 && node.style.height === 4)
      expect(animatedCells.some(node => Number(node.style.opacity) > 0.15)).toBe(true)
      phase.value = 300
      await app.settle()
      const pinned = app.renderer.findByType("div").map(node => node.style.opacity)
      commits.mockClear()
      await vi.advanceTimersByTimeAsync(500)
      await app.settle()
      expect(commits).not.toHaveBeenCalled()
      expect(app.renderer.findByType("div").map(node => node.style.opacity)).toEqual(pinned)
      // Step pinned phases to time Vue's update, the mutation batch and native
      // paint together, excluding fake-timer harness overhead. All four loader
      // variants and their labels update, with eight warmup frames.
      const frames: number[] = []
      for (let i = 0; i < 38; i++) {
        const before = now()
        phase.value += 16
        await app.settle()
        if (i >= 8) frames.push(now() - before)
      }
      reportBudget("four-loader animation update and draw", frames, budget.frame)
      phase.value = undefined
      theme.reducedMotion.value = true
      await app.settle()
      commits.mockClear()
      await vi.advanceTimersByTimeAsync(400)
      await app.settle()
      expect(commits.mock.calls.length).toBeLessThanOrEqual(4)
      expect(app.renderer.findByType("div").filter(node => node.style.width === 4 && node.style.height === 4).every(node => Number(node.style.opacity) <= 0.15)).toBe(true)
    } finally {
      commits.mockRestore()
      app.unmount()
    }
    expect(vi.getTimerCount()).toBe(0)
  })

  it("keeps the gallery window bounded throughout scrolling", async () => {
    fakeClock()
    const app = createTestApp(App, { width: 960, height: 760 })
    const automation = await connectTest(app.renderer, app.settle)
    await automation.clock.pause()
    try {
      await vi.advanceTimersByTimeAsync(800)
      await app.settle()
      expect(app.renderer.getAllText()).toContain("Primary")
      const id = app.renderer.findByTestId("gallery-scroll")!.id
      app.renderer.scrollTo(id, 0, -5000)
      await app.settle()
      await vi.advanceTimersByTimeAsync(150)
      await app.settle()
      // Reclaim far sections during the gesture, keeping their reserved height.
      expect(app.renderer.getAllText()).not.toContain("Primary")
      await vi.advanceTimersByTimeAsync(600)
      await app.settle()
      expect(app.renderer.getAllText()).not.toContain("Primary")
      const draws: number[] = []
      for (let i = 0; i < 38; i++) {
        const before = now()
        app.renderer.flush()
        if (i >= 8) draws.push(now() - before)
      }
      reportBudget("scrolled gallery draw", draws, budget.frame)
      const wheels: number[] = []
      const offset = app.renderer.getScrollOffset(id)![1]
      for (let i = 0; i < 38; i++) {
        const before = now()
        // The wheel dispatch already draws; timing a later flush would miss it.
        app.renderer.dispatchScrollWheel(940, 400, 0, i % 2 ? 24 : -24)
        if (i >= 8) wheels.push(now() - before)
        if (i === 0) expect(app.renderer.getScrollOffset(id)![1]).toBeLessThan(offset)
      }
      reportBudget("gallery wheel dispatch and draw", wheels, budget.frame)
      app.renderer.scrollTo(id, 0, 0)
      await vi.advanceTimersByTimeAsync(150)
      await app.settle()
      expect(app.renderer.getAllText()).toContain("Primary")
    } finally {
      app.unmount()
    }
  }, 30_000)

  it("passes vertical wheel gestures through the table while columns pan horizontally", async () => {
    fakeClock()
    const root = defineComponent({
      setup() {
        provideTheme(createTheme({ reducedMotion: true }))
        return () => h("div", { testId: "page", style: { height: "100%", overflow: "scroll" } }, [
          h(RecordsTable, { rows: INITIAL_ROWS.slice(0, 5), scrollY: false }),
          h("div", { style: { height: 1200 } }, "After table"),
        ])
      },
    })
    const app = createTestApp(root, { width: 640, height: 760 })
    try {
      await vi.advanceTimersByTimeAsync(300)
      await app.settle()
      const table = app.renderer.findByTestId("records-scroll")!
      const page = app.renderer.findByTestId("page")!
      const b = app.renderer.getElementBounds(table.id)!
      const x = b.x + b.width * 0.8
      const y = b.y + 20
      app.renderer.dispatchScrollWheel(x, y, 0, -100)
      await app.settle()
      expect(app.renderer.getScrollOffset(page.id)![1]).toBeLessThan(0)
      expect(app.renderer.getScrollOffset(table.id)![1]).toBe(0)
      app.renderer.scrollTo(page.id, 0, 0)
      await app.settle()
      app.renderer.dispatchScrollWheel(x, y, -150, 0)
      await app.settle()
      expect(app.renderer.getScrollOffset(table.id)![0]).toBeLessThan(0)
      expect(app.renderer.getScrollOffset(page.id)![1]).toBe(0)
    } finally {
      app.unmount()
    }
  })
})
