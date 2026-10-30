/// Test utilities shared across GPU-backed test files: a dependency-free PNG
/// reader for looking at actual painted pixels, ported from upstream's
/// react test-utils (their readPixels / readLogicalPixels).

import fs from "fs"
import zlib from "zlib"
import path from "path"
import { fileURLToPath } from "url"
import { expect } from "vitest"

/** Where visual tests write their PNGs. Kept in the repo (gitignored) rather
 *  than /tmp so the output can actually be looked at after a run, and because
 *  `/tmp` does not exist on Windows: native `save()` there fails the whole
 *  test with `The system cannot find the path specified`.
 *
 *  Created on import, so a file that only writes a screenshot needs no
 *  `beforeAll`. Native never creates the parent directory itself. */
export const SHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../screenshots",
)

fs.mkdirSync(SHOTS_DIR, { recursive: true })

export interface Pixels {
  width: number
  height: number
  /** The pixel at (x, y) as `[r, g, b, a]`. */
  at(x: number, y: number): [number, number, number, number]
}

/** Decode a screenshot (8-bit RGBA, not interlaced, which is what the test
 *  renderer writes) so a test can look at actual pixels. */
export function readPixels(file: string): Pixels {
  const png = fs.readFileSync(file)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  expect([png[24], png[25], png[28]], "8-bit RGBA, not interlaced").toEqual([8, 6, 0])
  const chunks: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      chunks.push(png.subarray(at + 8, at + 8 + length))
    }
    at += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const data = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const byte = raw[y * (stride + 1) + 1 + x]!
      const left = x >= 4 ? data[y * stride + x - 4]! : 0
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0
      const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4]! : 0
      const paeth = () => {
        const estimate = left + up - upLeft
        const [a, b, c] = [
          Math.abs(estimate - left),
          Math.abs(estimate - up),
          Math.abs(estimate - upLeft),
        ]
        return a <= b && a <= c ? left : b <= c ? up : upLeft
      }
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth()
      data[y * stride + x] = (byte + predicted) & 255
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = y * stride + x * 4
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
    },
  }
}

/** The test window's width in logical pixels (`DEFAULT_WINDOW_WIDTH` in the
 *  native test renderer). On a 2x display the window captures twice that. */
const TEST_WINDOW_WIDTH = 1280

/** `readPixels` addressed in logical pixels, the units styles are written in,
 *  sampling the centre of each. The same geometry reads the same on a 1x and
 *  a 2x display. */
export function readLogicalPixels(file: string): Pixels {
  const pixels = readPixels(file)
  const scale = pixels.width / TEST_WINDOW_WIDTH
  return {
    width: pixels.width / scale,
    height: pixels.height / scale,
    at: (x, y) => pixels.at(Math.floor((x + 0.5) * scale), Math.floor((y + 0.5) * scale)),
  }
}
