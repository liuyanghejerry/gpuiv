/** Native bounds regression for trigger-relative centered floating layers.
 * These assertions need actual Taffy layout + deferred GPUI prepaint; a JS host
 * mock cannot detect flex centering followed by a second Anchor size offset.
 */
import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { FloatingLayer, type FloatingSide } from "../components/floating.js"
import { createTestApp, hasNativeTestRenderer, type ElementBounds } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sides: FloatingSide[] = ["top", "right", "bottom", "left"]

function expectCentered(side: FloatingSide, trigger: ElementBounds, popup: ElementBounds) {
  if (side === "left" || side === "right") {
    expect(popup.y + popup.height / 2).toBeCloseTo(trigger.y + trigger.height / 2, 0)
    if (side === "right") expect(popup.x).toBeCloseTo(trigger.x + trigger.width + 6, 0)
    else expect(popup.x + popup.width).toBeCloseTo(trigger.x - 6, 0)
  } else {
    expect(popup.x + popup.width / 2).toBeCloseTo(trigger.x + trigger.width / 2, 0)
    if (side === "bottom") expect(popup.y).toBeCloseTo(trigger.y + trigger.height + 6, 0)
    else expect(popup.y + popup.height).toBeCloseTo(trigger.y - 6, 0)
  }
}

describeNative("centered anchored floating bounds", () => {
  it.each(sides)("%s center compensates for popup dimensions exactly once", async (side) => {
    const popupSize = ref({ width: 180, height: 152 })
    const App = defineComponent({
      setup: () => () => h("div", { style: { width: 1000, height: 800, position: "relative" } }, [
        h("div", {
          testId: "trigger",
          style: { position: "absolute", left: 400, top: 320, width: 120, height: 40, backgroundColor: "#27324a" },
        }, [
          h(FloatingLayer, {
            side, align: "center", sideOffset: 6, testId: "popup",
            style: { ...popupSize.value, backgroundColor: "#ffeea0" },
          }, { default: () => [h("text", null, "Popup")] }),
        ]),
      ]),
    })
    const app = createTestApp(App, { width: 1000, height: 800 })
    try {
      await app.settle()
      const trigger = app.renderer.getElementBounds(app.renderer.findByTestId("trigger")!.id)!
      let popup = app.renderer.getElementBounds(app.renderer.findByTestId("popup")!.id)!
      expect(popup.width).toBe(180)
      expect(popup.height).toBe(152)
      expectCentered(side, trigger, popup)

      // Changing popup size must move only its own edges, keeping its center
      // on the trigger center. The previous double-centering drifts again.
      popupSize.value = { width: 240, height: 80 }
      await app.settle()
      popup = app.renderer.getElementBounds(app.renderer.findByTestId("popup")!.id)!
      expect(popup.width).toBe(240)
      expect(popup.height).toBe(80)
      expectCentered(side, trigger, popup)
    } finally {
      app.unmount()
    }
  })

  it.each(sides)("%s center follows the painted trigger after its ancestor scrolls", async (side) => {
    const App = defineComponent({
      setup: () => () => h("div", {
        testId: "scroller",
        style: { width: 1000, height: 720, overflowY: "scroll", display: "flex", flexDirection: "column" },
      }, [
        h("div", { style: { position: "relative", width: 1000, height: 1400, flexShrink: 0 } }, [
          h("div", {
            testId: "trigger",
            style: { position: "absolute", left: 400, top: 400, width: 120, height: 40, backgroundColor: "#27324a" },
          }, [
            h(FloatingLayer, {
              side, align: "center", sideOffset: 6, testId: "popup",
              style: { width: 180, height: 152, backgroundColor: "#ffeea0" },
            }, { default: () => [h("text", null, "Popup")] }),
          ]),
        ]),
      ]),
    })
    const app = createTestApp(App, { width: 1000, height: 800 })
    try {
      await app.settle()
      const triggerId = app.renderer.findByTestId("trigger")!.id
      const popupId = app.renderer.findByTestId("popup")!.id
      const before = app.renderer.getElementBounds(triggerId)!
      expectCentered(side, before, app.renderer.getElementBounds(popupId)!)

      const scrollerId = app.renderer.findByTestId("scroller")!.id
      app.renderer.scrollTo(scrollerId, 0, -200)
      await app.settle()
      const offset = app.renderer.getScrollOffset(scrollerId)!
      expect(offset[1]).toBeLessThan(-100)
      const after = app.renderer.getElementBounds(triggerId)!
      expect(after.y).toBeCloseTo(before.y + offset[1], 0)
      expectCentered(side, after, app.renderer.getElementBounds(popupId)!)
    } finally {
      app.unmount()
    }
  })
})
