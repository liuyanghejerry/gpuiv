/** Window-control wiring: fullscreen flips the test window's real flag;
 *  minimize is recorded (TestWindow::minimize is unimplemented!()). */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("window controls", () => {
  it("toggles fullscreen", () => {
    const renderer = new TestRenderer()
    expect(renderer.isFullscreen()).toBe(false)
    renderer.toggleFullscreen()
    expect(renderer.isFullscreen()).toBe(true)
    renderer.toggleFullscreen()
    expect(renderer.isFullscreen()).toBe(false)
  })

  it("records minimize calls", () => {
    const renderer = new TestRenderer()
    expect(renderer.getMinimizeCalls()).toBe(0)
    renderer.minimizeWindow()
    renderer.minimizeWindow()
    expect(renderer.getMinimizeCalls()).toBe(2)
  })

  it("records zoom requests independently of fullscreen", () => {
    const renderer = new TestRenderer()
    expect(renderer.getZoomCalls()).toBe(0)
    renderer.zoomWindow()
    renderer.zoomWindow()
    expect(renderer.getZoomCalls()).toBe(2)
    expect(renderer.isFullscreen()).toBe(false)
    expect(renderer.getMinimizeCalls()).toBe(0)
  })
})
