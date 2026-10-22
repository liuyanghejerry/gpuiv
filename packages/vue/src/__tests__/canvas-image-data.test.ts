/// Unit tests for `GpuixImageData` — the DOM-observable constructor
/// conversions: truncating/absolute WebIDL sizes, string and BigInt coercion,
/// the (sw, sh) vs (data, sw[, sh]) overload union, IndexSizeError /
/// InvalidStateError / TypeError boundaries, and the colorSpace settings
/// argument in every position it can appear.

import { describe, expect, it } from "vitest"
import { GpuixImageData } from "../canvas/image-data.js"

const MAX_DIMENSION = 0x7fffffff

function expectDomException(fn: () => void, name: string): void {
  try {
    fn()
    expect.unreachable(`expected ${name}`)
  } catch (e) {
    expect(e).toBeInstanceOf(DOMException)
    expect((e as DOMException).name).toBe(name)
  }
}

describe("GpuixImageData dimensions overload", () => {
  it("creates a zeroed buffer of sw × sh pixels", () => {
    const img = new GpuixImageData(2, 3)
    expect(img.width).toBe(2)
    expect(img.height).toBe(3)
    expect(img.data).toBeInstanceOf(Uint8ClampedArray)
    expect(img.data.length).toBe(24)
    expect(Array.from(img.data)).toEqual(new Array(24).fill(0))
  })

  it("truncates and takes magnitudes of numeric sizes", () => {
    expect(new GpuixImageData(2.9, 3.9).width).toBe(2)
    expect(new GpuixImageData(-2, 3).width).toBe(2)
    expect(new GpuixImageData(2, -3).height).toBe(3)
  })

  it("coerces string and BigInt sizes like WebIDL", () => {
    const img = new GpuixImageData("2", "3")
    expect(img.width).toBe(2)
    expect(img.height).toBe(3)
    expect(new GpuixImageData(2n, 3n).height).toBe(3)
  })

  it("treats non-numeric strings as zero sizes (IndexSizeError)", () => {
    expectDomException(() => new GpuixImageData("wide", 3), "IndexSizeError")
    expectDomException(() => new GpuixImageData(2, "tall"), "IndexSizeError")
  })

  it("rejects non-finite numeric sizes as zero (IndexSizeError)", () => {
    expectDomException(() => new GpuixImageData(NaN, 3), "IndexSizeError")
    expectDomException(() => new GpuixImageData(2, Infinity), "IndexSizeError")
  })

  it("rejects zero dimensions", () => {
    expectDomException(() => new GpuixImageData(0, 3), "IndexSizeError")
    expectDomException(() => new GpuixImageData(2, 0), "IndexSizeError")
  })

  it("rejects dimensions above 2³¹−1", () => {
    expectDomException(() => new GpuixImageData(MAX_DIMENSION + 1, 1), "IndexSizeError")
    expectDomException(() => new GpuixImageData(1, MAX_DIMENSION + 1), "IndexSizeError")
  })

  it("throws TypeError for non-size, non-data first arguments", () => {
    expect(() => new GpuixImageData({} as unknown as number, 2)).toThrow(TypeError)
    expect(() => new GpuixImageData(null as unknown as number, 2)).toThrow(TypeError)
    // An alien view only coerces when no height forces the data overload.
    expect(() => new GpuixImageData(new Uint8Array(8) as unknown as Uint8ClampedArray, 2, 3)).toThrow(TypeError)
    // Coerced as a size it reads as zero, so IndexSizeError wins.
    expectDomException(
      () => new GpuixImageData(new Uint8Array(8) as unknown as Uint8ClampedArray, 2),
      "IndexSizeError",
    )
  })

  it("throws TypeError when sh converts as neither number nor string", () => {
    expect(() => new GpuixImageData(2, true as unknown as number)).toThrow(TypeError)
    expect(() => new GpuixImageData(2, Symbol("h") as unknown as number)).toThrow(TypeError)
  })

  it("accepts a settings object trailing the two dimensions", () => {
    const p3 = new GpuixImageData(2, 3, { colorSpace: "display-p3" })
    expect(p3.colorSpace).toBe("display-p3")
    const srgb = new GpuixImageData(2, 3, undefined, { colorSpace: "display-p3" })
    expect(srgb.colorSpace).toBe("display-p3")
  })
})

describe("GpuixImageData data overload", () => {
  it("infers the height from the buffer length", () => {
    const data = new Uint8ClampedArray(16)
    const img = new GpuixImageData(data, 4)
    expect(img.width).toBe(4)
    expect(img.height).toBe(1)
    expect(img.data).toBe(data)
  })

  it("checks an explicit height against sw × sh", () => {
    const data = new Uint8ClampedArray(16)
    expect(new GpuixImageData(data, 4, 1).height).toBe(1)
    expect(new GpuixImageData(data, 4, -1).height).toBe(1)
    expectDomException(() => new GpuixImageData(data, 4, 2), "IndexSizeError")
  })

  it("takes the magnitude of a negative width", () => {
    const img = new GpuixImageData(new Uint8ClampedArray(8), -2)
    expect(img.width).toBe(2)
    expect(img.height).toBe(1)
  })

  it("coerces a string width", () => {
    expect(new GpuixImageData(new Uint8ClampedArray(16), "4").width).toBe(4)
  })

  it("requires a width with pixel data", () => {
    expect(() => new GpuixImageData(new Uint8ClampedArray(16))).toThrow(TypeError)
    // An object second argument is read as settings, leaving width 0.
    expectDomException(
      () => new GpuixImageData(new Uint8ClampedArray(16), { colorSpace: "display-p3" }),
      "IndexSizeError",
    )
  })

  it("rejects zero and non-quadruple buffer lengths", () => {
    expectDomException(() => new GpuixImageData(new Uint8ClampedArray(0), 1), "InvalidStateError")
    expectDomException(() => new GpuixImageData(new Uint8ClampedArray(6), 1), "InvalidStateError")
  })

  it("rejects a zero width with data", () => {
    expectDomException(() => new GpuixImageData(new Uint8ClampedArray(4), 0), "IndexSizeError")
  })

  it("rejects buffers that do not hold whole rows", () => {
    expectDomException(() => new GpuixImageData(new Uint8ClampedArray(8), 3), "IndexSizeError")
    expectDomException(() => new GpuixImageData(new Uint8ClampedArray(4), MAX_DIMENSION), "IndexSizeError")
  })

  it("accepts a settings object in the third or second slot", () => {
    const data = new Uint8ClampedArray(16)
    expect(new GpuixImageData(data, 4, { colorSpace: "display-p3" }).colorSpace).toBe("display-p3")
    // Width 0 still throws, but the settings slot is consumed first.
    expectDomException(
      () => new GpuixImageData(new Uint8ClampedArray(4), 0, { colorSpace: "display-p3" }),
      "IndexSizeError",
    )
  })
})

describe("GpuixImageData attributes", () => {
  it("defaults to srgb and rgba-8bit", () => {
    const img = new GpuixImageData(1, 1)
    expect(img.colorSpace).toBe("srgb")
    expect(img.pixelFormat).toBe("rgba-8bit")
  })

  it("ignores width/height/data assignments from script", () => {
    const img = new GpuixImageData(2, 3)
    // Sloppy-mode assignment to a getter-only property is silently dropped,
    // the DOM behaviour the readonly IDL attributes model.
    Function("img", "img.width = 99; img.height = 99; img.data = null")(img)
    expect(img.width).toBe(2)
    expect(img.height).toBe(3)
    expect(img.data).toBeInstanceOf(Uint8ClampedArray)
  })
})
