/** Window bounds: the test bridge reads the offscreen window's real frame
 *  through the same `Window::bounds()` the production renderer uses, so the
 *  whole read path (napi → GPUI → conversion) is exercised. The x/y
 *  startup-restore decision itself is unit-tested in Rust
 *  (`window_options_tests`). */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("window bounds", () => {
  it("reads the offscreen test window's frame", () => {
    const renderer = new TestRenderer({ width: 640, height: 480 })
    const bounds = renderer.getWindowBounds()

    expect(bounds.width).toBe(640)
    // The frame includes the native titlebar; the content viewport stays 480
    // (what `getWindowSize` reports).
    expect(bounds.height).toBeGreaterThanOrEqual(480)
    // The origin is wherever AppKit's window conformance left the "offscreen"
    // window — it pulls it back on-screen — so asserting on it would test
    // AppKit, not this bridge.
  })
})
