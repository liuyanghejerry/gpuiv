/** Many shared GPUI asset completions must coalesce their view invalidation. */
import assert from 'node:assert/strict'
import { defineComponent, h } from 'vue'
import { createApp, resetApp } from '@gpuiv/vue'

const count = 48
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="#82d5bb"/></svg>'
let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
let requests = 0, loads = 0, errors = 0
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch() {
  requests++
  await gate
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
} })
const app = createApp(defineComponent(() => () => h('div', { style: { display: 'flex', flexWrap: 'wrap' } },
  Array.from({ length: count }, (_, id) => h('img', { src: `http://127.0.0.1:${server.port}/${id}.svg`,
    style: { width: 24, height: 18 }, onLoad: () => { loads++ }, onError: () => { errors++ } })))),
  { width: 500, height: 300, focus: false, show: false })
async function until(condition: () => boolean) {
  const deadline = Date.now() + 6000
  while (!condition() && Date.now() < deadline) await Bun.sleep(10)
  assert(condition(), `Image completion burst did not settle: ${requests} requests, ${loads} loads, ${errors} errors`)
}
let exitCode = 0
try {
  await until(() => requests === count)
  await Bun.sleep(80)
  const before = app.renderer.getDebugFrameOverlayStats!().frames
  release()
  await until(() => loads === count)
  await Bun.sleep(100)
  const after = app.renderer.getDebugFrameOverlayStats!().frames
  const frames = after - before
  console.log('IMAGE_COMPLETION_BURST_RESULT', JSON.stringify({ count, loads, errors, frames }))
  assert.equal(errors, 0)
  assert(frames < count / 2, `Asset completions drew ${frames} frames for ${count} images instead of batching their notifications`)
} catch (error) { console.error(error); exitCode = 1 }
finally { release(); resetApp(); server.stop(true) }
process.exit(exitCode)
