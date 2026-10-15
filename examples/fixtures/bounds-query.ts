/** Production renderer regression: measuring painted bounds must not draw. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createApp, resetApp, type HostNode } from '@gpuiv/vue'

const top = ref(120)
const mounted = ref<{ key: number; top: number; width: number } | null>(null)
const App = defineComponent(() => () => h('div', { style: { width: '100%', height: '100%' } }, [
  h('div', { testId: 'measured', style: { position: 'absolute', left: 80, top: top.value, width: 200, height: 80, backgroundColor: '#ffeea0' } }),
  mounted.value ? h('div', { key: mounted.value.key, testId: 'just-mounted', style: { position: 'absolute', left: 320, top: mounted.value.top, width: mounted.value.width, height: 32, backgroundColor: '#19c8b9' } }) : null,
]))
// Fresh automation waits for ordinary window paints, which hidden Windows
// windows do not deliver. focus:false shows this fixture without activation.
const app = createApp(App, { width: 600, height: 400, focus: false, show: true })
const renderer = app.renderer
const find = (node: HostNode): HostNode | undefined => node.props.testId === 'measured' ? node : node.children.map(find).find(Boolean)
const id = find(app.container)!.id!
const freshTree = () => JSON.parse((renderer as typeof renderer & { getAutomationTree(): string }).getAutomationTree())
const treeBounds = (node: any, testId = 'measured'): any => node?.testId === testId ? node.bounds : node?.children?.map((child: any) => treeBounds(child, testId)).find(Boolean)
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
  await Promise.resolve()
  // macOS pumps native frames on Node's main thread and exposes snapshots.
  // Threaded platforms must themselves wait for a complete requested paint;
  // an arbitrary sleep here would conceal a one-frame-stale bounds response.
  if (process.platform === 'darwin') await Bun.sleep(80)
  const moved = treeBounds(freshTree())
  assert.equal(moved.y, 220)
  assert.deepEqual(renderer.getElementBounds!(id), moved, 'Fresh automation bounds must match the last-painted snapshot')
  const freshMounts = []
  for (let key = 0; key < 5; key++) {
    const target = { key, top: 40 + key * 35, width: 64 + key * 12 }
    top.value = 150 + key * 20
    mounted.value = target
    await nextTick()
    await Promise.resolve()
    if (process.platform === 'darwin') await Bun.sleep(80)
    // No timer or polling retry separates this committed mount/layout update
    // from its threaded automation query. Every key creates a new native id,
    // so a previous frame's bounds cannot accidentally satisfy this assertion.
    const tree = freshTree()
    const latest = treeBounds(tree, 'just-mounted')
    const existing = treeBounds(tree)
    assert(latest && latest.width > 0, `Fresh query must include newly mounted node ${key}'s painted bounds`)
    assert.deepEqual(latest, { x: 320, y: target.top, width: target.width, height: 32 })
    assert.equal(existing.y, top.value, 'New and existing nodes must belong to the same committed layout')
    freshMounts.push({ ...latest, existingY: existing.y })
  }
  console.log('BOUNDS_QUERY_RESULT', JSON.stringify({ queries: 120, queryMs, framesBefore, framesAfter, initial, moved, freshMounts }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
