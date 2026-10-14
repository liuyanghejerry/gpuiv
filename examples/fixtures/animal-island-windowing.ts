/** Real native comparison layout, navigation, isolation, and scroll ownership. */
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { createApp, resetApp, type ElementBounds, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { App } from '../animal-island'

const app = createApp(App, { width: 1120, height: 820, focus: false, show: false })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
const all = (): HostNode[] => walk(app.container)
const find = (id: string) => all().find(node => node.props.testId === id)
const textContent = (node: HostNode): string => (node.text ?? '') + node.children.map(textContent).join('')
const near = (actual: number, expected: number, message: string) => assert(Math.abs(actual - expected) < 1, `${message}: ${actual} != ${expected}`)
async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 4000
  while (!condition() && Date.now() < deadline) await Bun.sleep(25)
  assert(condition(), message)
}
async function nodeBounds(node: HostNode): Promise<ElementBounds> {
  let value: ElementBounds | null | undefined
  await until(() => {
    value = node.id == null ? null : renderer.getElementBounds(node.id)
    return Boolean(value && value.width > 0 && value.height > 0)
  }, `${node.props.testId ?? node.type} must have painted native bounds`)
  return value!
}
const bounds = (id: string) => nodeBounds(find(id)!)
let exitCode = 0

try {
  const settle = async () => { await nextTick(); await Bun.sleep(120) }
  const driver = await connectTest(liveRendererAsTest(renderer), settle)
  await Bun.sleep(450)
  const scrollId = find('gallery-scroll')!.id!
  const navScrollId = find('gallery-nav-scroll')!.id!
  async function choose(id: string) {
    const nav = find(`nav-${id}`)!
    assert(nav, `${id} must be available in the navigation`)
    const label = walk(nav).find(node => node.type === 'text' && textContent(node))!
    let box = await nodeBounds(label)
    // Scroll this sibling viewport only. A native canvas tracker in a padded
    // row can have a static offset; use the actual painted text for clicks.
    const offset = renderer.getScrollOffset(navScrollId)![1]!
    renderer.scrollTo(navScrollId, 0, offset + 220 - box.y)
    await settle()
    box = await nodeBounds(label)
    assert(box.y >= 0 && box.y + box.height < renderer.getWindowSize!().height, `nav-${id} must become visible before clicking`)
    await driver.mouse.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await until(() => find('gallery-showcase')?.props['aria-label'] === `${textContent(nav)}展示`, `The real nav click must select ${id}`)
    await settle()
    near(renderer.getScrollOffset(scrollId)![1]!, 0, 'A page switch resets the content scroll')
    return renderer.getScrollOffset(navScrollId)![1]!
  }
  async function snapshot(label: string) {
    const root = await bounds('gallery-root')
    const sidebar = await bounds('gallery-sidebar')
    const scroll = await bounds('gallery-scroll')
    const showcase = await bounds('gallery-showcase')
    const rightOffset = renderer.getScrollOffset(scrollId)!
    const owners = all().filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === 'scroll')
    assert.deepEqual(owners.map(node => node.props.testId).sort(), ['gallery-nav-scroll', 'gallery-scroll'])
    for (const owner of owners) assert.equal(walk(owner).slice(1).filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === 'scroll').length, 0, 'The two scroll owners must be siblings, never nested')
    near(sidebar.width, 220, 'Sidebar uses the reference 220px width')
    near(showcase.width, root.width - 312, 'The white card fills the reference main-column width')
    near(scroll.height, root.height, 'The content viewport reaches the window bottom')
    assert(showcase.width > 400 && showcase.height >= 520, 'The chosen component needs a large example card')
    assert(['#fff', '#ffffff'].includes((find('gallery-showcase')!.props.style as { backgroundColor: string }).backgroundColor), 'The example card must have a white fill')
    const value = { label, root, sidebar, scroll, showcase, rightOffset, page: find('gallery-showcase')!.props['aria-label'], nodes: all().length }
    console.log('COMPARISON_GALLERY_BOUNDS', JSON.stringify(value))
    return value
  }

  const initial = await snapshot('button')
  assert(find('btn-default') && !find('animal-table'), 'Only the default Button example is mounted')
  const navEntries = all().filter(node => String(node.props.testId).startsWith('nav-'))
  assert.equal(navEntries.length, 39, 'Every original component family must have a navigation entry')

  await choose('icon')
  assert(!find('btn-default') && textContent(find('gallery-showcase')!).includes('Airplane'), 'Switching mounts Icon and removes Button')
  renderer.scrollTo(scrollId, 0, -240)
  await settle()
  const iconOffset = renderer.getScrollOffset(scrollId)![1]!
  assert(iconOffset < -100, 'The long Icon page must really scroll')
  const sidebarBefore = await bounds('gallery-sidebar')
  const navigatedOffset = await choose('back-top')
  assert(!textContent(find('gallery-showcase')!).includes('Airplane'), 'Switching unmounts the Icon page')
  const sidebarAfter = await bounds('gallery-sidebar')
  near(sidebarAfter.width, sidebarBefore.width, 'Content navigation preserves the sidebar width')
  renderer.scrollTo(scrollId, 0, -600)
  await settle()
  assert(renderer.getScrollOffset(scrollId)![1]! < -500, 'The BackTop page provides a real scroll region')
  near(renderer.getScrollOffset(navScrollId)![1]!, navigatedOffset, 'Content scrolling must not scroll the sidebar')
  const longPage = await snapshot('back-top-scrolled')
  await choose('button')
  const returned = await snapshot('button-returned')
  assert(find('btn-default') && !find('animal-table'), 'Returning remounts the selected example')
  near(returned.showcase.width, initial.showcase.width, 'Returning preserves the white card width')

  renderer.resizeWindow!(840, 640)
  await until(() => renderer.getWindowSize!().width === 840 && renderer.getWindowSize!().height === 640, 'The native window must resize')
  await settle()
  const resized = await snapshot('resized')
  near(resized.root.width, 840, 'Root width follows window resize')
  near(resized.root.height, 640, 'Root height follows window resize')
  near(resized.showcase.width, initial.showcase.width - 280, 'The example card fills the remaining main-column width')

  await choose('input')
  const controlled = all().find(node => node.type === 'input' && node.props.placeholder === '说点什么…')!
  assert(controlled?.id != null)
  await driver.call('keystrokes', { elementId: controlled.id, keys: 'C o m p a r e' })
  assert.equal(controlled.props.value, 'Compare', 'Real input edits must update the controlled model')
  await choose('button')
  await choose('input')
  const returnedInput = all().find(node => node.type === 'input' && node.props.placeholder === '说点什么…')!
  assert.equal(returnedInput.props.value, 'Compare', 'The controlled model survives page remounting')

  console.log('COMPARISON_GALLERY_OK', JSON.stringify({ pages: navEntries.length, scrollOwners: 2, initial, longPage, returned, resized, retainedInput: returnedInput.props.value }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally { resetApp() }
process.exit(exitCode)
