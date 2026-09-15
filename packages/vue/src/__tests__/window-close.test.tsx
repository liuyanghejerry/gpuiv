/** The window-close veto: while `onWindowShouldClose` is armed, a close
 *  attempt is cancelled and delivered to JS; `closeWindow()` is the
 *  confirmed close. `onReopen` fires on a Dock-icon relaunch. */

// @ts-nocheck

import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("window close and reopen", () => {
  it("vetoes a close attempt while onWindowShouldClose is armed", async () => {
    const attempts = []
    const app = createTestApp(defineComponent({ setup: () => () => <div /> }), {
      onWindowShouldClose: () => attempts.push("veto"),
    })

    expect(app.renderer.attemptWindowClose()).toBe(false)
    await app.settle()
    expect(attempts).toEqual(["veto"])
    app.unmount()
  })

  it("closes unvetoed when no observer is armed", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <div /> }))
    expect(app.renderer.attemptWindowClose()).toBe(true)
    await app.settle()
    app.unmount()
  })

  it("the confirmed close goes through closeWindow", () => {
    const app = createTestApp(defineComponent({ setup: () => () => <div /> }), {
      onWindowShouldClose: () => {},
    })
    expect(app.renderer.getWindowCloseCount()).toBe(0)
    app.renderer.closeWindow()
    app.renderer.closeWindow()
    expect(app.renderer.getWindowCloseCount()).toBe(2)
    app.unmount()
  })

  it("fires onReopen on a Dock-icon relaunch", async () => {
    const reopens = []
    const app = createTestApp(defineComponent({ setup: () => () => <div /> }), {
      onReopen: () => reopens.push("reopen"),
    })

    app.renderer.simulateAppReopen()
    await app.settle()
    expect(reopens).toEqual(["reopen"])
    app.unmount()
  })

  it("disarms on unmount", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <div /> }), {
      onWindowShouldClose: () => {},
      onReopen: () => {},
    })
    app.unmount()

    // The next root owns the window; an unarmed attempt closes.
    const next = createTestApp(defineComponent({ setup: () => () => <div /> }))
    expect(next.renderer.attemptWindowClose()).toBe(true)
    next.renderer.simulateAppReopen()
    await next.settle()
    next.unmount()
  })
})
