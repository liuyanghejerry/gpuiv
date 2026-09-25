/** GPU-backed tests for the FloatingLayer outer-surface style contract. */

// @ts-nocheck

import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { FloatingLayer } from "../components/floating.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("floating layer surfaces", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("forwards outer surface styles without multiplying opacity", () => {
    const Layer = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 300 }}>
            <FloatingLayer
              style={{
                width: 120,
                height: 60,
                visibility: "hidden",
                opacity: 0.5,
                pointerEvents: "none",
                borderRadius: 16,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 8,
                borderBottomRightRadius: 12,
                borderBottomLeftRadius: 20,
                hover: {
                  opacity: 0.75,
                  borderTopLeftRadius: 24,
                  backgroundColor: "#222222",
                },
                active: {
                  opacity: 0.9,
                  borderBottomRightRadius: 28,
                },
              }}
            >
              <text>Rounded layer</text>
            </FloatingLayer>
          </div>
        )
      },
    })
    app = createTestApp(Layer)

    const anchored = app.renderer.findByType("anchored")[0]
    const content = app.renderer.getElement(anchored.children[0])
    const surfaceHover = anchored.style.hover
    const surfaceActive = anchored.style.active

    expect({
      visibility: anchored.style.visibility,
      opacity: anchored.style.opacity,
      borderRadius: anchored.style.borderRadius,
      borderTopLeftRadius: anchored.style.borderTopLeftRadius,
      borderTopRightRadius: anchored.style.borderTopRightRadius,
      borderBottomRightRadius: anchored.style.borderBottomRightRadius,
      borderBottomLeftRadius: anchored.style.borderBottomLeftRadius,
      hover: {
        opacity: surfaceHover?.opacity,
        borderTopLeftRadius: surfaceHover?.borderTopLeftRadius,
        backgroundColor: surfaceHover?.backgroundColor ?? null,
      },
      active: {
        opacity: surfaceActive?.opacity,
        borderBottomRightRadius: surfaceActive?.borderBottomRightRadius,
      },
      occlude: anchored.customProps?.occlude,
    }).toEqual({
      visibility: "hidden",
      opacity: 0.5,
      borderRadius: 16,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 8,
      borderBottomRightRadius: 12,
      borderBottomLeftRadius: 20,
      hover: { opacity: 0.75, borderTopLeftRadius: 24, backgroundColor: null },
      active: { opacity: 0.9, borderBottomRightRadius: 28 },
      occlude: false,
    })
    // Opacity lives on the surface only; the content keeps its fill.
    expect(content?.style.opacity).toBeUndefined()
    expect(content?.style.hover?.opacity).toBeNull()
    expect(content?.style.hover?.backgroundColor).toBe("#222222")
    expect(content?.style.backgroundColor).toBe("#1A1A1A")
  })
})
