import { inflateSync } from "node:zlib"
import { expect } from "vitest"

// GPUI captureScreenshot saves an 8-bit, non-interlaced RGB/RGBA PNG.
// Keep this small decoder local to the pixel test; no image dependency is
// needed to recover the standard PNG scanline filters for four samples.
export function readPng(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
  let width = 0, height = 0, channels = 0
  const chunks: Buffer[] = []
  for (let cursor = 8; cursor < bytes.length;) {
    const size = bytes.readUInt32BE(cursor), kind = bytes.toString("ascii", cursor + 4, cursor + 8)
    const data = bytes.subarray(cursor + 8, cursor + 8 + size)
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      expect(data[8]).toBe(8)
      expect([2, 6]).toContain(data[9])
      expect([...data.subarray(10, 13)]).toEqual([0, 0, 0])
      channels = data[9] === 6 ? 4 : 3
    } else if (kind === "IDAT") chunks.push(data)
    cursor += size + 12
  }
  expect(width * height * channels).toBeGreaterThan(0)
  const stride = width * channels, filtered = inflateSync(Buffer.concat(chunks))
  expect(filtered.length).toBe((stride + 1) * height)
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!
    expect(filter).toBeLessThanOrEqual(4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x
      const left = x >= channels ? pixels[index - channels]! : 0
      const up = y ? pixels[index - stride]! : 0
      const upperLeft = y && x >= channels ? pixels[index - stride - channels]! : 0
      const p = left + up - upperLeft
      const distances = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upperLeft)]
      const paeth = distances[0]! <= distances[1]! && distances[0]! <= distances[2]! ? left : distances[1]! <= distances[2]! ? up : upperLeft
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter]!
      pixels[index] = (filtered[y * (stride + 1) + 1 + x]! + predictor) & 255
    }
  }
  return { width, height, pixel(x: number, y: number) {
    const index = (y * width + x) * channels
    return [...pixels.subarray(index, index + 3)]
  } }
}
