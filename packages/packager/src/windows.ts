/** Windows product: a portable folder next to the exe, zipped with bsdtar
 * (`tar -a` picks the zip format from the output extension; every Windows 10+
 * host ships it). No registry writes — the folder runs from anywhere, and a
 * future installer must not move anything. */

import { copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { run } from "./run.js"
import type { PackageConfig } from "./config.js"

export function organizeWindowsProduct(opts: { config: PackageConfig; productDir: string }): void {
  const resources = path.join(opts.productDir, "resources")
  mkdirSync(resources, { recursive: true })
  for (const resource of opts.config.extraResources) {
    copyFileSync(resource, path.join(resources, path.basename(resource)))
  }
  if (!opts.config.icon?.win32) {
    console.warn("[gpuiv-packager] no win32 icon configured; the exe will use the generic bun icon")
  }
}

export function zipWindows(opts: { productDir: string; zipPath: string }): void {
  // Compress from the parent so the zip contains the product folder itself.
  // --force-local: bsdtar otherwise parses the drive colon in `D:\…` as a
  // remote host ("Cannot connect to D: resolve failed").
  run(
    "tar",
    ["--force-local", "-a", "-c", "-f", opts.zipPath, path.basename(opts.productDir)],
    { cwd: path.dirname(opts.productDir) },
  )
}
