/// GPU-backed tests for PNG export on the canvas instance: `toDataURL` /
/// `toBlob` over the last uploaded buffer. Decoding is asserted from the
/// PNG byte stream itself (signature + IHDR dimensions), not via a JS PNG
/// decoder dependency.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import {
  GpuixCanvas,
  createTestApp,
  hasNativeTestRenderer,
  type GpuixCanvasInstance,
} from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

/** A 3x2 buffer: red, green, blue on top; white, gray, black below. */
function sixPixels(): Uint8ClampedArray {
  return new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, //
    255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 255,
  ])
}

/** Big-endian u32 from a PNG byte stream. */
function pngDimension(png: Uint8Array, offset: number): number {
  return (png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!
}

describeNative("canvas PNG export (vue)", () => {
  async function mountCanvas(width: number, height: number, pixels?: Uint8ClampedArray) {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <GpuixCanvas ref={canvas} width={width} height={height} style={{ width: 96, height: 64 }} />
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    if (pixels) {
      canvas.value!.uploadPixels(pixels)
      await app.settle()
    }
    return { app, canvas: canvas.value! }
  }

  it("returns null before the first upload", async () => {
    const { app, canvas } = await mountCanvas(3, 2)
    expect(canvas.toDataURL()).toBeNull()
    let blob: Blob | null = "unset" as unknown as Blob | null
    canvas.toBlob((b) => (blob = b))
    expect(blob).toBeNull()
    app.unmount()
  })

  it("toDataURL encodes a PNG data URL with the canvas dimensions", async () => {
    const { app, canvas } = await mountCanvas(3, 2, sixPixels())

    const url = canvas.toDataURL()!
    expect(url.startsWith("data:image/png;base64,")).toBe(true)

    const png = Uint8Array.from(atob(url.slice("data:image/png;base64,".length)), (c) =>
      c.charCodeAt(0),
    )
    // PNG signature.
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // IHDR: width at byte 16, height at byte 20.
    expect(pngDimension(png, 16)).toBe(3)
    expect(pngDimension(png, 20)).toBe(2)
    app.unmount()
  })

  it("toDataURL falls back to PNG for other requested types", async () => {
    const { app, canvas } = await mountCanvas(3, 2, sixPixels())
    expect(canvas.toDataURL("image/webp")!.startsWith("data:image/png;base64,")).toBe(true)
    app.unmount()
  })

  it("toBlob produces a PNG blob whose bytes match toDataURL", async () => {
    const { app, canvas } = await mountCanvas(3, 2, sixPixels())

    let blob: Blob | null = null
    canvas.toBlob((b) => (blob = b))
    expect(blob).not.toBeNull()
    expect(blob!.type).toBe("image/png")

    const blobBytes = new Uint8Array(await blob!.arrayBuffer())
    const urlBytes = Uint8Array.from(
      atob(canvas.toDataURL()!.slice("data:image/png;base64,".length)),
      (c) => c.charCodeAt(0),
    )
    expect([...blobBytes]).toEqual([...urlBytes])
    expect(pngDimension(blobBytes, 16)).toBe(3)
    expect(pngDimension(blobBytes, 20)).toBe(2)
    app.unmount()
  })

  it("reflects the latest upload", async () => {
    const { app, canvas } = await mountCanvas(3, 2, sixPixels())
    const before = canvas.toDataURL()!

    const recolored = new Uint8ClampedArray(3 * 2 * 4).fill(255)
    canvas.uploadPixels(recolored)
    await app.settle()
    const after = canvas.toDataURL()!

    expect(after).not.toBe(before)
    app.unmount()
  })
})
