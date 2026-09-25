/** GPU-backed tests for ref-carried host APIs: scrollIntoView and live images. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("host ref APIs", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("scrolls a child into view from the host ref", async () => {
    const child = ref(null)

    const Scroller = defineComponent({
      setup() {
        return () => (
          <div testId="scroller" style={{ width: 200, height: 100, overflow: "scroll" }}>
            <div style={{ height: 80 }}>
              <text>Item A</text>
            </div>
            <div style={{ height: 80 }}>
              <text>Item B</text>
            </div>
            <div ref={child} testId="item-d" style={{ height: 80 }}>
              <text>Item D</text>
            </div>
          </div>
        )
      },
    })
    app = createTestApp(Scroller)
    await app.settle()

    const scroller = app.renderer.findByTestId("scroller")!
    expect(app.renderer.getScrollOffset(scroller.id)).toEqual([0, 0])
    expect(child.value).not.toBeNull()
    expect(typeof child.value.scrollIntoView).toBe("function")

    child.value.scrollIntoView()
    await app.settle()
    const offset = app.renderer.getScrollOffset(scroller.id)
    expect(offset).not.toBeNull()
    expect(offset[1]).toBeLessThan(0)
  })

  it("scrolls a windowed virtual-list child by its logical index", async () => {
    // windowStart 50 with 8 mounted children: the last mounted row is item 57,
    // not item 7. scrollIntoView must scroll to the logical index.
    const last = ref(null)

    const WindowedList = defineComponent({
      setup() {
        return () => (
          <virtual-list
            testId="list"
            itemCount={100}
            estimatedItemHeight={40}
            windowStart={50}
            style={{ width: 300, height: 200 }}
          >
            {Array.from({ length: 8 }, (_, i) =>
              i === 7 ? (
                <div key={50 + i} ref={last} testId="row-57" style={{ height: 40 }}>
                  <text>Row 57</text>
                </div>
              ) : (
                <div key={50 + i} style={{ height: 40 }}>
                  <text>{`Row ${50 + i}`}</text>
                </div>
              )
            )}
          </virtual-list>
        )
      },
    })
    app = createTestApp(WindowedList)
    await app.settle()

    const list = app.renderer.findByTestId("list")!
    expect(last.value).not.toBeNull()
    last.value.scrollIntoView()
    await app.settle()

    const anchor = app.renderer.getListScrollTop(list.id)
    expect(anchor).not.toBeNull()
    // The windowed index (7) would leave this below 8; the logical index is 57.
    expect(anchor[0]).toBeGreaterThanOrEqual(50)
  })

  it("paints live pixels from the img ref without a src", async () => {
    const img = ref(null)

    const PixelImage = defineComponent({
      setup() {
        return () => <img ref={img} testId="pixels" style={{ width: 240, height: 140 }} />
      },
    })
    app = createTestApp(PixelImage)
    await app.settle()

    expect(img.value).not.toBeNull()
    expect(typeof img.value.setImagePixels).toBe("function")
    expect(typeof img.value.setImage).toBe("function")

    const fill = (r: number, g: number, b: number): Uint8Array => {
      const bytes = new Uint8Array(24 * 14 * 4)
      for (let i = 0; i < 24 * 14; i++) {
        bytes[i * 4] = r
        bytes[i * 4 + 1] = g
        bytes[i * 4 + 2] = b
        bytes[i * 4 + 3] = 255
      }
      return bytes
    }

    // Two phases upload in place; a wrong-length buffer must reject.
    img.value.setImagePixels(24, 14, fill(220, 20, 20))
    await app.settle()
    img.value.setImagePixels(24, 14, fill(20, 40, 220))
    await app.settle()
    expect(() => img.value.setImagePixels(24, 14, new Uint8Array(7))).toThrow(/does not match/)

    // The node stays healthy and keeps its layout box.
    const node = app.renderer.findByTestId("pixels")!
    expect(app.renderer.getElementBounds(node.id)).toMatchObject({
      width: 240,
      height: 140,
    })
  })

  it("type-gates the image ref methods", async () => {
    const box = ref(null)

    const Box = defineComponent({
      setup() {
        return () => <div ref={box} testId="box" style={{ width: 100, height: 50 }} />
      },
    })
    app = createTestApp(Box)
    await app.settle()

    expect(typeof box.value.scrollIntoView).toBe("function")
    expect(box.value.setImage).toBeUndefined()
    expect(box.value.setImagePixels).toBeUndefined()
  })
})
