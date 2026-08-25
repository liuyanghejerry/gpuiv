/**
 * Visual tests for the Waku-style chat example (Vue).
 *
 * Renders the real app through the GPU test renderer and captures screenshots
 * into `examples/screenshots/`, so the layout can be inspected after a run.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, createTestApp, hasNativeTestRenderer, resetApp, TestRenderer } from '@gpuiv/vue'
import { connectTest } from '@gpuiv/vue/automation'
import { ChatApp, SafeMdxTranscript } from './chat'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true })
})

describeNative('chat example (vue)', () => {
  it('renders safe-mdx through GPUIX Vue primitives', () => {
    const app = createTestApp(SafeMdxTranscript)

    const screenshot = path.join(SHOTS, 'chat-safe-mdx.png')
    app.renderer.captureScreenshot(screenshot)

    expect(app.renderer.findByType('markdown')).toHaveLength(0)
    expect(app.renderer.findByType('code')).toHaveLength(1)
    expect(fs.statSync(screenshot).size).toBeGreaterThan(0)
    const painted = app.renderer.getPaintedText()
    expect(painted.join('\n')).toContain('React-composed Markdown')
    expect(painted.join('\n')).toContain('safe-mdx')
    expect(painted.join('\n')).toContain('Path')
    expect(painted.join('\n')).toContain('const tree = mdxParse(source)')
    expect(painted.join('\n')).toContain('Custom MDX component')
    app.unmount()
  })

  it('renders the sidebar, transcript and composer', async () => {
    const app = createTestApp(ChatApp)

    const transcript = app.renderer.findByType('virtual-list')[0]
    expect(transcript).toBeDefined()
    expect(
      transcript.children.map((id) => app.renderer.getElement(id)?.style.width)
    ).toEqual(Array(transcript.children.length).fill(1))

    const painted = app.renderer.getPaintedText()

    expect(painted).toContain('New Task')
    expect(painted).toContain('Search')
    expect(painted).toContain('Yesterday')
    expect(painted).toContain('give me a quick overview')
    expect(painted).toContain('Do anything...')
    const icons = app.renderer.findByType('svg')
    expect(icons.length).toBeGreaterThan(8)
    expect(
      icons.every((icon) => String(icon.customProps?.src ?? '').includes('svg'))
    ).toBe(true)

    expect(painted).toContain('DeepSeek V4 Flash')
    expect(painted).toContain('Local')
    expect(painted.some((line) => line.includes('control plane for local coding agents'))).toBe(
      true
    )
    expect(app.renderer.findByType('markdown').length).toBeGreaterThan(0)
    app.unmount()
  })

  it('scrolls the transcript past the first turn', async () => {
    const app = createTestApp(ChatApp)

    expect(app.renderer.getPaintedText()).not.toContain('Do I get hot reload')

    const transcript = app.renderer.findByType('virtual-list')[0]
    app.renderer.nativeSimulateScrollWheel(700, 400, 0, -1400)
    app.renderer.scrollToItem(transcript.id, 23)
    await app.settle()

    expect(app.renderer.getPaintedText()).toContain('Which models should I wire up?')
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('control plane for local coding agents'))
    ).toBe(false)
    app.unmount()
  })

  it('selects message text but never sidebar titles', () => {
    const app = createTestApp(ChatApp)

    expect(app.renderer.dragSelect(30, 300, 240, 320)).toBeNull()

    const selected = app.renderer.dragSelect(980, 86, 1110, 86)
    expect(selected).not.toBeNull()
    expect(selected).not.toContain('Native SDK vs GPUI comparison')
    app.unmount()
  })

  it('opens the model picker and changes the selected model', async () => {
    const app = createTestApp(ChatApp)

    expect(app.renderer.getPaintedText()).toContain('DeepSeek V4 Flash')
    expect(app.renderer.getPaintedText()).not.toContain('Claude Opus 4.6')

    app.renderer.nativeSimulateClick(480, 724)
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('Claude Opus 4.6')

    const shot = path.join(SHOTS, 'chat-model-picker.png')
    app.renderer.captureScreenshot(shot)
    expect(fs.statSync(shot).size).toBeGreaterThan(0)
    app.unmount()
  })

  it('types into the composer and clears on enter', async () => {
    const app = createTestApp(ChatApp)

    const textarea = app.renderer.findByType('textarea')[0]
    expect(textarea).toBeDefined()
    app.renderer.nativeSimulateKeystrokes(textarea.id, 'h e l l o')
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('hello')

    app.renderer.nativeSimulateKeystrokes(textarea.id, 'enter')
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('Do anything...')

    const transcript = app.renderer.findByType('virtual-list')[0]
    app.renderer.scrollToItem(transcript.id, 24)
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('hello')
    app.unmount()
  })

  it('stays painted after createApp remounts the tree', async () => {
    resetApp()
    const renderer = new TestRenderer()
    const before = path.join(SHOTS, 'chat-remount-before.png')
    const after = path.join(SHOTS, 'chat-remount-after.png')

    createApp(ChatApp, { renderer, width: 1180, height: 820 })
    renderer.flush()
    renderer.captureScreenshot(before)
    expect(renderer.getPaintedText()).toContain('New Task')
    expect(renderer.getPaintedText()).toContain('give me a quick overview')

    createApp(ChatApp, { renderer, width: 1180, height: 820 })
    renderer.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    renderer.flush()
    renderer.captureScreenshot(after)

    expect(renderer.getRoot()).toBeDefined()
    expect(renderer.getPaintedText()).toContain('New Task')
    expect(renderer.getPaintedText()).toContain('give me a quick overview')
    expect(
      renderer.getPaintedText().some((line) => line.includes('control plane for local coding agents'))
    ).toBe(true)
    expect(fs.statSync(after).size).toBeGreaterThan(0)
  }, 20_000)

  it('keeps transcript row ids when the sidebar collapses', async () => {
    const app = createTestApp(ChatApp)
    const before = app.renderer.findByType('virtual-list')[0]?.children.slice() ?? []
    expect(before.length).toBeGreaterThan(0)
    expect(before.length).toBeLessThan(80)

    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId('sidebar-collapse').click()

    expect(app.renderer.findByType('virtual-list')[0]?.children).toEqual(before)
    expect(await automation.getByTestId('sidebar-expand').count()).toBe(1)
    app.unmount()
  })

  it('captures deterministic sidebar motion frames', async () => {
    const top = path.join(SHOTS, 'chat-top.png')
    const transitioning = path.join(SHOTS, 'chat-sidebar-transition.png')
    const collapsed = path.join(SHOTS, 'chat-sidebar-collapsed.png')

    const app = createTestApp(ChatApp)
    app.renderer.captureScreenshot(top)

    const automation = await connectTest(app.renderer, app.settle)
    const startedAt = await automation.clock.pause()
    await automation.getByTestId('sidebar-collapse').click()
    await automation.clock.set(startedAt + 100)
    await automation.screenshot({ path: transitioning })
    await automation.clock.set(startedAt + 200)
    await automation.screenshot({ path: collapsed })
    await automation.clock.resume()

    for (const shot of [top, transitioning, collapsed]) {
      expect(fs.existsSync(shot)).toBe(true)
      expect(fs.statSync(shot).size).toBeGreaterThan(0)
    }
    app.unmount()
  }, 15_000)
})
