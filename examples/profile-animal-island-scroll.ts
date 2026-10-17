/** Production scroll profile, including Linux without a headless renderer.
 * Run from examples: PROFILE_LABEL=after bun --cpu-prof
 *   --cpu-prof-dir=../tmp/animal-island-perf profile-animal-island-scroll.ts
 * Frame stats are GPUI draw duration; the fixed-rate scroll driver also
 * reports event-loop delays and the time spent in synchronous native queries.
 * PROFILE_STEPS=90 fixes the trajectory to 90 steps of 30px for A/B runs;
 * without it, the driver keeps its 2500ms duration limit.
 * PROFILE_PAGE chooses a component page (default: back-top, with long content).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { defineComponent, h } from 'vue'
import { createApp, resetApp, type HostNode } from '@gpuiv/vue'
import { App } from './animal-island'

const fixedSteps = process.env.PROFILE_STEPS ? Number(process.env.PROFILE_STEPS) : null
if (fixedSteps !== null && (!Number.isSafeInteger(fixedSteps) || fixedSteps <= 0)) {
  throw new Error('PROFILE_STEPS must be a positive integer')
}
const page = process.env.PROFILE_PAGE ?? 'back-top'
const ProfileApp = defineComponent(() => () => h(App, { initialPage: page }))
const nativeApp = createApp(ProfileApp, { width: 1120, height: 820, focus: false, show: false })
const renderer = nativeApp.renderer
const find = (node: HostNode, id: string): HostNode | undefined => node.props?.testId === id ? node : node.children.map(child => find(child, id)).find(Boolean)
const scrollId = find(nativeApp.container, 'gallery-scroll')!.id!
let measuring = false
const calls: Record<string, { calls: number, totalMs: number, maxMs: number }> = {}
for (const name of ['getElementBounds', 'getWindowSize', 'getFocusedElementId', 'getScrollOffset', 'applyBatch'] as const) {
  const original = renderer[name]?.bind(renderer)
  if (!original) continue
  Object.defineProperty(renderer, name, { value: (...args: unknown[]) => {
    const start = performance.now()
    try { return (original as (...args: unknown[]) => unknown)(...args) }
    finally {
      if (measuring) {
        const dt = performance.now() - start
        const stat = calls[name] ??= { calls: 0, totalMs: 0, maxMs: 0 }
        stat.calls++; stat.totalMs += dt; stat.maxMs = Math.max(stat.maxMs, dt)
      }
    }
  }, configurable: true })
}
await Bun.sleep(1600)
renderer.resetDebugFrameOverlayStats!()
measuring = true
const started = performance.now()
let steps = 0
while (fixedSteps === null ? performance.now() - started < 2500 : steps < fixedSteps) {
  renderer.scrollTo!(scrollId, 0, -(++steps * 30))
  await Bun.sleep(16)
}
const elapsedMs = performance.now() - started
measuring = false
const frames = renderer.getDebugFrameOverlayStats!()
const count = (node: HostNode): number => 1 + node.children.reduce((n, child) => n + count(child), 0)
const metric = { label: process.env.PROFILE_LABEL ?? 'current', page, fixedSteps, elapsedMs, steps, stepMs: elapsedMs / steps, calls, frames, finalOffset: renderer.getScrollOffset?.(scrollId), nodes: count(nativeApp.container) }
mkdirSync('../tmp/animal-island-perf', { recursive: true })
writeFileSync(`../tmp/animal-island-perf/${metric.label}.json`, JSON.stringify(metric, null, 2))
console.log('ANIMAL_ISLAND_PERF', JSON.stringify(metric))
resetApp()
process.exit(0)
