/** IME composition events: setMarkedText drives compositionStart +
 *  compositionUpdate, a commit drives compositionEnd + change, a cancel drops
 *  the marked text and ends the composition. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("IME composition events", () => {
  function compositionApp() {
    const events = []
    const value = ref("")
    const App = defineComponent({
      setup() {
        return () => (
          <input
            testId="composer"
            value={value.value}
            onChange={(e) => {
              value.value = e.value
              events.push(["change", e.value])
            }}
            onCompositionStart={(e) => events.push(["start", e.value])}
            onCompositionUpdate={(e) => events.push(["update", e.value])}
            onCompositionEnd={(e) => events.push(["end", e.value])}
          />
        )
      },
    })
    const app = createTestApp(App)
    // Marked-text edits also fire change events (like the DOM's input during
    // composition); the composition assertions care only about the
    // composition lifecycle.
    const compositionEvents = () => events.filter(([kind]) => kind !== "change")
    return { app, events, value, compositionEvents }
  }

  it("fires start and update while marking", async () => {
    const { app, compositionEvents } = compositionApp()
    const input = app.renderer.findByTestId("composer")
    app.renderer.simulateMarkedText(input.id, "ni")
    await app.settle()
    expect(compositionEvents()).toEqual([
      ["start", ""],
      ["update", "ni"],
    ])
    app.unmount()
  })

  it("updates again without restarting", async () => {
    const { app, compositionEvents } = compositionApp()
    const input = app.renderer.findByTestId("composer")
    app.renderer.simulateMarkedText(input.id, "ni")
    await app.settle()
    app.renderer.simulateMarkedText(input.id, "nihao", 0, 5)
    await app.settle()
    expect(compositionEvents()).toEqual([
      ["start", ""],
      ["update", "ni"],
      ["update", "nihao"],
    ])
    app.unmount()
  })

  it("commit ends the composition and changes the value", async () => {
    const { app, events, compositionEvents, value } = compositionApp()
    const input = app.renderer.findByTestId("composer")
    app.renderer.simulateMarkedText(input.id, "nihao")
    await app.settle()
    events.length = 0
    app.renderer.simulateImeCommit(input.id, "你好")
    await app.settle()
    expect(compositionEvents()).toEqual([["end", "你好"]])
    expect(value.value).toBe("你好")
    app.unmount()
  })

  it("cancel reverts the marked text and ends", async () => {
    const { app, events, compositionEvents, value } = compositionApp()
    const input = app.renderer.findByTestId("composer")
    app.renderer.simulateMarkedText(input.id, "nihao")
    await app.settle()
    events.length = 0
    app.renderer.simulateImeCancel(input.id)
    await app.settle()
    expect(compositionEvents()).toEqual([["end", ""]])
    expect(value.value).toBe("")
    // The composed string was reverted, not committed.
    expect(app.renderer.getAllText().join("")).not.toContain("nihao")
    app.unmount()
  })
})
