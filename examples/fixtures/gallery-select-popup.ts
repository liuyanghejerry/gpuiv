/** Exercise the gallery's actual "选择目的地" Select with the live renderer. */
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createApp, resetApp, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { App } from '../animal-island'

const app = createApp(App, { width: 1120, height: 820, focus: false, show: false })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const all = (): HostNode[] => {
  const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
  return walk(app.container)
}
const near = (actual: number, expected: number, message: string) =>
  assert(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`)
let exitCode = 0

try {
  const settle = async () => { await nextTick(); await Bun.sleep(180) }
  const driver = await connectTest(liveRendererAsTest(renderer), settle)
  const trigger = driver.getByTestId('gallery-select')
  const popup = driver.getByTestId('gallery-select-popup')
  const scrollId = (await driver.getByTestId('gallery-scroll').element()).id
  // Let the real gallery measure its sections and replace distant bodies
  // with placeholders before navigating to the form section.
  await Bun.sleep(1400)
  assert.equal(all().filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === 'scroll').length, 1)
  const section = all().find(node => node.props['aria-label'] === '表单')
  assert(section?.props.testId, 'The actual gallery form section must exist')
  const sectionBounds = await driver.getByTestId(String(section.props.testId)).bounds()
  const firstOffset = renderer.getScrollOffset(scrollId)![1]!
  renderer.scrollTo(scrollId, 0, firstOffset + 180 - sectionBounds.y)
  await Bun.sleep(700)
  await trigger.waitFor()

  // Derive the destination from painted bounds and the current real offset;
  // section heights and bundled fonts may change as the gallery evolves.
  const targetY = 480
  for (let attempt = 0; attempt < 5; attempt++) {
    const bounds = await trigger.bounds()
    if (Math.abs(bounds.y - targetY) < 1) break
    const offset = renderer.getScrollOffset(scrollId)![1]!
    renderer.scrollTo(scrollId, 0, offset + targetY - bounds.y)
    await Bun.sleep(500)
    await trigger.waitFor()
  }
  const positioned = await trigger.bounds()
  near(positioned.y, targetY, 'Position the actual trigger with enough space above')
  assert((await trigger.textContent()).includes('选择目的地'), 'The untouched gallery Select must show its placeholder')
  await trigger.click()
  await popup.waitFor()
  await Bun.sleep(250)

  async function snapshot(label: string) {
    const value = { label, trigger: await trigger.bounds(), popup: await popup.bounds(), offset: renderer.getScrollOffset(scrollId)! }
    console.log('GALLERY_SELECT_POPUP_BOUNDS', JSON.stringify(value))
    assert(value.popup.width > 0 && value.popup.height > 0, `${label}: popup must be painted`)
    near(value.popup.x, value.trigger.x, `${label}: popup left must align with trigger left`)
    near(value.popup.y + value.popup.height, value.trigger.y - 8, `${label}: popup bottom must be 8px above trigger`)
    return value
  }

  const initial = await snapshot('initial')
  renderer.scrollTo(scrollId, 0, initial.offset[1]! - 40)
  await Bun.sleep(350)
  const scrolled = await snapshot('scrolled')
  near(scrolled.offset[1]!, initial.offset[1]! - 40, 'The gallery scroll owner must actually scroll')
  near(scrolled.trigger.y, initial.trigger.y - 40, 'The painted trigger must move with the gallery scroll')
  await driver.getByTestId('gallery-select-option-forest').click()
  const closeDeadline = Date.now() + 5000
  while (await popup.count() && Date.now() < closeDeadline) await Bun.sleep(25)
  assert.equal(await popup.count(), 0, 'Choosing a destination must close the gallery popup')
  const label = await trigger.textContent()
  assert(label.includes('森林') && !label.includes('选择目的地'), 'The actual gallery trigger must display 森林')
  console.log('GALLERY_SELECT_POPUP_RESULT', JSON.stringify({ positioned, initial, scrolled, selectedLabel: label, menuClosed: true, scrollOwners: 1 }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
