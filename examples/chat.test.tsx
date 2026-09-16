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
import { connectTest, launch } from '@gpuiv/vue/automation'
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

    // Click the painted trigger center: composer layout depends on text
    // metrics, so fixed window coordinates miss on other machines.
    const trigger = app.renderer.findByTestId('model-picker-trigger')
    expect(trigger).toBeDefined()
    const bounds = app.renderer.getElementBounds(trigger!.id)
    expect(bounds).not.toBeNull()
    app.renderer.nativeSimulateClick(
      bounds!.x! + bounds!.width! / 2,
      bounds!.y! + bounds!.height! / 2
    )
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('Claude Opus 4.6')

    const shot = path.join(SHOTS, 'chat-model-picker.png')
    app.renderer.captureScreenshot(shot)
    expect(fs.statSync(shot).size).toBeGreaterThan(0)
    app.unmount()
  })

  it('selects a model by clicking its row', async () => {
    const app = createTestApp(ChatApp)

    const trigger = app.renderer.findByTestId('model-picker-trigger')
    expect(trigger).toBeDefined()
    const triggerBounds = app.renderer.getElementBounds(trigger!.id)
    app.renderer.nativeSimulateClick(
      triggerBounds!.x! + triggerBounds!.width! / 2,
      triggerBounds!.y! + triggerBounds!.height! / 2
    )
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('Claude Opus 4.6')

    // GPUI paints a flat hit list and does not bubble clicks: a filled row
    // inside SelectItem used to cover the item's hitbox and swallow the pick.
    // The fill now lives on the item and the row is pointer-transparent.
    const row = app.renderer.findByTestId('model-opus-4.6')
    expect(row).toBeDefined()
    const rowBounds = app.renderer.getElementBounds(row!.id)
    expect(rowBounds).not.toBeNull()
    app.renderer.nativeSimulateClick(
      rowBounds!.x! + rowBounds!.width! / 2,
      rowBounds!.y! + rowBounds!.height! / 2
    )
    await app.settle()

    // The pick ran: popup closed, the trigger now shows the picked model.
    const painted = app.renderer.getPaintedText()
    expect(painted).not.toContain('DeepSeek V4 Flash')
    expect(painted).toContain('Claude Opus 4.6')
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

    // The send appends the user turn and a demo reply, and the list scrolls
    // to the tail. The new visible range dispatches at flush end, so the
    // freshly scrolled rows paint on the next settle.
    await app.settle()
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('This is the GPUIV chat demo'))
    ).toBe(true)

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

  it('switches the active conversation from the sidebar', async () => {
    const app = createTestApp(ChatApp)

    // The row div owns at fontSize 13.5 the title text; the header title is
    // fontSize 13, so the two occurrences of a title are distinguishable.
    // A string child lives in its own `#text` instance; the style sits on
    // the host `<text>` above it, the row div above that.
    const titledText = (title: string, fontSize: number) => {
      for (const el of app.renderer.findByType('text')) {
        if (el.text !== title) continue
        const host = app.renderer.getElement(el.parentId!)
        if (host?.style.fontSize === fontSize) return host
      }
      return undefined
    }
    const rowOf = (title: string) => {
      const host = titledText(title, 13.5)
      return host ? app.renderer.getElement(host.parentId!) : undefined
    }
    const headerTitle = () => titledText('Native SDK vs GPUI comparison', 13)

    // c1 starts active: its row carries the C.item fill, the header shows its title.
    const c1Row = rowOf('give me a quick overview')
    expect(c1Row).toBeDefined()
    const activeFill = c1Row!.style.backgroundColor
    expect(activeFill).toBeDefined()
    expect(activeFill).not.toBe('#00000000')
    expect(headerTitle()).toBeUndefined()

    // Click the c2 row through the row div's own hitbox while it is
    // transparent. Use the recorded corner: before the bounds-origin fix the
    // recorded box was the content box, so a corner click landed outside the
    // real hitbox and was silently lost.
    const c2Row = rowOf('Native SDK vs GPUI comparison')
    const bounds = app.renderer.getElementBounds(c2Row!.id)
    expect(bounds).not.toBeNull()
    app.renderer.nativeSimulateClick(bounds!.x! + 3, bounds!.y! + bounds!.height! - 3)
    await app.settle()

    // The highlight moves to c2, c1 loses it, and the header follows.
    expect(rowOf('Native SDK vs GPUI comparison')!.style.backgroundColor).toBe(activeFill)
    expect(rowOf('give me a quick overview')!.style.backgroundColor).not.toBe(activeFill)
    expect(headerTitle()).toBeDefined()

    // The transcript itself follows: c2's reply paints, c1's corpus is gone.
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('GPUI is the renderer'))
    ).toBe(true)
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('control plane for local coding agents'))
    ).toBe(false)

    // Clicking back to c1 restores the original state, and c2's thread is
    // gone from the paint. c1 opens at its tail, so the last corpus rows
    // show after the scrolled window repaints on the second settle.
    const c1Title = titledText('give me a quick overview', 13.5)
    const c1Bounds = app.renderer.getElementBounds(c1Title!.id)
    app.renderer.nativeSimulateClick(
      c1Bounds!.x! + c1Bounds!.width! / 2,
      c1Bounds!.y! + c1Bounds!.height! / 2,
    )
    await app.settle()
    await app.settle()
    expect(rowOf('give me a quick overview')!.style.backgroundColor).toBe(activeFill)
    expect(rowOf('Native SDK vs GPUI comparison')!.style.backgroundColor).not.toBe(activeFill)
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('GPUI is the renderer'))
    ).toBe(false)
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('GPT-5.4'))
    ).toBe(true)
    app.unmount()
  })

  /** Click a painted element's center by testId, then settle. */
  async function clickTestId(app: ReturnType<typeof createTestApp>, testId: string) {
    const el = app.renderer.findByTestId(testId)
    expect(el, `missing testId: ${testId}`).toBeDefined()
    const bounds = app.renderer.getElementBounds(el!.id)
    expect(bounds).not.toBeNull()
    app.renderer.nativeSimulateClick(
      bounds!.x! + bounds!.width! / 2,
      bounds!.y! + bounds!.height! / 2,
    )
    await app.settle()
  }

  it('starts a blank task from the sidebar compose action', async () => {
    const app = createTestApp(ChatApp)
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('control plane for local coding agents'))
    ).toBe(true)

    await clickTestId(app, 'new-task')
    // A blank thread: c1's corpus is gone, the placeholder title shows.
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('control plane for local coding agents'))
    ).toBe(false)
    expect(app.renderer.getPaintedText()).toContain('New task')

    // The first send names the thread from the draft and paints a demo reply.
    const textarea = app.renderer.findByType('textarea')[0]
    app.renderer.nativeSimulateKeystrokes(textarea.id, 'f i x space t h e space g u t t e r')
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(textarea.id, 'enter')
    await app.settle()
    // The tail scroll's visible range dispatches at flush end; the new rows
    // paint on the next settle.
    await app.settle()
    expect(app.renderer.getPaintedText()).toContain('fix the gutter')
    expect(
      app.renderer.getPaintedText().some((line) => line.includes('This is the GPUIV chat demo'))
    ).toBe(true)
    app.unmount()
  })

  it('rebuilds the last demo reply from retry', async () => {
    const app = createTestApp(ChatApp)
    const textarea = app.renderer.findByType('textarea')[0]
    app.renderer.nativeSimulateKeystrokes(textarea.id, 'h e l l o')
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(textarea.id, 'enter')
    await app.settle()
    // Tail scroll: the new rows paint on the second settle.
    await app.settle()
    const replies = () =>
      app.renderer.getPaintedText().filter((line) => line.includes('This is the GPUIV chat demo'))
    expect(replies().length).toBe(1)

    await clickTestId(app, 'retry')
    // Rebuilt in place: still exactly one reply, no duplicated user turn.
    expect(replies().length).toBe(1)
    expect(app.renderer.getPaintedText().filter((line) => line === 'hello').length).toBe(1)
    app.unmount()
  })

  it('toggles the inspector from the header', async () => {
    const app = createTestApp(ChatApp)
    expect(app.renderer.findByTestId('inspector')).toBeUndefined()

    await clickTestId(app, 'inspector-toggle')
    expect(app.renderer.findByTestId('inspector')).toBeDefined()
    const painted = app.renderer.getPaintedText()
    expect(painted).toContain('Inspector')
    expect(painted).toContain('DeepSeek V4 Flash')
    expect(painted).toContain('Full access')

    await clickTestId(app, 'inspector-toggle')
    expect(app.renderer.findByTestId('inspector')).toBeUndefined()
    app.unmount()
  })

  it('walks thread history with the sidebar arrows', async () => {
    const app = createTestApp(ChatApp)
    const paints = (needle: string) =>
      app.renderer.getPaintedText().some((line) => line.includes(needle))

    await clickTestId(app, 'thread-c2')
    await clickTestId(app, 'thread-c3')
    expect(paints('scriptc is a Vercel Labs experiment')).toBe(true)

    await clickTestId(app, 'history-back')
    expect(paints('GPUI is the renderer')).toBe(true)
    expect(paints('scriptc is a Vercel Labs experiment')).toBe(false)

    await clickTestId(app, 'history-forward')
    expect(paints('scriptc is a Vercel Labs experiment')).toBe(true)

    // A fresh navigation truncates the forward branch.
    await clickTestId(app, 'thread-c1')
    await clickTestId(app, 'history-back')
    expect(paints('scriptc is a Vercel Labs experiment')).toBe(true)
    await clickTestId(app, 'history-back')
    expect(paints('GPUI is the renderer')).toBe(true)
    app.unmount()
  })

  it('closes search on an outside press and focuses the search field', async () => {
    const app = createTestApp(ChatApp)
    await clickTestId(app, 'search-action')

    const input = app.renderer.findByTestId('search-input')
    expect(input).toBeDefined()
    expect(app.renderer.getFocusedElementId()).toBe(input!.id)

    app.renderer.nativeSimulateKeystrokes(input!.id, 's d k')
    await app.settle()
    expect(app.renderer.findByTestId('search-c2')).toBeDefined()
    expect(app.renderer.findByTestId('search-c1')).toBeUndefined()

    // A press outside the card closes the overlay (the dim layer is
    // pointer-transparent, so the press lands on the transcript beneath).
    app.renderer.nativeSimulateClick(1100, 700)
    await app.settle()
    expect(app.renderer.findByTestId('search-input')).toBeUndefined()
    app.unmount()
  })

  it('refocuses the composer on New Task and thread switches', async () => {
    const app = createTestApp(ChatApp)
    const composer = app.renderer.findByTestId('composer')
    expect(composer).toBeDefined()
    const trigger = app.renderer.findByTestId('model-picker-trigger')
    expect(trigger).toBeDefined()

    // Steal focus, then New Task: focusTick returns it to the draft.
    app.renderer.focusElement(trigger!.id)
    expect(app.renderer.getFocusedElementId()).toBe(trigger!.id)
    await clickTestId(app, 'new-task')
    expect(app.renderer.getFocusedElementId()).toBe(composer!.id)

    // Steal again, then switch threads: same rule.
    app.renderer.focusElement(trigger!.id)
    await clickTestId(app, 'thread-c1')
    expect(app.renderer.getFocusedElementId()).toBe(composer!.id)
    app.unmount()
  })

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

  // A real child process serving automation on stdin: mouse input enters
  // through the window without the JS side holding the root view, so a
  // locator click must not abort the GPUI process.
  //
  // Deliberately drives counter.tsx, not the chat app: this file's tests run
  // in the same vitest job as chat.perf.test.tsx, and a live 1000-message
  // window stealing CPU/GPU made those draw budgets fail on CI. Windows CI
  // runners cannot host the live child's stdio handshake reliably, so this
  // runs on macOS.
  it.skipIf(process.platform !== 'darwin')('drives mouse input in the live app', async () => {
    const app = await launch({
      command: 'bun',
      args: ['counter.tsx'],
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      // VITEST is inherited from this worker and would disable the child's
      // automation stdio server; blank it so the child serves commands.
      env: { GPUIX_BACKGROUND: '1', VITEST: '' },
    })

    try {
      const value = app.getByTestId('counter-value')
      await value.waitFor({ timeoutMs: 30_000 })
      const before = await value.textContent()
      await app.getByTestId('increment').click()

      // The click handler ran a full applyBatch cycle on the live renderer —
      // the exact path that used to trip GPUI's nested-lease abort.
      const deadline = Date.now() + 5_000
      let after = before
      while (Date.now() < deadline) {
        after = await value.textContent()
        if (after !== before) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(after).not.toBe(before)
    } finally {
      await app.close()
    }
  }, 60_000)
})
