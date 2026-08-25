/**
 * Chat performance regression (Vue). Times mount, scroll draw, and chrome
 * setState. Skip without the native GPU test renderer.
 *
 * Time dispatchScrollWheel(), not a later flush(). The wheel already draws.
 * Overlay stats include the setup flush after reset, so they are logged only.
 *
 * THROTTLE=utility|background|maintenance re-execs under taskpolicy -c.
 * A throttled run logs numbers and skips the default budgets.
 */

import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  createTestApp,
  hasNativeTestRenderer,
  readMacCpuThrottle,
  type TestApp,
} from '@gpuiv/vue'
import { connectTest } from '@gpuiv/vue/automation'
import { ChatApp } from './chat'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const throttle = readMacCpuThrottle()
const TURNS = 1_000
const WARMUP = 10
const WHEEL_SAMPLES = 40
const WHEEL_X = 700
const WHEEL_Y = 400

const BUDGET = {
  // Vue mounts the app tree through createRenderer and a single applyBatch;
  // the 1000-turn window mount runs ~160ms on an M3 Pro — leave headroom.
  mountMs: 300,
  idleP95Ms: 8,
  idleMaxMs: 16,
  wheelP95Ms: 8,
  wheelMaxMs: 16,
  sidebarMs: 40,
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    n: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function report(label: string, samples: number[]) {
  const stats = summarize(samples)
  const clamp = throttle ?? 'off'
  console.log(
    `[chat.perf] ${label} throttle=${clamp} n=${stats.n} ` +
      `p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms max=${stats.max.toFixed(2)}ms`,
  )
  return stats
}

function expectBudget(args: {
  label: string
  samples: number[]
  p95Max: number
  maxMax: number
}) {
  const stats = report(args.label, args.samples)
  if (throttle) return
  expect(stats.p95, `${args.label} p95 ${stats.p95.toFixed(2)}ms exceeds ${args.p95Max}ms`).toBeLessThan(
    args.p95Max,
  )
  expect(stats.max, `${args.label} max ${stats.max.toFixed(2)}ms exceeds ${args.maxMax}ms`).toBeLessThan(
    args.maxMax,
  )
}

function sampleFlushes(args: {
  renderer: TestApp['renderer']
  count: number
  beforeFlush?: (index: number) => void
}): number[] {
  const samples: number[] = []
  for (let i = 0; i < args.count; i++) {
    args.beforeFlush?.(i)
    const start = performance.now()
    args.renderer.flush()
    samples.push(performance.now() - start)
  }
  return samples
}

function mountChat(): TestApp {
  const Wrapped = defineComponent({
    setup: () => () => <ChatApp turnCount={TURNS} includeSafeMdx />,
  })
  return createTestApp(Wrapped)
}

it('rejects an unknown THROTTLE value', () => {
  const previous = process.env.THROTTLE
  process.env.THROTTLE = 'nope'
  try {
    expect(() => readMacCpuThrottle()).toThrow(/utility, background, or maintenance/)
  } finally {
    if (previous === undefined) delete process.env.THROTTLE
    else process.env.THROTTLE = previous
  }
})

describeNative('chat performance (vue)', () => {
  it('mounts 1000 turns under budget', () => {
    const start = performance.now()
    const app = mountChat()
    const mountMs = performance.now() - start
    console.log(`[chat.perf] mount throttle=${throttle ?? 'off'} ${mountMs.toFixed(1)}ms`)
    if (!throttle) {
      expect(mountMs, `mount ${mountMs.toFixed(1)}ms exceeds ${BUDGET.mountMs}ms`).toBeLessThan(
        BUDGET.mountMs,
      )
    }
    app.unmount()
  })

  it('keeps idle flush and wheel draw under budget', () => {
    const app = mountChat()
    const { renderer } = app

    sampleFlushes({ renderer, count: WARMUP })
    expectBudget({
      label: 'idle flush',
      samples: sampleFlushes({ renderer, count: WHEEL_SAMPLES }),
      p95Max: BUDGET.idleP95Ms,
      maxMax: BUDGET.idleMaxMs,
    })

    for (let i = 0; i < WARMUP; i++) {
      renderer.dispatchScrollWheel(WHEEL_X, WHEEL_Y, 0, i % 2 === 0 ? -160 : 160)
    }
    renderer.resetDebugFrameOverlayStats()
    renderer.flush()

    const wheel: number[] = []
    for (let i = 0; i < WHEEL_SAMPLES; i++) {
      const start = performance.now()
      renderer.dispatchScrollWheel(WHEEL_X, WHEEL_Y, 0, -160)
      wheel.push(performance.now() - start)
    }
    expectBudget({
      label: 'wheel',
      samples: wheel,
      p95Max: BUDGET.wheelP95Ms,
      maxMax: BUDGET.wheelMaxMs,
    })

    const overlay = renderer.getDebugFrameOverlayStats()
    console.log(
      `[chat.perf] overlay p90=${overlay.p90Ms?.toFixed(2)}ms max=${overlay.maxMs?.toFixed(2)}ms samples=${overlay.samples}`,
    )
    expect(overlay.samples).toBeGreaterThan(0)
    app.unmount()
  })

  it('keeps a sidebar click under budget', async () => {
    const app = mountChat()
    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId('sidebar-collapse').waitFor()
    await automation.clock.pause()

    const samples: number[] = []
    for (let i = 0; i < 8; i++) {
      const testId = i % 2 === 0 ? 'sidebar-collapse' : 'sidebar-expand'
      const start = performance.now()
      await automation.getByTestId(testId).click()
      samples.push(performance.now() - start)
      await automation.clock.fastForward(200)
    }
    await automation.clock.resume()
    const stats = report('sidebar click', samples)
    if (!throttle) {
      expect(
        stats.max,
        `sidebar click ${stats.max.toFixed(1)}ms exceeds ${BUDGET.sidebarMs}ms`,
      ).toBeLessThan(BUDGET.sidebarMs)
    }
    app.unmount()
  })
})
