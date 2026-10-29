/// GPU-backed port of upstream c7dd862's onLayout tests. The event is emitted
/// via App::defer from the bounds-tracker canvas paint, so `settle()` (flush +
/// drain) delivers it.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const size = (event: EventPayload) => [event.width, event.height]

describeNative("onLayout (vue)", () => {
  it("reports the border box after the first paint", async () => {
    const events: EventPayload[] = []
    const App = defineComponent({
      setup: () => () => (
        <div style={{ padding: 10 }}>
          <div
            testId="box"
            style={{ width: 120, height: 40, borderWidth: 2, borderColor: "#fff" }}
            onLayout={(event: EventPayload) => events.push(event)}
          />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()

      expect(events).toHaveLength(1)
      expect(size(events[0]!)).toEqual([120, 40])
      const bounds = app.renderer.getElementBounds(app.renderer.findByTestId("box")!.id)!
      expect([events[0]!.x, events[0]!.y]).toEqual([bounds.x, bounds.y])
    } finally {
      app.unmount()
    }
  })

  it("reports again only when the size changes", async () => {
    const sizes: unknown[] = []
    const width = ref(100)
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{ width: width.value, height: 30 }}
            onLayout={(event: EventPayload) => sizes.push(size(event))}
          />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      width.value = 100
      await app.settle()
      expect(sizes, "an identical frame reports nothing").toEqual([[100, 30]])

      width.value = 140
      await app.settle()
      expect(sizes).toEqual([
        [100, 30],
        [140, 30],
      ])
    } finally {
      app.unmount()
    }
  })

  it("stays quiet when an element moves without resizing", async () => {
    const sizes: unknown[] = []
    const above = ref(10)
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ height: above.value, width: 50 }} />
          <div style={{ width: 80, height: 20 }} onLayout={(event: EventPayload) => sizes.push(size(event))} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      above.value = 60
      await app.settle()
      expect(sizes).toEqual([[80, 20]])
    } finally {
      app.unmount()
    }
  })

  it("reports a size the element gets from its content", async () => {
    const heights: number[] = []
    const lines = ref(1)
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{ width: 200, display: "flex", flexDirection: "column" }}
          onLayout={(event: EventPayload) => heights.push(event.height ?? -1)}
        >
          {Array.from({ length: lines.value }, (_, index) => (
            <div key={index} style={{ height: 16 }} />
          ))}
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      lines.value = 3
      await app.settle()
      expect(heights).toEqual([16, 48])
    } finally {
      app.unmount()
    }
  })

  it("reports again when the listener is removed and added back", async () => {
    const sizes: unknown[] = []
    const listening = ref(true)
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{ width: 70, height: 70 }}
          onLayout={listening.value ? (event: EventPayload) => sizes.push(size(event)) : undefined}
        />
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      listening.value = false
      await app.settle()
      listening.value = true
      await app.settle()
      expect(sizes).toEqual([
        [70, 70],
        [70, 70],
      ])
    } finally {
      app.unmount()
    }
  })

  it("is silent while the element is hidden, and reports once it shows", async () => {
    const sizes: unknown[] = []
    const visibility = ref("hidden")
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{ width: 64, height: 24, visibility: visibility.value }}
          onLayout={(event: EventPayload) => sizes.push(size(event))}
        />
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      expect(sizes, "gpui paints nothing for a hidden element").toEqual([])

      visibility.value = "visible"
      await app.settle()
      expect(sizes).toEqual([[64, 24]])
    } finally {
      app.unmount()
    }
  })

  it("reports elements inside a virtual list as they are measured", async () => {
    const sizes: Array<[number, number]> = []
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 300, height: 100 }}>
          <virtual-list style={{ width: 300, height: 100 }} estimatedItemHeight={20}>
            {Array.from({ length: 50 }, (_, index) => (
              <div
                key={index}
                style={{ height: 20 + (index % 2) * 10, flexShrink: 0 }}
                onLayout={(event: EventPayload) => sizes.push([index, event.height ?? -1])}
              />
            ))}
          </virtual-list>
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()

      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes.length, "rows outside the window are never built").toBeLessThan(50)
      for (const [index, height] of sizes) {
        expect(height).toBe(20 + (index % 2) * 10)
      }
    } finally {
      app.unmount()
    }
  })
})
