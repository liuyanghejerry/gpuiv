import assert from 'node:assert/strict'
import { defineComponent, h, ref } from 'vue'
import { createApp, resetApp, type EventPayload, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { Avatar, Image } from '@gpuiv/animal-island'

const valid = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#82d5bb"/></svg>').toString('base64')}`
const invalid = 'data:image/png;base64,bm90LWFuLWltYWdl'
const src = ref(valid), avatarSrc = ref(invalid)
const loads: EventPayload[] = [], errors: EventPayload[] = []
let avatarFailures = 0
const app = createApp(defineComponent(() => () => h('div', { style: { display: 'flex', gap: 20 } }, [
  h(Image, { src: src.value, testId: 'picture', width: 160, height: 120, onLoad: (event: EventPayload) => loads.push(event), onError: (event: EventPayload) => errors.push(event) }),
  h(Avatar, { src: avatarSrc.value, testId: 'avatar', onError: () => { avatarFailures++ } }, { default: () => h('text', '岛') }),
// Exercise ordinary image notifications and animation completion on a live
// surface. A hidden macOS window suspends normal frame delivery.
])), { width: 400, height: 240, focus: false })

const all = (): HostNode[] => {
  const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
  return walk(app.container)
}
const find = (id: string) => all().find(node => node.props.testId === id)
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) await Bun.sleep(25)
  assert(condition(), 'native image lifecycle did not settle')
}

let exitCode = 0
try {
  await until(() => loads.length === 1 && avatarFailures === 1)
  // GPUI rasterizes SVG at 2x; event dimensions are decoded bitmap pixels.
  assert.equal(JSON.parse(loads[0]!.value!).naturalWidth, 160)
  assert.equal(JSON.parse(loads[0]!.value!).naturalHeight, 120)
  assert.equal((find('picture-img')!.props.motion as { animate: { opacity: number } }).animate.opacity, 1)
  assert(!find('avatar-img'))
  assert(all().some(node => node.text === '岛'))
  await Bun.sleep(300)
  const bounds = app.renderer.getElementBounds!(find('picture')!.id!)!
  assert.equal(bounds.width, 160)
  assert.equal(bounds.height, 120)
  const live = app.renderer as unknown as LiveAutomationRenderer
  const automation = await connectTest(liveRendererAsTest(live), async () => { await Bun.sleep(50) })
  await automation.getByTestId('picture').click()
  await until(() => Boolean(find('picture-preview')))
  await Bun.sleep(350)
  live.getAutomationTree()
  const previewBounds = app.renderer.getElementBounds!(find('picture-preview')!.id!)!
  await automation.mouse.click({ x: previewBounds.x + 4, y: previewBounds.y + previewBounds.height - 4 })
  assert(find('picture-preview'), 'Clicking the image must not reach its dismissal mask')
  await automation.getByTestId('picture-preview-close').press('tab')
  assert.equal(app.renderer.getFocusedElementId!(), find('picture-preview-close')!.id, 'Tab must stay on the dialog close button')
  await automation.mouse.click({ x: 3, y: 237 })
  await until(() => !find('picture-preview'))
  src.value = invalid
  await until(() => errors.length === 1)
  assert(!find('picture-img'))
  assert.equal(find('picture')!.props.role, 'img')
  assert(all().some(node => node.text === '图片加载失败'))
  src.value = valid
  avatarSrc.value = valid
  await until(() => loads.length === 2 && Boolean(find('avatar-img')))
  assert.equal((find('picture-img')!.props.motion as { animate: { opacity: number } }).animate.opacity, 1)
  await Bun.sleep(300)
  assert.equal(loads.length, 2)
  assert.equal(errors.length, 1)
  assert.equal(avatarFailures, 1)
  console.log('ANIMAL_IMAGE_LIFECYCLE_OK', JSON.stringify({ loads: loads.length, errors: errors.length, avatarFailures, bounds }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally { resetApp() }
process.exit(exitCode)
