/// Smoke tests for the headless harness itself: mount, mutate, and dispatch
/// protocol events through the shared registry without a native renderer.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { clickEvent, mountHeadless } from "./headless.js"

describe("headless harness", () => {
  it("mounts a component and records the mutation protocol", () => {
    const app = mountHeadless({
      setup: () => () => <div style={{ width: 10 }}>hi</div>,
    })
    const { renderer } = app
    expect(renderer.opsOf("setRoot").length).toBe(1)
    expect(renderer.allTexts()).toContain("hi")
    app.unmount()
  })

  it("dispatches click events to mounted handlers", async () => {
    const clicks = ref(0)
    const app = mountHeadless(
      defineComponent({
        setup() {
          return () => (
            <div onClick={() => (clicks.value += 1)}>press me</div>
          )
        },
      })
    )
    const ids = app.renderer.idsWithText("press me")
    expect(ids.length).toBe(1)
    expect(app.dispatch(clickEvent(ids[0]))).toBe(true)
    await app.settle()
    expect(clicks.value).toBe(1)
    app.unmount()
  })

  it("returns false for events on elements without handlers", () => {
    const app = mountHeadless({
      setup: () => () => <div>no listeners</div>,
    })
    const ids = app.renderer.idsWithText("no listeners")
    expect(app.dispatch(clickEvent(ids[0]))).toBe(false)
    app.unmount()
  })

  it("routes window key events through the root generation id", async () => {
    const seen: string[] = []
    const app = mountHeadless(
      defineComponent({ setup: () => () => <div>root</div> }),
      { onKeyDown: (e) => seen.push(e.key ?? "?") }
    )
    expect(app.windowKeyDown("escape")).toBe(true)
    expect(seen).toEqual(["escape"])
    app.unmount()
  })
})
