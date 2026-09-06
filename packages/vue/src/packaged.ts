/** Packaged-app awareness.
 *
 * A product built by `@gpuiv/packager` is one bun-compiled executable: JS,
 * assets and the native binding all live inside it. These helpers let an app
 * tell that context apart from `bun --hot` development and locate the
 * read-only resources the packager copied next to the binary.
 *
 * User state (settings, caches, databases) does NOT belong in the resources
 * directory — it is shipped data. Apps should keep writing under their own
 * `~`-based paths as they do in development. */

import path from "node:path"

/** True when running inside a bun-compiled executable produced by
 * `@gpuiv/packager` (or any `bun build --compile` product). */
export function isPackaged(): boolean {
  // globalThis probe, not the `Bun` global type: this package also compiles
  // under a plain node tsconfig. `isStandaloneExecutable` only exists on
  // bun ≥1.4; on 1.3.x the compiled entry lives in the $bunfs virtual
  // filesystem, which is the version-independent signal.
  const bun = globalThis as unknown as { Bun?: { isStandaloneExecutable?: boolean; main?: string } }
  if (bun.Bun?.isStandaloneExecutable === true) return true
  return typeof bun.Bun?.main === "string" && bun.Bun.main.startsWith("/$bunfs")
}

export interface ResourcesPathInput {
  execPath: string
  platform: NodeJS.Platform
  cwd: string
  packaged: boolean
}

/** Pure core of `resourcesPath`, separated for tests.
 *
 * - packaged macOS: `<exe>/../../Resources` (the exe is
 *   `Foo.app/Contents/MacOS/Foo`)
 * - packaged Windows/Linux: `resources/` beside the exe (portable folder)
 * - development: the process working directory
 *
 * Path semantics follow `input.platform` (win32 paths on posix would
 * otherwise collapse to the cwd), matching how the function behaves when it
 * runs natively on each platform. */
export function resolveResourcesPath(input: ResourcesPathInput): string {
  if (!input.packaged) return input.cwd
  const paths = input.platform === "win32" ? path.win32 : path.posix
  const exeDir = paths.dirname(input.execPath)
  if (input.platform === "darwin") {
    return paths.resolve(exeDir, "..", "Resources")
  }
  return paths.join(exeDir, "resources")
}

/** Directory holding the app's shipped read-only resources
 * (`extraResources` in `gpuiv.package.ts`). */
export function resourcesPath(): string {
  return resolveResourcesPath({
    execPath: process.execPath,
    platform: process.platform,
    cwd: process.cwd(),
    packaged: isPackaged(),
  })
}
