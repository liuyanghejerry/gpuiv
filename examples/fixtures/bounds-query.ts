/** Production renderer regression: measuring painted bounds must not draw. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createApp, resetApp, type HostNode } from '@gpuiv/vue'

const top = ref(120)
const App = defineComponent(() => () => h('div', { style: { width: '100%', height: '100%' } }, [
  h('div', { testId: 'measured', style: { position: 'absolute', left: 80, top: top.value, width: 200, height: 80, backgroundColor: '#ffeea0' } }),
]))
// Fresh automation waits for ordinary window paints, which hidden Windows
// windows do not deliver. focus:false shows this fixture without activation.
const app = createApp(App, { width: 600, height: 400, focus: false, show: true })
const renderer = app.renderer
const find = (node: HostNode): HostNode | undefined => node.props.testId === 'measured' ? node : node.children.map(find).find(Boolean)
const id = find(app.container)!.id!
const freshTree = () => JSON.parse((renderer as typeof renderer & { getAutomationTree(): string }).getAutomationTree())
const treeBounds = (node: any): any => node?.testId === 'measured' ? node.bounds : node?.children?.map(treeBounds).find(Boolean)
let exitCode = 0
try {
  await Bun.sleep(300)
  const initial = treeBounds(freshTree())
  assert(initial)
  await Bun.sleep(80)
  const framesBefore = renderer.getDebugFrameOverlayStats!().frames
  assert(framesBefore > 0, 'This regression requires actual recorded GPUI frames')
  const start = performance.now()
  for (let i = 0; i < 120; i++) assert.deepEqual(renderer.getElementBounds!(id), initial)
  const queryMs = performance.now() - start
  await Bun.sleep(80)
  const framesAfter = renderer.getDebugFrameOverlayStats!().frames
  assert.equal(framesAfter, framesBefore, 'Bounds polling unexpectedly triggers paint')

  top.value = 220
  await nextTick()
  // macOS pumps native frames from Node's main loop; let that pump paint the
  // mutation before reading its last-painted map. Threaded platforms also
  // retain the fresh-frame automation query below.
  await Bun.sleep(80)
  const moved = treeBounds(freshTree())
  assert.equal(moved.y, 220)
  assert.deepEqual(renderer.getElementBounds!(id), moved, 'Fresh automation bounds must match the last-painted snapshot')
  console.log('BOUNDS_QUERY_RESULT', JSON.stringify({ queries: 120, queryMs, framesBefore, framesAfter, initial, moved }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
