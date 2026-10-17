/** Exercise the gallery's actual "选择目的地" Select with the live renderer. */
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createApp, resetApp, type ElementBounds, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { App } from '../animal-island'

// A visible, nonactivating window receives ordinary native paint frames.
const app = createApp(App, { width: 1120, height: 600, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
const all = (): HostNode[] => walk(app.container)
const near = (actual: number, expected: number, message: string) =>
  assert(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`)
const find = (id: string) => all().find(node => node.props.testId === id)
async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) await Bun.sleep(25)
  assert(condition(), message)
}
async function paintedBounds(id: string): Promise<ElementBounds> {
  let bounds: ElementBounds | null | undefined
  await until(() => {
    const node = find(id)
    bounds = node?.id == null ? null : renderer.getElementBounds(node.id)
    return Boolean(bounds && bounds.width > 0 && bounds.height > 0)
  }, `${id} must have actual painted bounds`)
  return bounds!
}
const textContent = (node: HostNode): string => (node.text ?? '') + node.children.map(textContent).join('')
let exitCode = 0

try {
  const settle = async () => { await nextTick(); await Bun.sleep(180) }
  const driver = await connectTest(liveRendererAsTest(renderer), settle)
  // Query last-painted native bounds while the comparison page settles.
  // Each query observes a GPUI frame; it does not force an extra
  // fresh-frame draw just to find a host whose id is already known.
  const triggerBounds = () => paintedBounds('gallery-select')
  const popupBounds = () => paintedBounds('gallery-select-popup')
  async function open() {
    const bounds = await triggerBounds()
    await driver.mouse.click({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
    await popupBounds()
    await Bun.sleep(250)
  }
  await Bun.sleep(1200)
  const scrollOwners = all().filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === 'scroll')
  assert.equal(scrollOwners.length, 2, 'Navigation and component content must have separate scroll owners')
  for (const owner of scrollOwners) {
    for (let parent = owner.parent; parent; parent = parent.parent) {
      assert(!scrollOwners.includes(parent), 'The comparison layout must not nest its scroll owners')
    }
  }
  const navScrollId = find('gallery-nav-scroll')!.id!
  const scrollId = find('gallery-scroll')!.id!
  assert(scrollOwners.some(node => node.id === navScrollId) && scrollOwners.some(node => node.id === scrollId))
  assert(!find('gallery-select'), 'The initial Button comparison page must not mount the Select demo')
  // Select is near the bottom of the reference navigation. Scroll the actual
  // sidebar before clicking its painted label, rather than dispatching to a
  // clipped retained host or depending on generic flex tracker offsets.
  find('nav-select')!.scrollIntoView?.()
  await Bun.sleep(250)
  for (let attempt = 0; attempt < 5; attempt++) {
    const nav = find('nav-select')!
    const labelNode = walk(nav).find(node => node.type === 'text' && textContent(node).includes('Select'))
    assert(labelNode?.id != null, 'The Select navigation label must exist')
    const label = renderer.getElementBounds(labelNode.id)!
    const owner = await paintedBounds('gallery-nav-scroll')
    const offset = renderer.getScrollOffset(navScrollId)![1]!
    const top = owner.y - offset
    if (label.y >= top + 8 && label.y + label.height <= top + owner.height - 8) break
    renderer.scrollTo(navScrollId, 0, offset + top + 80 - label.y)
    await Bun.sleep(250)
  }
  const navLabelNode = walk(find('nav-select')!).find(node => node.type === 'text' && textContent(node).includes('Select'))!
  const navLabel = renderer.getElementBounds(navLabelNode.id!)!
  const navOwner = await paintedBounds('gallery-nav-scroll')
  const navOffset = renderer.getScrollOffset(navScrollId)![1]!
  assert(navLabel.y >= navOwner.y - navOffset && navLabel.y + navLabel.height <= navOwner.y - navOffset + navOwner.height,
    'The Select navigation label must be inside the sidebar viewport before clicking')
  await driver.mouse.click({ x: navLabel.x + navLabel.width / 2, y: navLabel.y + navLabel.height / 2 })
  await until(() => Boolean(find('gallery-select')), 'Clicking the sidebar must mount the real Select comparison page')
  await paintedBounds('gallery-showcase')
  assert.equal((find('gallery-showcase')!.props.style as { backgroundColor?: string }).backgroundColor, '#ffffff',
    'The Select demo must use the white comparison showcase')
  near(renderer.getScrollOffset(scrollId)![1]!, 0, 'Navigation must reset the component pane to its top')
  const positioned = await triggerBounds()
  assert(textContent(find('gallery-select')!).includes('选择目的地'), 'The untouched gallery Select must show its placeholder')
  await open()

  async function snapshot(label: string) {
    const value = { label, trigger: await triggerBounds(), popup: await popupBounds(), offset: renderer.getScrollOffset(scrollId)! }
    console.log('GALLERY_SELECT_POPUP_BOUNDS', JSON.stringify(value))
    assert(value.popup.width > 0 && value.popup.height > 0, `${label}: popup must be painted`)
    near(value.popup.x, value.trigger.x, `${label}: popup left must align with trigger left`)
    near(value.popup.y, value.trigger.y + value.trigger.height + 8, `${label}: popup top must be 8px below trigger`)
    return value
  }

  const initial = await snapshot('initial')
  renderer.scrollTo(scrollId, 0, initial.offset[1]! - 40)
  await Bun.sleep(350)
  const scrolled = await snapshot('scrolled')
  near(scrolled.offset[1]!, initial.offset[1]! - 40, 'The gallery scroll owner must actually scroll')
  near(scrolled.trigger.y, initial.trigger.y - 40, 'The painted trigger must move with the gallery scroll')
  const blankClicks: Array<{ key: string; side: 'left' | 'right'; point: { x: number; y: number }; row: ElementBounds; text: ElementBounds; label: string }> = []
  async function selectFromBlankPadding(key: string, side: 'left' | 'right', expected: string) {
    const row = await paintedBounds(`gallery-select-option-${key}`)
    const option = find(`gallery-select-option-${key}`)!
    const textNode = walk(option).find(node => node.type === 'text' && textContent(node) === expected)
    assert(textNode?.id != null && option.children.length > 0, 'The actual option label must be painted')
    const text = renderer.getElementBounds(textNode.id)!
    const panel = await popupBounds()
    // An embedded canvas tracker in a centered/padded flex div can have a
    // static-position offset. Its row dimensions remain reliable, but use
    // the popup outer edges and painted text's center for pointer placement.
    near(row.width, panel.width, 'The option must span the popup width')
    const point = { x: side === 'left' ? panel.x + 4 : panel.x + panel.width - 4, y: text.y + text.height / 2 }
    console.log('GALLERY_SELECT_BLANK_CLICK', JSON.stringify({ key, side, row, panel, text, point }))
    assert(point.x > panel.x && point.x < panel.x + panel.width && point.y > panel.y && point.y < panel.y + panel.height, 'The blank-row click must remain inside the actual popup')
    assert(!(point.x >= text.x && point.x <= text.x + text.width && point.y >= text.y && point.y <= text.y + text.height), 'The click must hit blank row padding, not its label')
    await driver.mouse.click(point)
    await until(() => !find('gallery-select-popup'), 'Choosing from blank padding must close the gallery popup')
    const label = textContent(find('gallery-select')!)
    console.log('GALLERY_SELECT_BLANK_RESULT', JSON.stringify({ key, label, nativeText: renderer.getAllText().filter(value => ['小岛', '森林', '海滩', '选择目的地'].includes(value)) }))
    assert(label.includes(expected) && !label.includes('选择目的地'), `The actual gallery trigger must display ${expected}`)
    assert(renderer.getAllText().includes(expected), 'The selected label must also reach the native retained tree')
    blankClicks.push({ key, side, point, row, text, label })
    return label
  }
  const label = await selectFromBlankPadding('forest', 'left', '森林')
  // Last and first rows also retain their full hitbox after their rectangular
  // fills are removed. Their labels and decorations must not own the click.
  for (const [key, side, expected] of [['beach', 'right', '海滩'], ['island', 'left', '小岛']] as const) {
    await open()
    await selectFromBlankPadding(key, side, expected)
  }
  console.log('GALLERY_SELECT_POPUP_RESULT', JSON.stringify({ positioned, initial, scrolled, selectedLabel: label, blankClicks, menuClosed: true, scrollOwners: scrollOwners.length, selectedPage: 'select', nestedScrolling: false }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
