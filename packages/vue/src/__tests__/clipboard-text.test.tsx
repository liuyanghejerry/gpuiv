/** End-to-end tests for clipboard text read/write: the test platform keeps
 *  a real in-memory clipboard, so these exercise the full
 *  write → ClipboardItem::String → read round trip. */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("clipboard text", () => {
  it("round-trips text", () => {
    const renderer = new TestRenderer()
    renderer.writeClipboardText("hello 世界")
    expect(renderer.readClipboardText()).toBe("hello 世界")
  })

  it("overwrites the previous content", () => {
    const renderer = new TestRenderer()
    renderer.writeClipboardText("first")
    renderer.writeClipboardText("second")
    expect(renderer.readClipboardText()).toBe("second")
  })

  it("returns null when the clipboard has no text", () => {
    const renderer = new TestRenderer()
    expect(renderer.readClipboardText()).toBeNull()
  })
})
