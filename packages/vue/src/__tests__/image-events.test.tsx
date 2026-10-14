/** The events come from GPUI asset completion, not synthesized Vue handlers. */
// @ts-nocheck
import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createTestApp, hasNativeTestRenderer } from '../testing.js'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="red"/></svg>'
const valid = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
describeNative('native image decode events', () => {
  it('reports success/failure once and can return to a cached successful source', async () => {
    const src = ref(valid)
    const events = []
    const app = createTestApp(defineComponent(() => () => <img src={src.value} testId="image"
      onLoad={event => events.push(['load', JSON.parse(event.value)])}
      onError={event => events.push(['error', JSON.parse(event.value)])} style={{ width: 120, height: 90 }} />))
    try {
      await app.settle()
      expect(events[0]).toMatchObject(['load', { src: valid, naturalWidth: 48, naturalHeight: 36 }])
      await app.settle()
      expect(events).toHaveLength(1)
      src.value = 'data:image/png;base64,bm90LWFuLWltYWdl'
      await app.settle()
      expect(events[1][0]).toBe('error')
      expect(events[1][1].error).toEqual(expect.any(String))
      src.value = valid
      await app.settle()
      expect(events[2][0]).toBe('load')
      expect(events[2][1].generation).toBeGreaterThan(events[0][1].generation)
    } finally { app.unmount() }
  })

  it('keeps empty src idle and emits only the first live image frame load', async () => {
    const events = []
    const app = createTestApp(defineComponent(() => () => <img src="" testId="live"
      onLoad={event => events.push(JSON.parse(event.value))} onError={event => events.push(event)} />))
    try {
      await app.settle()
      expect(events).toHaveLength(0)
      const id = app.renderer.findByTestId('live').id
      app.renderer.setImagePixels(id, 2, 3, new Uint8Array(24))
      await app.settle()
      expect(events).toMatchObject([{ src: '', naturalWidth: 2, naturalHeight: 3 }])
      app.renderer.setImagePixels(id, 2, 3, new Uint8Array(24).fill(255))
      await app.settle()
      expect(events).toHaveLength(1)
    } finally { app.unmount() }
  })
})
