/**
 * Shared workload definitions for the open-source benchmark ports.
 *
 * Two public suites are reproduced, unchanged in shape:
 *
 * 1. React Native "New Architecture benchmarks"
 *    https://github.com/reactwg/react-native-new-architecture/discussions/123
 *    app: react-native-community/RNNewArchitectureApp@new-architecture-benchmarks
 *    Renders N <View>/<Text>/<Image> inside a ScrollView and reports the time
 *    from the press until a marker component after the children is painted.
 *
 * 2. krausest/js-framework-benchmark (keyed)
 *    https://github.com/krausest/js-framework-benchmark
 *    The nine table operations (create 1k, replace 1k, partial update,
 *    select, swap, remove, create 10k, append 1k to 10k, clear).
 *
 * The same Vue render functions run on GPUIV (bench-oss/gpuiv.ts) and on
 * Chromium's DOM (bench-oss/browser.html) so the only variable is the host.
 */

export const RN_SCENARIOS = [
  { name: "1500 <View>", kind: "view", count: 1500 },
  { name: "5000 <View>", kind: "view", count: 5000 },
  { name: "1500 <Text>", kind: "text", count: 1500 },
  { name: "5000 <Text>", kind: "text", count: 5000 },
  { name: "1500 <Image>", kind: "image", count: 1500 },
  { name: "5000 <Image>", kind: "image", count: 5000 },
] as const

/** Published results (ms, mean of 5) from discussion #123, RN 0.72.0-RC.1. */
export const RN_PUBLISHED: Record<string, { pixel4Old: number; pixel4New: number; iphone12Old: number; iphone12New: number }> = {
  "1500 <View>": { pixel4Old: 282, pixel4New: 258, iphone12Old: 137, iphone12New: 117 },
  "5000 <View>": { pixel4Old: 1088, pixel4New: 1045, iphone12Old: 435, iphone12New: 266 },
  "1500 <Text>": { pixel4Old: 512, pixel4New: 505, iphone12Old: 324, iphone12New: 284 },
  "5000 <Text>": { pixel4Old: 2156, pixel4New: 2089, iphone12Old: 1009, iphone12New: 808 },
  "1500 <Image>": { pixel4Old: 406, pixel4New: 404, iphone12Old: 212, iphone12New: 172 },
  "5000 <Image>": { pixel4Old: 1414, pixel4New: 1370, iphone12Old: 673, iphone12New: 451 },
}

export const JSFB_OPS = [
  "create 1k rows",
  "replace all 1k rows",
  "partial update (every 10th of 1k)",
  "select row",
  "swap rows",
  "remove row",
  "create 10k rows",
  "append 1k to 10k rows",
  "clear 1k rows",
] as const

const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"]
const colours = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"]
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"]

export interface RowData { id: number; label: string }

/** js-framework-benchmark's buildData with a seeded RNG so both hosts get
 *  byte-identical labels. */
export function createDataSource() {
  let nextId = 1
  let seed = 42
  const random = (max: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed % max
  }
  return (count: number): RowData[] => {
    const data: RowData[] = new Array(count)
    for (let i = 0; i < count; i++) {
      data[i] = {
        id: nextId++,
        label: `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`,
      }
    }
    return data
  }
}

export function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
  return { mean, median, min: sorted[0]!, max: sorted.at(-1)!, n: samples.length }
}

/** A 100x100 opaque PNG (the RN suite loads a 100x100 placekitten). */
export async function writeTestPng(path: string): Promise<void> {
  const { deflateSync } = await import("node:zlib")
  const { writeFileSync } = await import("node:fs")
  const w = 100, h = 100
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = (x * 2.55) | 0; raw[o + 1] = (y * 2.55) | 0; raw[o + 2] = 160
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]))
}
