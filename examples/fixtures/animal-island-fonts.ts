/** Exercise bundled fonts through the production GPUI text system. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick } from 'vue'
import { createApp, resetApp, useGpuix, type ElementBounds, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'
import { ANIMAL_ISLAND_FONT_FAMILIES, fonts, loadAnimalIslandFonts } from '@gpuiv/animal-island'

const latin = 'WWW Animal'
const chinese = '小岛标题图片加载失败'
const mixed = 'Animal 小岛 🐾 e\u0301'
const rows = [
  { id: 'nunito-500', text: latin, weight: 500, cjk: false },
  { id: 'nunito-700', text: latin, weight: 700, cjk: false },
  { id: 'nunito-900', text: latin, weight: 900, cjk: false },
  { id: 'cjk-fallback', text: chinese, weight: 500, cjk: false },
  { id: 'cjk-direct', text: chinese, weight: 400, cjk: true },
  { id: 'mixed', text: mixed, weight: 500, cjk: false },
] as const

export interface AnimalIslandFontsResult {
  registrations: number
  firstBatchAfterRegistrations: number
  latinWidths: number[]
  bounds: Record<string, ElementBounds>
  selections: Record<string, string>
  mixedCombiningCodePoint: number
  resolvedFallbackFaceExposed: false
}

let registrations = 0
let firstBatchAfterRegistrations = -1
const App = defineComponent({
  setup() {
    const renderer = useGpuix().renderer
    assert(renderer, 'Root setup must receive the actual native renderer')
    const loadFontBytes = renderer.loadFontBytes?.bind(renderer)
    assert(loadFontBytes, 'Production font registration must be available')
    const applyBatch = renderer.applyBatch.bind(renderer)
    renderer.loadFontBytes = (bytes) => {
      assert(bytes.byteLength > 0, 'Register actual bundled font bytes')
      loadFontBytes(bytes)
      registrations++
    }
    renderer.applyBatch = (json) => {
      if (firstBatchAfterRegistrations < 0) {
        firstBatchAfterRegistrations = registrations
        assert.equal(registrations, 6, 'All fonts must register before the first host batch')
      }
      return applyBatch(json)
    }
    loadAnimalIslandFonts(renderer)
    loadAnimalIslandFonts(renderer)
    assert.equal(registrations, 6, 'Repeated registration must be idempotent')
    assert.equal(fonts.sans, ANIMAL_ISLAND_FONT_FAMILIES.sans)
    return () => h('div', {
      style: {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', padding: 24, gap: 12,
      },
    }, rows.map(row => h('text', {
      testId: row.id,
      style: {
        fontFamily: row.cjk ? ANIMAL_ISLAND_FONT_FAMILIES.cjk : fonts.sans,
        fontWeight: row.weight, fontSize: 20, lineHeight: 24,
      },
    }, row.text)))
  },
})

let exitCode = 0
try {
  const app = createApp(App, { width: 680, height: 320, focus: false, show: false })
  const live = app.renderer as typeof app.renderer & LiveAutomationRenderer
  const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
  const bounds = (id: string): ElementBounds => {
    const node = all(app.container).find(candidate => candidate.props.testId === id)
    assert(node?.id, `Missing text host: ${id}`)
    const measured = live.getElementBounds(node.id)
    assert(measured, `No native text bounds for ${id}`)
    assert(Object.values(measured).every(Number.isFinite), `Invalid native bounds for ${id}`)
    assert(measured.width > 0 && measured.width < 632, `Text must fit the fixture: ${id}`)
    assert(measured.height >= 20 && measured.height <= 36, `Invalid line height for ${id}`)
    return measured
  }
  const settle = async () => { await nextTick(); await Bun.sleep(60) }
  const driver = await connectTest(liveRendererAsTest(live), settle)
  await Bun.sleep(350)
  // Automation requests a fresh production frame; bounds then read its
  // painted snapshot instead of assuming the asynchronous UI thread is done.
  live.getAutomationTree()
  assert.equal(firstBatchAfterRegistrations, 6)
  const measured = Object.fromEntries(rows.map(row => [row.id, bounds(row.id)]))
  const latinWidths = ['nunito-500', 'nunito-700', 'nunito-900'].map(id => measured[id]!.width)
  assert(latinWidths[0]! < latinWidths[1]! && latinWidths[1]! < latinWidths[2]!,
    `Nunito weights must use distinct native faces: ${latinWidths.join(', ')}`)
  for (const id of ['cjk-fallback', 'cjk-direct']) {
    assert(measured[id]!.width >= chinese.length * 15 && measured[id]!.width <= chinese.length * 25,
      `Chinese must lay out with full-width glyph advances: ${id}`)
  }
  assert(Math.abs(measured['cjk-fallback']!.width - measured['cjk-direct']!.width) <= chinese.length * 4,
    'Automatic CJK fallback and direct Noto should have comparable full-width advances')
  const mixedCombiningCodePoint = mixed.codePointAt(mixed.length - 1)!
  assert.equal(mixedCombiningCodePoint, 0x0301, 'The mixed string must contain a real combining acute accent')
  // Production windows need not enable the painted-text debug collector.
  // Painted bounds and native pointer selection below provide the evidence.

  const selections: Record<string, string> = {}
  for (const row of rows.filter(row => row.id === 'cjk-fallback' || row.id === 'cjk-direct' || row.id === 'mixed')) {
    live.clearSelection()
    await settle()
    const box = measured[row.id]!
    const y = box.y + box.height / 2
    await driver.mouse.down({ x: box.x + 0.1, y })
    await driver.mouse.move({ x: box.x + box.width + 8, y }, { pressedButton: 0 })
    await driver.mouse.up({ x: box.x + box.width + 8, y })
    assert.equal(live.getSelectedText(), row.text, `Native drag selection must preserve Unicode: ${row.id}`)
    selections[row.id] = live.getSelectedText()!
  }
  // The API exposes shaped bounds and selected text, not resolved per-glyph
  // font faces. Automatic CJK success does not prove it selected bundled Noto.
  const result: AnimalIslandFontsResult = {
    registrations, firstBatchAfterRegistrations, latinWidths, bounds: measured, selections, mixedCombiningCodePoint,
    resolvedFallbackFaceExposed: false,
  }
  console.log('ANIMAL_ISLAND_FONTS_RESULT', JSON.stringify(result))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
