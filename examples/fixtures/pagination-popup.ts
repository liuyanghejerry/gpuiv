/** Check Animal Pagination's popup against real GPUI window-space bounds. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick } from 'vue'
import { createApp, resetApp, type ElementBounds } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { Pagination } from '@gpuiv/animal-island'

const changes: number[][] = []
const sizeChanges: number[][] = []
const App = defineComponent(() => () => h('div', {
  style: { width: '100%', height: '100%' },
}, h('div', {
  testId: 'scroll-owner',
  style: { width: '100%', height: '100%', overflow: 'scroll' },
}, h('div', {
  style: { width: '100%', height: 1400, paddingLeft: 40, paddingTop: 380 },
}, h(Pagination, {
  testId: 'pager', total: 80, showSizeChanger: true,
  onChange: (page: number, size: number) => changes.push([page, size]),
  onShowSizeChange: (page: number, size: number) => sizeChanges.push([page, size]),
})))))

const app = createApp(App, { width: 760, height: 600, focus: false, show: false })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const near = (actual: number, expected: number, message: string) =>
  assert(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`)
type Snapshot = { label: string; trigger: ElementBounds; popup: ElementBounds; offset: number[] }
let exitCode = 0

try {
  const settle = async () => { await nextTick(); await Bun.sleep(80) }
  const driver = await connectTest(liveRendererAsTest(renderer), settle)
  const trigger = driver.getByTestId('pager-size-changer')
  const popup = driver.getByTestId('pager-size-changer-popup')
  const scrollId = (await driver.getByTestId('scroll-owner').element()).id
  await Bun.sleep(350)
  console.log('PAGINATION_POPUP_CLOSED', JSON.stringify({ trigger: await trigger.bounds(), offset: renderer.getScrollOffset(scrollId) }))
  await trigger.click()
  await popup.waitFor()
  await Bun.sleep(250)

  async function snapshot(label: string, aligned = true): Promise<Snapshot> {
    const value = { label, trigger: await trigger.bounds(), popup: await popup.bounds(), offset: renderer.getScrollOffset(scrollId)! }
    console.log('PAGINATION_POPUP_BOUNDS', JSON.stringify(value))
    assert(value.popup.width > 0 && value.popup.height > 0, `${label}: popup must be painted`)
    if (aligned) {
      near(value.popup.y + value.popup.height, value.trigger.y - 8, `${label}: popup bottom must be 8px above trigger`)
      near(value.popup.x, value.trigger.x, `${label}: popup and trigger left edges must align`)
    }
    return value
  }

  const initial = await snapshot('initial')
  const scrolling: Snapshot[] = []
  for (const offset of [-45, -90]) {
    renderer.scrollTo(scrollId, 0, offset)
    await settle()
    const value = await snapshot(`scroll-${-offset}`)
    // Opening Select focuses its highlighted item. If GPUI scrolls that
    // focus into view, compare subsequent motion with the observed origin.
    near(value.trigger.y, initial.trigger.y + offset - initial.offset[1]!, 'The scroll must actually move the trigger')
    assert(Math.abs(value.trigger.y - initial.trigger.y) > 1, 'The scroll assertion must observe actual trigger motion')
    near(renderer.getScrollOffset(scrollId)![1]!, offset, 'The sole scroll owner must retain the requested offset')
    scrolling.push(value)
  }

  renderer.resizeWindow!(820, 640)
  const resizeDeadline = Date.now() + 5000
  while (Date.now() < resizeDeadline) {
    const size = renderer.getWindowSize!()
    if (Math.abs(size.width - 820) < 1 && Math.abs(size.height - 640) < 1) break
    await Bun.sleep(25)
  }
  const size = renderer.getWindowSize!()
  near(size.width, 820, 'Resize must change the real viewport width')
  near(size.height, 640, 'Resize must change the real viewport height')
  await settle()
  const resized = await snapshot('resized')

  // Near the viewport top, GPUI may snap the requested top placement. It
  // must keep the deferred popup within the window, then restore alignment
  // when the trigger has enough space above it again.
  renderer.scrollTo(scrollId, 0, -350)
  await settle()
  const fitted = await snapshot('viewport-fit', false)
  assert(fitted.popup.x >= -1 && fitted.popup.y >= -1, 'Viewport fitting must keep the popup top/left inside the window')
  assert(fitted.popup.x + fitted.popup.width <= size.width + 1, 'Viewport fitting must keep the popup right inside the window')
  assert(fitted.popup.y + fitted.popup.height <= size.height + 1, 'Viewport fitting must keep the popup bottom inside the window')
  renderer.scrollTo(scrollId, 0, -90)
  await settle()
  const restored = await snapshot('restored')

  await driver.getByTestId('pager-size-changer-option-20').click()
  const closeDeadline = Date.now() + 5000
  while (await popup.count() && Date.now() < closeDeadline) await Bun.sleep(25)
  assert.equal(await popup.count(), 0, 'Selecting a size must close the popup')
  assert.deepEqual(sizeChanges, [[1, 20]], 'Native option click must emit one size-change callback')
  assert.deepEqual(changes, [[1, 20]], 'Native option click must emit one Pagination change callback')
  assert((await trigger.textContent()).includes('20 条/页'), 'The closed trigger must show the selected size')
  console.log('PAGINATION_POPUP_RESULT', JSON.stringify({ initial, scrolling, resized, fitted, restored, changes, sizeChanges, menuClosed: true }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
