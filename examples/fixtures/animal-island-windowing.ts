import assert from 'node:assert/strict'
import { createApp, resetApp, type HostNode } from '@gpuiv/vue'
import { App } from '../animal-island'
const app = createApp(App, { width: 1120, height: 820, focus: false, show: false })
const all = (): HostNode[] => {
  const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
  return walk(app.container)
}
const find = (id: string) => all().find(node => node.props.testId === id)!
const scrollId = find('gallery-scroll').id!
const snapshot = (label: string) => {
  const root = app.renderer.getElementBounds!(find('gallery-root').id!)!
  const scroll = app.renderer.getElementBounds!(scrollId)!
  const mounted = all().filter(node => /^section-mounted-/.test(String(node.props.testId))).map(node => node.props.testId)
  const placeholders = all().filter(node => /^section-placeholder-/.test(String(node.props.testId))).length
  assert(root && scroll)
  // The scroll host's bounds tracker includes its content translation.
  // Its height remains the actual viewport height throughout scrolling.
  const offset = app.renderer.getScrollOffset!(scrollId)!
  assert(Math.abs(scroll.y - offset[1] + scroll.height - (root.y + root.height)) < 1)
  assert(mounted.length > 0 && placeholders > 0)
  assert.equal(all().filter(node => (node.props.style as any)?.overflow === 'scroll').length, 1)
  const value = { label, root, scroll, offset, nodes: all().length, mounted, placeholders }
  console.log('GALLERY_WINDOWING', JSON.stringify(value))
  return value
}
let exitCode = 0
try {
  await Bun.sleep(1400)
  const start = snapshot('top')
  assert(find('btn-default'))
  assert(!find('animal-table'))
  app.renderer.scrollTo!(scrollId, 0, -6000)
  await Bun.sleep(800)
  const deep = snapshot('deep')
  assert(!find('btn-default'))
  assert(find('animal-table'))
  app.renderer.resizeWindow!(840, 640)
  await Bun.sleep(1600)
  const resized = snapshot('resized')
  assert.equal(resized.root.width, 840)
  assert.equal(resized.root.height, 640)
  app.renderer.scrollTo!(scrollId, 0, 0)
  await Bun.sleep(800)
  const returned = snapshot('returned')
  assert(find('btn-default'))
  assert(!find('animal-table'))
  console.log('GALLERY_WINDOWING_OK', JSON.stringify({ topNodes: start.nodes, deepNodes: deep.nodes, resizedNodes: resized.nodes, returnedNodes: returned.nodes }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally { resetApp() }
process.exit(exitCode)
