/** Build targets: the mapping between a package target name, the Bun compile
 * target, and the napi-rs binary that must be pinned into the bundle.
 *
 * Bun target spellings follow `bun build --target` (`bun-darwin-arm64`, …).
 * Windows products must be built on a Windows host: the icon and version-info
 * flags call Windows APIs at build time and silently degrade when
 * cross-compiled. Every other target cross-compiles fine from any host. */

import { existsSync } from "node:fs"
import path from "node:path"

export interface TargetSpec {
  /** Package target name, e.g. `darwin-arm64`. Also the artifact suffix. */
  name: string
  /** `Bun.build` target: `bun` for the host build, `bun-<target>` to cross. */
  bunTarget: string
  platform: NodeJS.Platform
  nodeFile: string
  /** Optional-dependency package carrying `nodeFile` for foreign hosts. */
  nodePackage: string
  /** When set, building this target is refused unless `process.platform`
   * matches — the Windows icon/metadata flags need host Windows APIs. */
  requireHost?: NodeJS.Platform
}

export const TARGETS: Record<string, TargetSpec> = {
  "darwin-arm64": {
    name: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    platform: "darwin",
    nodeFile: "gpuiv-native.darwin-arm64.node",
    nodePackage: "@gpuiv/native-darwin-arm64",
  },
  "darwin-x64": {
    name: "darwin-x64",
    bunTarget: "bun-darwin-x64",
    platform: "darwin",
    nodeFile: "gpuiv-native.darwin-x64.node",
    nodePackage: "@gpuiv/native-darwin-x64",
  },
  "win32-x64": {
    name: "win32-x64",
    bunTarget: "bun-windows-x64",
    platform: "win32",
    nodeFile: "gpuiv-native.win32-x64-msvc.node",
    nodePackage: "@gpuiv/native-win32-x64-msvc",
    requireHost: "win32",
  },
  "win32-arm64": {
    name: "win32-arm64",
    bunTarget: "bun-windows-arm64",
    platform: "win32",
    nodeFile: "gpuiv-native.win32-arm64-msvc.node",
    nodePackage: "@gpuiv/native-win32-arm64-msvc",
    requireHost: "win32",
  },
  "linux-x64": {
    name: "linux-x64",
    bunTarget: "bun-linux-x64",
    platform: "linux",
    nodeFile: "gpuiv-native.linux-x64-gnu.node",
    nodePackage: "@gpuiv/native-linux-x64-gnu",
  },
  "linux-arm64": {
    name: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    platform: "linux",
    nodeFile: "gpuiv-native.linux-arm64-gnu.node",
    nodePackage: "@gpuiv/native-linux-arm64-gnu",
  },
}

export function getTarget(name: string): TargetSpec {
  const spec = TARGETS[name]
  if (!spec) {
    throw new Error(`Unknown target "${name}". Known targets: ${Object.keys(TARGETS).join(", ")}`)
  }
  if (spec.requireHost && process.platform !== spec.requireHost) {
    throw new Error(
      `Target "${name}" must be built on ${spec.requireHost}: the Windows icon/version metadata is written with host Windows APIs and cannot be cross-compiled. Build it in the package-windows CI job.`,
    )
  }
  return spec
}

/** Find `<file>` inside `<packageName>` by walking up from the app directory,
 * the way a resolver would — the packager must resolve against the *app's*
 * dependency tree (its own isolated node_modules does not carry the app's
 * packages). */
export function resolveFromApp(
  configDir: string,
  packageName: string,
  file: string,
): string | null {
  let dir = configDir
  for (;;) {
    const candidate = path.join(dir, "node_modules", packageName, file)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Resolve the napi binary for a target.
 *
 * Order: explicit `--node-path`, the workspace/local `@gpuiv/native` build
 * (repo development and CI, where the bindings artifact is downloaded into
 * `packages/native/`), then the published per-platform optional package
 * (how end-user apps get foreign targets). */
export function resolveNodeFile(
  spec: TargetSpec,
  opts: { explicitPath?: string; configDir: string },
): string {
  if (opts.explicitPath) return path.resolve(opts.explicitPath)
  const searched: string[] = []
  for (const packageName of ["@gpuiv/native", spec.nodePackage]) {
    const resolved = resolveFromApp(opts.configDir, packageName, spec.nodeFile)
    if (resolved) return resolved
    searched.push(`${packageName}/${spec.nodeFile}`)
  }
  throw new Error(
    `Could not find ${spec.nodeFile} for target ${spec.name}. Searched node_modules from ${opts.configDir} upward for:\n` +
      searched.map((s) => `  - ${s}`).join("\n") +
      `\nBuild packages/native for this target, install ${spec.nodePackage}, or pass --node-path.`,
  )
}
