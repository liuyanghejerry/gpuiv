/// GPU-backed port of upstream 5ab017a's onScrollChange tests. The event is
/// emitted via App::defer from the paint reporter once the scroll offset
/// differs from the last paint; `settle()` (flush + drain) delivers it.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const offset = (event: EventPayload) => [event.scrollX, event.scrollY]

describeNative("onScrollChange (vue)", () => {
  it("reports movement, not the position it starts at", async () => {
    const offsets: unknown[] = []
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="scroller"
          style={{ width: 200, height: 100, overflow: "scroll" }}
          onScrollChange={(event: EventPayload) => offsets.push(offset(event))}
        >
          <div style={{ height: 500 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(offsets, "a first paint is not a scroll").toEqual([])

      const id = app.renderer.findByTestId("scroller")!.id
      app.renderer.scrollTo(id, 0, -100)
      await app.settle()
      expect(offsets).toEqual([[0, -100]])
      expect(app.renderer.getScrollOffset(id)).toEqual([0, -100])
    } finally {
      app.unmount()
    }
  })

  it("reports a wheel scroll with the offset it leaves", async () => {
    const offsets: number[][] = []
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="scroller"
          style={{ width: 200, height: 100, overflow: "scroll" }}
          onScrollChange={(event: EventPayload) => offsets.push(offset(event) as number[])}
        >
          <div style={{ height: 500 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      app.renderer.nativeSimulateScrollWheel(100, 50, 0, -40)
      await app.settle()

      expect(offsets).toHaveLength(1)
      const id = app.renderer.findByTestId("scroller")!.id
      expect(offsets[0]).toEqual(app.renderer.getScrollOffset(id))
      expect(offsets[0]![1]).toBeLessThan(0)
    } finally {
      app.unmount()
    }
  })

  it("stays quiet while the offset holds, and for sub-pixel noise", async () => {
    const offsets: unknown[] = []
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="scroller"
          style={{ width: 200, height: 100, overflow: "scroll" }}
          onScrollChange={(event: EventPayload) => offsets.push(offset(event))}
        >
          <div style={{ height: 500 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const id = app.renderer.findByTestId("scroller")!.id
      app.renderer.scrollTo(id, 0, -30)
      await app.settle()
      expect(offsets).toHaveLength(1)

      app.renderer.scrollTo(id, 0, -30.004)
      await app.settle()
      expect(offsets).toHaveLength(1)
    } finally {
      app.unmount()
    }
  })

  it("starts from where the element already is when the listener arrives late", async () => {
    const offsets: unknown[] = []
    const listening = ref(false)
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="scroller"
          style={{ width: 200, height: 100, overflow: "scroll" }}
          onScrollChange={listening.value ? (event: EventPayload) => offsets.push(offset(event)) : undefined}
        >
          <div style={{ height: 500 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const id = app.renderer.findByTestId("scroller")!.id
      app.renderer.scrollTo(id, 0, -80)
      await app.settle()

      listening.value = true
      await app.settle()
      expect(offsets).toEqual([])

      app.renderer.scrollTo(id, 0, -120)
      await app.settle()
      expect(offsets).toEqual([[0, -120]])
    } finally {
      app.unmount()
    }
  })

  it("reports a scroll that follows scrollIntoView", async () => {
    const offsets: unknown[] = []
    const App = defineComponent({
      setup: () => () => (
        <div
          testId="scroller"
          style={{ width: 200, height: 100, overflow: "scroll" }}
          onScrollChange={(event: EventPayload) => offsets.push(offset(event))}
        >
          <div style={{ height: 400 }} />
          <div testId="target" style={{ height: 20 }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(offsets).toEqual([])

      app.renderer.scrollIntoView(app.renderer.findByTestId("target")!.id)
      await app.settle()
      expect(offsets).toHaveLength(1)
      expect((offsets[0] as number[])[1]).toBeLessThan(0)
    } finally {
      app.unmount()
    }
  })

  it("ignores an element that does not scroll", async () => {
    const offsets: unknown[] = []
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 200, height: 100 }} onScrollChange={(event: EventPayload) => offsets.push(offset(event))} />
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(offsets).toEqual([])
    } finally {
      app.unmount()
    }
  })
})
