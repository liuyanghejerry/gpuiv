import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { defineComponent, h } from "vue"
import { useGpuix } from "@gpuiv/vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadAnimalIslandFonts, ANIMAL_ISLAND_FONT_FAMILIES } from "../src/fonts.js"
import { fonts } from "../src/tokens.js"
import { mountHost } from "./harness.js"

const folder = new URL("../assets/fonts/", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("sources.json", folder), "utf8")) as {
  faces: { file: string; family: string; style: string; weight: number; codePoints: number; license: string; sha256: string }[]
}
afterEach(() => { fonts.sans = undefined })

function table(bytes: Buffer, tag: string): Buffer {
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const offset = 12 + i * 16
    if (bytes.toString("ascii", offset, offset + 4) === tag) {
      const start = bytes.readUInt32BE(offset + 8)
      return bytes.subarray(start, start + bytes.readUInt32BE(offset + 12))
    }
  }
  throw new Error(`Font table missing: ${tag}`)
}
function name(bytes: Buffer, nameId: number): string {
  const names = table(bytes, "name"), storage = names.readUInt16BE(4)
  for (let i = 0; i < names.readUInt16BE(2); i++) {
    const offset = 6 + i * 12
    if (names.readUInt16BE(offset) === 3 && names.readUInt16BE(offset + 6) === nameId) {
      const start = storage + names.readUInt16BE(offset + 10)
      return Buffer.from(names.subarray(start, start + names.readUInt16BE(offset + 8))).swap16().toString("utf16le")
    }
  }
  throw new Error(`Font name missing: ${nameId}`)
}
function codePoints(bytes: Buffer): Set<number> {
  const cmap = table(bytes, "cmap"), points = new Set<number>()
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.readUInt32BE(8 + i * 8), format = cmap.readUInt16BE(sub)
    if (format === 4) {
      const segments = cmap.readUInt16BE(sub + 6) / 2
      const rangeBase = sub + 16 + segments * 6
      for (let j = 0; j < segments; j++) {
        const start = cmap.readUInt16BE(sub + 16 + segments * 2 + j * 2)
        const end = cmap.readUInt16BE(sub + 14 + j * 2)
        const delta = cmap.readInt16BE(sub + 16 + segments * 4 + j * 2)
        const range = cmap.readUInt16BE(rangeBase + j * 2)
        for (let point = start; point <= Math.min(end, 65534); point++) {
          let glyph = range ? cmap.readUInt16BE(rangeBase + j * 2 + range + (point - start) * 2) : (point + delta) & 65535
          if (range && glyph) glyph = (glyph + delta) & 65535
          if (glyph) points.add(point)
        }
      }
    } else if (format === 12) {
      for (let j = 0; j < cmap.readUInt32BE(sub + 12); j++) {
        const offset = sub + 16 + j * 12, start = cmap.readUInt32BE(offset), end = cmap.readUInt32BE(offset + 4)
        const glyph = cmap.readUInt32BE(offset + 8)
        for (let point = start; point <= end; point++) if (glyph + point - start) points.add(point)
      }
    }
  }
  return points
}

describe("bundled Animal Island fonts", () => {
  it.each(manifest.faces)("normalizes $file into the declared family and weight with the complete OFL", face => {
    const bytes = readFileSync(new URL(face.file, folder))
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(face.sha256)
    expect(bytes.readUInt32BE(0)).toBe(0x00010000)
    expect(name(bytes, 1)).toBe(face.family)
    expect(name(bytes, 16)).toBe(face.family)
    expect(name(bytes, 2)).toBe(face.style)
    expect(name(bytes, 17)).toBe(face.style)
    expect(table(bytes, "OS/2").readUInt16BE(4)).toBe(face.weight)
    expect(table(bytes, "head").readUInt16BE(18)).toBe(1000)
    const license = readFileSync(new URL(face.license, folder), "utf8")
    // Git may check out text licences with CRLF on Windows; the binary font
    // retains LF. Check both checkout forms without trimming or changing any
    // of the complete OFL's wording, blank lines, or other whitespace.
    for (const checkoutLicense of [license, license.replace(/\r?\n/g, "\r\n")]) {
      expect(name(bytes, 13)).toBe(checkoutLicense.replace(/\r\n/g, "\n"))
    }
    expect(name(bytes, 0)).toContain(face.family.includes("Nunito") ? "Nunito Project Authors" : "Adobe")
    const points = codePoints(bytes)
    expect(points.size).toBe(face.codePoints)
    for (const char of "Animal Island 2026") expect(points.has(char.codePointAt(0)!)).toBe(true)
    if (face.family === ANIMAL_ISLAND_FONT_FAMILIES.cjk) {
      for (const char of "小岛标题图片加载失败密码姓名") expect(points.has(char.codePointAt(0)!)).toBe(true)
      expect([...points].filter(point => point >= 0x4e00 && point <= 0x9fff).length).toBeGreaterThan(7000)
    }
  })

  it("registers all six faces once per renderer and activates the family only after successful loading", () => {
    const observed: (string | undefined)[] = []
    const renderer = { applyBatch: () => [], loadFontBytes: vi.fn(() => { observed.push(fonts.sans) }) }
    expect(fonts.sans).toBeUndefined()
    loadAnimalIslandFonts(renderer)
    expect(renderer.loadFontBytes).toHaveBeenCalledTimes(6)
    expect(observed).toEqual(Array(6).fill(undefined))
    expect(fonts.sans).toBe(ANIMAL_ISLAND_FONT_FAMILIES.sans)
    for (const [bytes] of renderer.loadFontBytes.mock.calls as unknown as [Buffer][]) expect(bytes.readUInt32BE(0)).toBe(0x00010000)
    loadAnimalIslandFonts(renderer)
    expect(renderer.loadFontBytes).toHaveBeenCalledTimes(6)
    const second = { applyBatch: () => [], loadFontBytes: vi.fn() }
    loadAnimalIslandFonts(second)
    expect(second.loadFontBytes).toHaveBeenCalledTimes(6)
  })

  it("keeps the system default when loading is unavailable or fails, and permits a later retry", () => {
    loadAnimalIslandFonts(null)
    loadAnimalIslandFonts({ applyBatch: () => [] })
    expect(fonts.sans).toBeUndefined()
    const renderer = { applyBatch: () => [], loadFontBytes: vi.fn(() => { throw new Error("font unavailable") }) }
    expect(() => loadAnimalIslandFonts(renderer)).toThrow("font unavailable")
    expect(fonts.sans).toBeUndefined()
    renderer.loadFontBytes.mockImplementation(() => {})
    loadAnimalIslandFonts(renderer)
    expect(renderer.loadFontBytes).toHaveBeenCalledTimes(7)
    expect(fonts.sans).toBe(ANIMAL_ISLAND_FONT_FAMILIES.sans)
  })

  it("registers in root setup before the first host batch can paint the named family", () => {
    let registrations = 0
    const host = mountHost(defineComponent({
      setup() {
        loadAnimalIslandFonts(useGpuix().renderer)
        return () => h("text", { style: { fontFamily: fonts.sans } }, "Animal 小岛")
      },
    }), {
      loadFontBytes: () => { registrations++ },
      applyBatch: () => { expect(registrations).toBe(6); return [] },
    })
    try {
      expect(host.find(node => node.type === "text").props.style).toMatchObject({ fontFamily: ANIMAL_ISLAND_FONT_FAMILIES.sans })
    } finally { host.unmount() }
  })
})
