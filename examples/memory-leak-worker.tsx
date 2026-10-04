/** Finite production-Bun workload, invoked by the Vitest memory gate. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setImmediate as yieldTask, setTimeout as sleep } from 'node:timers/promises'
import { heapStats } from 'bun:jsc'
import { defineComponent, h, ref, type Component } from 'vue'
import { GpuixCanvas, Select, SelectTrigger, SelectContent, SelectItem, VirtualList, motion, type GpuixCanvasInstance, type ImgHostNode } from '@gpuiv/vue'
import { connectTest } from '@gpuiv/vue/automation'
import { createTestApp, hasNativeTestRenderer, type TestApp, type TestResourceStats } from '@gpuiv/vue/testing'
import { AgentScreen, LoadingState, Shimmer, provideTheme } from '@gpuiv/beautiful-ui'
import { getAnimationClockStatsForTests } from '../packages/beautiful-ui/dist/animation-clock.js'
import { containerForRenderer } from '../packages/vue/dist/reconciler/event-registry.js'
import { App as Gallery } from './beautiful-ui'

const scenario = process.argv[2]
assert(['loaders', 'gallery', 'overlays', 'native'].includes(scenario), 'Unknown memory scenario')
assert(process.platform === 'darwin' && hasNativeTestRenderer, 'Memory gate requires the macOS release native test renderer')
assert(!process.env.THROTTLE && process.env.NODE_ENV === 'production', 'Memory gate requires production and THROTTLE unset')
const output = resolve(import.meta.dirname, '../tmp/memory-leak-gate')
mkdirSync(output, { recursive: true })
const warmupCycles = 10, cycles = 30
const timers = new Map<ReturnType<typeof setTimeout>, 'timeout' | 'interval'>()
const original = { setTimeout, clearTimeout, setInterval, clearInterval }
globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
  const handle = original.setTimeout(() => { timers.delete(handle); callback(...args) }, delay)
  timers.set(handle, 'timeout')
  return handle
}) as typeof setTimeout
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
  const handle = original.setInterval(...args)
  timers.set(handle, 'interval')
  return handle
}) as typeof setInterval
globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => { timers.delete(handle); original.clearTimeout(handle) }) as typeof clearTimeout
globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => { timers.delete(handle); original.clearInterval(handle) }) as typeof clearInterval

const Loaders = defineComponent({ setup() {
  provideTheme()
  return () => h('div', {}, [
    ...(['Drive', 'Dots', 'Orbit', 'Surfer'] as const).map(variant => h(LoadingState, { variant })),
    h(Shimmer, {}, () => 'Working'),
  ])
} })
const Overlays = defineComponent({ setup() {
  provideTheme()
  return () => h('div', { style: { width: 800, height: 700 } }, [
    h(Select, {}, () => [
      h(SelectTrigger, { testId: 'memory-select' }, () => 'Choose'),
      h(SelectContent, { testId: 'memory-menu' }, () => h(SelectItem, { value: 'one' }, () => 'One')),
    ]),
    h(AgentScreen, { streamSrc: '' }),
  ])
} })
const canvas = ref<GpuixCanvasInstance | null>(null)
const image = ref<ImgHostNode | null>(null)
const canvasSize = ref(32)
const Native = defineComponent({ setup() {
  return () => h('div', { style: { width: 800, height: 700 } }, [
    h('input', { testId: 'memory-input', value: 'needle', onFocus: () => {}, onBlur: () => {}, onChange: () => {} }),
    h('div', { highlight: { query: 'needle' } }, [h('text', {}, 'needle ' + 'content '.repeat(500))]),
    h('code', { code: 'const needle = 1', language: 'typescript' }),
    h(motion.div, { animate: { opacity: 1 }, initial: { opacity: 0 } }, () => 'Motion'),
    h(VirtualList, { testId: 'memory-list', itemCount: 100, estimatedItemHeight: 24,
      style: { height: 120 }, renderItem: (i: number) => h('text', {}, `Row ${i}`) }),
    h('div', { style: { height: 40, overflow: 'scroll' } }, [h('div', { style: { height: 100 } }, 'Scroll')]),
    h('img', { ref: image, style: { width: 32, height: 32 } }),
    h(GpuixCanvas, { ref: canvas, width: canvasSize.value, height: canvasSize.value, style: { width: 48, height: 48 } }),
  ])
} })

const perNode = ['retainedElements', 'focusHandles', 'focusSubscriptions', 'scrollHandles', 'motionStates',
  'virtualLists', 'highlightEntries', 'customElements', 'liveImages', 'canvasSurfaces', 'canvasTiles',
  'retiredCanvasImages', 'eventHandlerNodes', 'eventHandlers'] as const
const resources: Array<{ cycle: number, stats: TestResourceStats, timers: number, clocks: number, subscribers: number }> = []
const samples: Array<{ cycle: number, heapSize: number, extraMemorySize: number, objectCount: number, rss: number }> = []
const observed: Partial<TestResourceStats> = {}
let app: TestApp | undefined, error: string | undefined, completedCycles = 0
const shown = ref(false)
const Content = ({ loaders: Loaders, gallery: Gallery, overlays: Overlays, native: Native } as Record<string, Component>)[scenario]!
const Root = defineComponent({ setup: () => () => h('div', { style: { width: '100%', height: '100%' } }, shown.value ? [h(Content)] : []) })

async function waitFor(current: TestApp, predicate: () => boolean, message: string) {
  const deadline = Date.now() + 3000
  while (!predicate() && Date.now() < deadline) { await sleep(50); await current.settle() }
  assert(predicate(), message)
}

async function collect() {
  // Allow promise stacks and deferred input handlers to disappear before GC.
  await yieldTask(); Bun.gc(true); await yieldTask(); Bun.gc(true)
  const stats = heapStats()
  return { heapSize: stats.heapSize, extraMemorySize: stats.extraMemorySize, objectCount: stats.objectCount, rss: process.memoryUsage.rss() }
}
function recordObserved(stats: TestResourceStats) {
  for (const key of Object.keys(stats) as Array<keyof TestResourceStats>) observed[key] = Math.max(observed[key] ?? 0, stats[key])
}
async function exercise(current: TestApp) {
  const ui = await connectTest(current.renderer, current.settle)
  if (scenario === 'loaders') {
    assert(getAnimationClockStatsForTests().subscribers >= 5, 'Loaders must actually subscribe')
    await sleep(40); await current.settle()
  } else if (scenario === 'gallery') {
    await sleep(440); await current.settle()
    const id = current.renderer.findByTestId('gallery-scroll')!.id
    assert(current.renderer.getAllText().includes('Primary'), 'Top section must mount')
    current.renderer.scrollTo(id, 0, -5000)
    await current.settle()
    assert(current.renderer.getScrollOffset(id)![1] < -3000, 'Gallery must actually scroll')
    await waitFor(current, () => !current.renderer.getAllText().includes('Primary'), 'Scroll must reclaim the top section')
    current.renderer.scrollTo(id, 0, 0)
    await current.settle()
    await waitFor(current, () => current.renderer.getAllText().includes('Primary'), 'Top section must remount')
  } else if (scenario === 'overlays') {
    await ui.getByTestId('memory-select').click()
    assert(current.renderer.findByTestId('memory-menu'), 'Menu must open')
    await ui.getByTestId('memory-select').press('escape')
    await ui.getByTestId('agent-screen-open').click()
    assert(current.renderer.findByTestId('agent-screen-viewer'), 'Dialog must open')
    recordObserved(current.renderer.getResourceStats())
    await ui.getByTestId('agent-screen-collapse').click()
    assert(!current.renderer.findByTestId('agent-screen-viewer'), 'Dialog must close')
  } else {
    await ui.getByTestId('memory-input').fill('changed needle')
    const pixels = new Uint8Array(32 * 32 * 4).fill(255)
    image.value!.setImagePixels(32, 32, pixels)
    image.value!.setImagePixels(32, 32, pixels, { format: 'bgra' })
    canvas.value!.getContext('2d')!.fillRect(0, 0, 32, 32)
    await current.settle()
    recordObserved(current.renderer.getResourceStats())
    canvasSize.value = 48
    await current.settle()
    canvas.value!.getContext('2d')!.fillRect(0, 0, 48, 48)
    await current.settle()
    current.renderer.scrollTo(current.renderer.findByTestId('memory-list')!.id, 0, -900)
    await current.settle()
    canvasSize.value = 32
  }
  recordObserved(current.renderer.getResourceStats())
}

try {
  app = createTestApp(Root, { width: 960, height: 760 })
  app.renderer.clockPause()
  const baseline = app.renderer.getResourceStats()
  assert.throws(() => app!.renderer.assertNoNewEntityLeaks(), /baseline/i)
  app.renderer.captureEntityLeakBaseline()
  for (let cycle = 0; cycle < cycles; cycle++) {
    shown.value = true
    await app.settle()
    await exercise(app)
    shown.value = false
    await app.settle()
    app.renderer.flush()
    app.renderer.advanceTime(1000)
    await sleep(20)
    app.renderer.flush()
    await yieldTask()
    // Explicit fault cases prove each deterministic check rejects retention.
    if (cycle === 0 && process.env.GPUIV_MEMORY_FAULT) {
      const fault = process.env.GPUIV_MEMORY_FAULT
      if (fault === 'timer') setInterval(() => {}, 60_000)
      else if (fault === 'node') app.renderer.applyBatch(JSON.stringify([['createElement', 99999999, 'div']]))
      else if (fault === 'handler') {
        const payload = new Uint8Array(1024 * 1024)
        containerForRenderer(app.renderer)!.eventHandlers.set(99999999, new Map([['click', () => payload.byteLength]]))
      } else throw new Error('Unknown memory fault')
    }
    const stats = app.renderer.getResourceStats(), clock = getAnimationClockStatsForTests()
    resources.push({ cycle, stats, timers: timers.size, ...clock })
    for (const key of perNode) assert.equal(stats[key], baseline[key], `${scenario} cycle ${cycle}: ${key} retained resources`)
    // These caches intentionally keep reusable data; they must stay bounded.
    assert(stats.internedStyles <= 64, 'Style cache exceeds its empty-tree sweep floor')
    assert(stats.syntaxDocuments <= 96 && stats.syntaxRetainedBytes <= 24 * 1024 * 1024, 'Syntax cache exceeds its declared bounds')
    assert.equal(timers.size, 0, 'Component timers survived unmount')
    assert.deepEqual(clock, { clocks: 0, subscribers: 0 }, 'Animation subscriptions survived unmount')
    app.renderer.assertNoNewEntityLeaks()
    completedCycles++
    if (cycle >= warmupCycles && (cycle + 1) % 5 === 0) samples.push({ cycle, ...await collect() })
  }
  const required = scenario === 'native' ? ['focusHandles', 'focusSubscriptions', 'scrollHandles', 'motionStates', 'virtualLists',
    'highlightEntries', 'customElements', 'liveImages', 'canvasSurfaces', 'canvasTiles'] as const : []
  for (const key of required) assert((observed[key] ?? 0) > 0, `${key} was never exercised`)
} catch (failure) {
  error = failure instanceof Error ? failure.stack : String(failure)
} finally {
  try {
    app?.unmount()
    if (app && !error) {
      const final = app.renderer.getResourceStats()
      for (const key of perNode) assert.equal(final[key], 0, `Final unmount: ${key}`)
      app.renderer.assertNoNewEntityLeaks()
    }
  } catch (failure) { error ??= failure instanceof Error ? failure.stack : String(failure) }
  for (const [timer, kind] of timers) (kind === 'interval' ? original.clearInterval : original.clearTimeout)(timer)
  Object.assign(globalThis, original)
  const growth = samples.length > 1 ? {
    heapBytes: samples.at(-1)!.heapSize - samples[0]!.heapSize,
    rssBytes: samples.at(-1)!.rss - samples[0]!.rss,
  } : null
  writeFileSync(resolve(output, `${scenario}${process.env.GPUIV_MEMORY_FAULT ? '-' + process.env.GPUIV_MEMORY_FAULT : ''}.json`), JSON.stringify({
    scenario, fault: process.env.GPUIV_MEMORY_FAULT ?? null, status: error ? 'failed' : 'passed',
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, nodeEnv: process.env.NODE_ENV },
    commit: process.env.GITHUB_SHA, warmupCycles, cycles, completedCycles,
    byteBudgetsEnforced: false, observed, resources, samples, growth, error,
  }, null, 2) + '\n')
}
if (error) { console.error(error); process.exitCode = 1 }
