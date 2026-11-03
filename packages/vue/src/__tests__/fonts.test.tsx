/** GPU-backed tests for loading fonts at runtime: `loadFontBytes` on the test
 *  renderer registers a font file's families so `fontFamily` can name them,
 *  and malformed fonts fail the call instead of aborting the process. */

import fs from "node:fs"
import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const fixture = (name: string) =>
  fs.readFileSync(new URL(`../../../native/fixtures/${name}`, import.meta.url))

// "A" is one em wide and "B" two, both drawn as squares, so "AB" at 20px is 60
// wide in this font (layout rounds to a whole pixel) and nowhere near that in
// the system fonts it falls back to.
const SQUARE_FONT = fixture("gpuix-test-square.ttf")

const rowFor = (family: string) =>
  defineComponent({
    setup() {
      return () => (
        <div style={{ display: "flex", flexDirection: "row", width: 400 }}>
          <text testId="word" style={{ fontFamily: family, fontSize: 20 }}>
            AB
          </text>
        </div>
      )
    },
  })

function wordWidth(app: TestApp): number {
  const word = app.renderer.findByTestId("word")
  expect(word).toBeDefined()
  return app.renderer.getElementBounds(word!.id)!.width
}

function expectSquareWidth(app: TestApp) {
  expect(Math.abs(wordWidth(app) - 60)).toBeLessThanOrEqual(1)
}

describeNative("loadFontBytes", () => {
  it("makes a font that is not installed available to fontFamily", async () => {
    const app = createTestApp(rowFor("GpuixTestSquare"))
    await app.settle()
    try {
      expect(
        Math.abs(wordWidth(app) - 60),
        "an unregistered family falls back to another font"
      ).toBeGreaterThan(5)

      app.renderer.loadFontBytes(SQUARE_FONT)
      expectSquareWidth(app)
    } finally {
      app.unmount()
    }
  })

  it("uses a font registered before any text asks for it", async () => {
    const app = createTestApp(rowFor("GpuixTestSquare"))
    app.renderer.loadFontBytes(SQUARE_FONT)
    await app.settle()
    try {
      expectSquareWidth(app)
    } finally {
      app.unmount()
    }
  })

  it("rejects bytes that are not a font and keeps working", async () => {
    const app = createTestApp(rowFor("GpuixTestSquare"))
    await app.settle()
    try {
      expect(() => app.renderer.loadFontBytes(new Uint8Array([1, 2, 3, 4]))).toThrow(
        /not a TrueType/
      )
      app.renderer.loadFontBytes(SQUARE_FONT)
      expectSquareWidth(app)
    } finally {
      app.unmount()
    }
  })

  it("rejects a font GPUI would abort on instead of crashing the process", async () => {
    const app = createTestApp(rowFor("GpuixTestNameless"))
    await app.settle()
    try {
      expect(() => app.renderer.loadFontBytes(fixture("gpuix-test-nameless.ttf"))).toThrow(
        /full name/
      )
      expect(wordWidth(app)).toBeGreaterThan(0)
    } finally {
      app.unmount()
    }
  })
})
