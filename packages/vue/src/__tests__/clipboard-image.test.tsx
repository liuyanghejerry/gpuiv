/** End-to-end tests for clipboard image read/write: the test platform keeps
 *  a real in-memory clipboard, so these exercise the full encode →
 *  ClipboardItem::Image → decode round trip. */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("clipboard image", () => {
  it("round-trips RGBA pixels", () => {
    const renderer = new TestRenderer()
    // A 2x2 image: red, green, blue, white (straight alpha).
    const rgba = new Uint8Array([
      255, 0, 0, 255, //
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ])
    renderer.writeClipboardImage(rgba, 2, 2)

    const image = renderer.readClipboardImage()
    expect(image).not.toBeNull()
    expect(image.width).toBe(2)
    expect(image.height).toBe(2)
    expect(Array.from(image.data)).toEqual(Array.from(rgba))
  })

  it("round-trips translucent pixels", () => {
    const renderer = new TestRenderer()
    const rgba = new Uint8Array([128, 64, 32, 128])
    renderer.writeClipboardImage(rgba, 1, 1)

    const image = renderer.readClipboardImage()
    // PNG stores straight alpha, so the values survive the codec exactly.
    expect(Array.from(image.data)).toEqual([128, 64, 32, 128])
  })

  it("returns null when the clipboard has no image", () => {
    const renderer = new TestRenderer()
    expect(renderer.readClipboardImage()).toBeNull()
  })

  it("rejects a buffer that does not match the dimensions", () => {
    const renderer = new TestRenderer()
    expect(() => renderer.writeClipboardImage(new Uint8Array(4), 2, 2)).toThrow(/RGBA/)
  })
})
