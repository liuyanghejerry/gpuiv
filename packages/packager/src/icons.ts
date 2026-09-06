/** Dev-machine icon generation — NOT part of packaging.
 *
 * `buildAppIcons` rasterizes a source SVG into the two files the packager
 * consumes (`AppIcon.icns`, `app-icon.ico`). It needs macOS tooling
 * (`rsvg-convert` from librsvg, `sips`, `iconutil`), which is why it lives
 * outside the package pipeline: CI packages with pre-generated icons and
 * never installs icon tools. The `.ico` writer is pure TypeScript (PNG-in-ICO
 * containers, supported since Vista) so no ImageMagick is required. */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { run } from "./run.js"

const ICO_SIZES = [16, 32, 48, 64, 128, 256]

export interface AppIcons {
  png: string
  ico: string
  icns?: string
}

export async function buildAppIcons(opts: {
  svg: string
  outDir: string
  /** Background fill behind the glyph, e.g. `#10a37f`. Default transparent. */
  background?: string
  /** Replacement for `fill="currentColor"` in the SVG. Default `#ffffff`. */
  color?: string
}): Promise<AppIcons> {
  mkdirSync(opts.outDir, { recursive: true })
  const color = opts.color ?? "#ffffff"

  const svg = await Bun.file(opts.svg).text()
  const colored = path.join(opts.outDir, "app-icon.svg")
  await Bun.write(colored, svg.replace(/fill="currentColor"/g, `fill="${color}"`))

  const png = path.join(opts.outDir, "app-icon.png")
  const rasterArgs = ["-w", "1024", "-h", "1024", colored, "-o", png]
  if (opts.background) rasterArgs.splice(0, 0, "--background-color", opts.background)
  run("rsvg-convert", rasterArgs)

  const ico = path.join(opts.outDir, "app-icon.ico")
  writeIcoFromPng(png, ico, ICO_SIZES)
  console.log(`[gpuiv-icons] wrote ${ico}`)

  const icons: AppIcons = { png, ico }
  if (process.platform === "darwin") {
    icons.icns = buildIcns(png, path.join(opts.outDir, "app-icon.icns"))
  }
  return icons
}

function writeIcoFromPng(png: string, ico: string, sizes: number[]): void {
  const entries = sizes.map((size) => {
    const tmp = `${ico}.tmp-${size}.png`
    run("sips", ["-z", String(size), String(size), png, "--out", tmp])
    return { size, data: readFileSync(tmp) }
  })
  writeFileSync(ico, writeIco(entries.map((entry) => entry.data)))
  for (const entry of entries) rmSync(`${ico}.tmp-${entry.size}.png`, { force: true })
}

/** Pack PNG buffers into an ICO container. Sizes are inferred from the
 * entries; a 256px entry uses the 0 placeholder byte per the format. */
export function writeIco(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)

  const dimensions = pngs.map((png) => pngDimensions(png))
  const entrySize = 16
  const dataOffset = 6 + entrySize * pngs.length
  const entries = Buffer.alloc(entrySize * pngs.length)
  let offset = dataOffset
  pngs.forEach((png, i) => {
    const base = i * entrySize
    const dim = dimensions[i]
    entries.writeUInt8(dim >= 256 ? 0 : dim, base)
    entries.writeUInt8(dim >= 256 ? 0 : dim, base + 1)
    entries.writeUInt8(0, base + 2) // palette color count
    entries.writeUInt8(0, base + 3) // reserved
    entries.writeUInt16LE(1, base + 4) // color planes
    entries.writeUInt16LE(32, base + 6) // bits per pixel
    entries.writeUInt32LE(png.length, base + 8)
    entries.writeUInt32LE(offset, base + 12)
    offset += png.length
  })

  return Buffer.concat([header, entries, ...pngs])
}

/** PNG dimensions live in the IHDR chunk, bytes 16-24 of the file. */
function pngDimensions(png: Buffer): number {
  return png.readUInt32BE(16)
}

function buildIcns(png: string, icns: string): string {
  const iconset = `${icns}.iconset`
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const sizes: [number, string][] = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ]
  for (const [px, name] of sizes) {
    run("sips", ["-z", String(px), String(px), png, "--out", path.join(iconset, name)])
  }
  run("iconutil", ["-c", "icns", iconset, "-o", icns])
  rmSync(iconset, { recursive: true, force: true })
  console.log(`[gpuiv-icons] wrote ${icns}`)
  return icns
}
