/** Exercises the bidirectional, cursor-paginated virtual chat example. */

import { defineComponent, h } from 'vue'
import { connectTest } from '@gpuiv/vue/automation'
import { createTestApp, hasNativeTestRenderer, type TestApp } from '@gpuiv/vue'
import { describe, expect, it, vi } from 'vitest'
import { createFakeMessageApi, InfiniteChatApp, type MessageApi } from './infinite-chat'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function renderApp(api: MessageApi, initialMessageId?: string): TestApp {
  return createTestApp(
    defineComponent({
      setup: () => () => h(InfiniteChatApp, { api, initialMessageId }),
    }),
    { width: 900, height: 640 },
  )
}

/// Vue applies the loading indicator on the microtask after the visibleRange
/// dispatch that started the fetch, and clears it the same way once the page
/// lands — so every poll has to settle, not just flush.
async function waitForRequest(app: TestApp, testId: string) {
  await vi.waitFor(async () => {
    await app.settle()
    expect(app.renderer.findByTestId(testId)).toBeUndefined()
  })
}

describeNative('infinite chat example', () => {
  it('renders a bounded Safe MDX page with variable-height content', () => {
    const api = createFakeMessageApi({ messageCount: 48, pageSize: 8, delayMs: 5 })
    const app = renderApp(api)

    const list = app.renderer.findByType('virtual-list')[0]!
    expect(list.children).toHaveLength(8)
    expect(app.renderer.findByType('markdown')).toHaveLength(0)
    expect(app.renderer.findByType('code').length).toBeGreaterThan(0)
    expect(app.renderer.getAllText()).toContain('Rendering path')
    expect(app.renderer.getAllText()).toContain('Virtualized')
    app.unmount()
  })

  it('opens a message route from a Safe MDX link', async () => {
    const api = createFakeMessageApi({ messageCount: 48, pageSize: 8, delayMs: 50 })
    const app = renderApp(api, 'message-024')

    const list = app.renderer.findByType('virtual-list')[0]!
    app.renderer.scrollToItem(list.id, 4)

    const automation = await connectTest(app.renderer, app.settle)
    try {
      await automation.getByText('Open message 008').click()
      await app.settle()
      expect(app.renderer.findByTestId('loading-route')).toBeDefined()
      await waitForRequest(app, 'loading-route')

      expect(app.renderer.getAllText()).toContain('/messages/message-008')
      expect(app.renderer.findByTestId('message-message-008')).toBeDefined()
      expect(api.requests[api.requests.length - 1]).toEqual({ around: 'message-008' })
    } finally {
      await automation.close()
      app.unmount()
    }
  })

  it('pages to both ends, preserves retained rows, and stops requesting there', async () => {
    const api = createFakeMessageApi({ messageCount: 48, pageSize: 8, delayMs: 50 })
    const app = renderApp(api, 'message-024')

    const targetId = app.renderer.findByTestId('message-message-024')!.id

    for (
      let attempt = 0;
      attempt < 6 && !app.renderer.findByTestId('message-message-000');
      attempt++
    ) {
      const list = app.renderer.findByType('virtual-list')[0]!
      app.renderer.scrollToItem(list.id, 0)
      // scrollToItem dispatches visibleRange at the end of its flush; the
      // loading indicator lands one Vue flush later.
      await app.settle()
      await app.settle()
      expect(app.renderer.findByTestId('loading-previous')).toBeDefined()
      await waitForRequest(app, 'loading-previous')
    }

    expect(app.renderer.findByTestId('message-message-000')).toBeDefined()
    expect(app.renderer.findByTestId('message-message-024')!.id).toBe(targetId)

    const requestsAtStart = api.requests.length
    app.renderer.scrollToItem(app.renderer.findByType('virtual-list')[0]!.id, 0)
    await app.settle()
    expect(api.requests).toHaveLength(requestsAtStart)
    expect(app.renderer.findByTestId('loading-previous')).toBeUndefined()

    for (
      let attempt = 0;
      attempt < 8 && !app.renderer.findByTestId('message-message-047');
      attempt++
    ) {
      const list = app.renderer.findByType('virtual-list')[0]!
      app.renderer.scrollToItem(list.id, list.children.length - 1)
      await app.settle()
      await app.settle()
      expect(app.renderer.findByTestId('loading-next')).toBeDefined()
      await waitForRequest(app, 'loading-next')
      expect(
        app.renderer.findByType('virtual-list')[0]!.children.length,
      ).toBeLessThanOrEqual(40)
    }

    expect(app.renderer.findByTestId('message-message-047')).toBeDefined()
    const requestsAtEnd = api.requests.length
    const list = app.renderer.findByType('virtual-list')[0]!
    app.renderer.scrollToItem(list.id, list.children.length - 1)
    await app.settle()
    expect(api.requests).toHaveLength(requestsAtEnd)
    expect(app.renderer.findByTestId('loading-next')).toBeUndefined()
    app.unmount()
  })
})
