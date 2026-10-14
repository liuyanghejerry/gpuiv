/** Production decode events must size both the frame and its GPUI image leaf. */
import assert from 'node:assert/strict'
import { defineComponent, h, ref } from 'vue'
import { createApp, resetApp, type ElementBounds, type HostNode } from '@gpuiv/vue'
import { Image } from '@gpuiv/animal-island'

const svg = (height: number) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="${height}"><rect width="80" height="${height}" fill="#82d5bb"/></svg>`).toString('base64')}`
const initial = svg(60), replacement = svg(40)
const current = ref(initial)
const loads = new Map<string, number>()
let errors = 0
const cases = [
  { id: 'default-width', props: { width: 240 }, frame: [240, 180], image: [240, 180] },
  { id: 'bordered-width', props: { width: 240, variant: 'bordered' as const }, frame: [240, 186], image: [216, 162] },
  { id: 'stamp-width', props: { width: '240px', variant: 'stamp' as const }, frame: [240, 187], image: [212, 159] },
  { id: 'height-only', props: { height: '180px' }, frame: [240, 180], image: [240, 180] },
  { id: 'explicit-fill', props: { width: 240, height: 100 }, frame: [240, 100], image: [240, 100] },
  { id: 'padding-boundary', props: { width: 24, variant: 'bordered' as const }, frame: [24, 24], image: [0, 0] },
  { id: 'attribute-width', props: { width: 480, style: { width: 160, padding: 10 } }, frame: [160, 125], image: [140, 105] },
]
const app = createApp(defineComponent(() => () => h('div', {
  style: { width: '100%', height: '100%', padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20 },
}, [cases.slice(0, 3), cases.slice(3)].map(group => h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 20 } }, group.map(test => h(Image, {
  ...test.props, src: test.id === 'default-width' ? current.value : initial, preview: false, testId: test.id,
  onLoad: () => loads.set(test.id, (loads.get(test.id) ?? 0) + 1),
  onError: () => { errors++ },
})))))), { width: 1100, height: 700, focus: false, show: false })
const renderer = app.renderer
function find(testId: string): HostNode | undefined {
  const walk = (node: HostNode): HostNode | undefined => node.props.testId === testId ? node : node.children.map(walk).find(Boolean)
  return walk(app.container)
}
function bounds(testId: string): ElementBounds | null {
  const id = find(testId)?.id
  return id == null ? null : renderer.getElementBounds?.(id) ?? null
}
const sameSize = (box: ElementBounds | null, size: number[]) => box !== null && Math.abs(box.width - size[0]!) <= 1 && Math.abs(box.height - size[1]!) <= 1
async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) await Bun.sleep(25)
  assert(condition(), label)
}

let exitCode = 0
try {
  await until(() => cases.every(test => loads.get(test.id) === 1), 'All images must complete their real native decodes')
  await until(() => cases.every(test => sameSize(bounds(test.id), test.frame) && sameSize(bounds(`${test.id}-img`), test.image)), 'Decoded ratio must size frames and image leaves, including padded/non-proportional boxes')
  const measured = Object.fromEntries(cases.map(test => [test.id, { frame: bounds(test.id), image: bounds(`${test.id}-img`) }]))

  current.value = replacement
  await until(() => loads.get('default-width') === 2, 'Replacement source must decode')
  await until(() => sameSize(bounds('default-width'), [240, 120]) && sameSize(bounds('default-width-img'), [240, 120]), 'Replacement ratio must clear the old height and size the new image')
  current.value = 'data:image/png;base64,bm90LWFuLWltYWdl'
  await until(() => errors === 1, 'Invalid replacement must report an error')
  await until(() => !find('default-width-img') && bounds('default-width') !== null && bounds('default-width')!.height < 100, 'Failure must remove intrinsic sizing and use the original error content height')
  assert.equal(find('default-width')!.props.role, 'img')
  assert.equal((find('default-width')!.props.style as { height?: number }).height, undefined)
  console.log('ANIMAL_IMAGE_INTRINSIC_RESULT', JSON.stringify({ measured, replacementHeight: 120, errorHeight: bounds('default-width')!.height }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally { resetApp() }
process.exit(exitCode)
