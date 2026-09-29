/** Linux product finishing. The product is one self-contained executable
 * (bun compile embeds the runtime); it ships as a gzip tarball so the
 * download extracts to a named directory. AppImage remains P2
 * (docs/packaging-plan.md): it needs linuxdeploy on a Linux host, which the
 * macOS/Windows packaging hosts cannot provide. */

import { rmSync } from "node:fs"
import path from "node:path"

import { run } from "./run.js"

export function tarLinux(opts: { productDir: string; tarPath: string }): void {
  rmSync(opts.tarPath, { force: true })
  // bsdtar (macOS) and GNU tar (Linux) agree on these flags; the directory
  // basename becomes the top-level entry, so extraction is self-contained.
  run("tar", [
    "-czf",
    opts.tarPath,
    "-C",
    path.dirname(opts.productDir),
    path.basename(opts.productDir),
  ])
}
