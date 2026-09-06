/** Packager configuration — `gpuiv.package.ts` (or `.json`) at the app root.
 *
 * The config is app-authored and declarative: everything the packager needs
 * to produce a named, versioned, iconned product on every platform. Paths are
 * resolved against the config file's directory. */

import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve as resolvePath } from "node:path"

export interface PackageConfig {
  /** App entry file (TS/TSX), bundled with `Bun.build({ compile })`. */
  entry: string
  /** Product name. Becomes the executable name, the macOS app-menu title
   * (AppKit takes it from the executable) and `CFBundleExecutable`. */
  productName: string
  /** macOS bundle identifier, e.g. `dev.gpuiv.chat`. */
  bundleId: string
  version: string
  /** Windows version-info publisher. */
  publisher?: string
  /** Windows version-info / macOS plist description. */
  description?: string
  /** Pre-generated icon files. The packager places them, it never generates
   * them (`@gpuiv/packager/icons` has a dev-machine generator). Optional. */
  icon?: { darwin?: string; win32?: string }
  /** `LSMinimumSystemVersion`. Default `13.0` (what GPUI requires). */
  minSystemVersion?: string
  /** Files copied into `Contents/Resources` (macOS) / `resources/` beside the
   * exe (Windows). Read-only shipped data; user state does not belong here. */
  extraResources?: string[]
  /** Extra `Info.plist` keys, merged over the generated ones. */
  mac?: { plist?: Record<string, string | number | boolean> }
  /** Bun target names to build when none are passed on the CLI. */
  targets?: string[]
  /** Output directory, default `dist/package`. */
  outDir?: string
  /** Root `testId` the packaged app must paint before the smoke test passes.
   * Default `'app-root'`; `null` disables the smoke test. */
  smokeTestId?: string | null
  /** Smoke-test timeout in ms. Default 60_000 (generous for Rosetta
   * cold-translation of a cross-compiled x64 product on a fresh runner). */
  smokeTimeoutMs?: number
  /** Auto-update trust anchors (docs/auto-update-plan.md). ed25519 public
   * keys (PEM or Sparkle-style base64 raw), accepted as an array for
   * rotation: sign with the new key, keep the old accepted one cycle.
   * `publish` refuses to sign without them. */
  updatePublicKeys?: string[]
  /** Feed base URL the packaged app polls, e.g.
   * `https://cdn.example.com/chat`. Injected at package time. */
  updateFeedUrl?: string
  /** Channel the product follows. Default `stable`. */
  updateChannel?: string
  /** Oldest version allowed to auto-update to this release (manual install
   * below it). Written into the release manifest. */
  updateMinimumAutoupdateVersion?: string
  /** Release notes for `publish` (or pass `--notes` per invocation). */
  releaseNotes?: string
}

export interface ResolvedConfig extends Omit<PackageConfig, "entry" | "icon" | "outDir" | "extraResources"> {
  configDir: string
  entry: string
  icon: { darwin?: string; win32?: string }
  outDir: string
  extraResources: string[]
}

const CONFIG_BASENAMES = ["gpuiv.package.ts", "gpuiv.package.js", "gpuiv.package.json"]

export function defaultHostTargetName(): string {
  switch (process.platform) {
    case "darwin":
      return process.arch === "x64" ? "darwin-x64" : "darwin-arm64"
    case "win32":
      return process.arch === "x64" ? "win32-x64" : "win32-arm64"
    case "linux":
      return process.arch === "x64" ? "linux-x64" : "linux-arm64"
    default:
      throw new Error(`Unsupported host platform: ${process.platform}`)
  }
}

export async function loadConfig(explicitPath?: string): Promise<{ config: ResolvedConfig; file: string }> {
  let file: string | null = null
  if (explicitPath) {
    file = explicitPath
  } else {
    for (const base of CONFIG_BASENAMES) {
      const candidate = `${process.cwd()}/${base}`
      if (existsSync(candidate)) {
        file = candidate
        break
      }
    }
  }
  if (!file) {
    throw new Error(
      `No packaging config found. Create gpuiv.package.ts (or pass --config). Looked for ${CONFIG_BASENAMES.join(", ")} in ${process.cwd()}`,
    )
  }

  // node:fs, not Bun.file: the packager runs under bun but its unit tests
  // run under vitest/node workers.
  const raw: PackageConfig =
    file.endsWith(".json")
      ? JSON.parse(readFileSync(file, "utf8"))
      : (await import(file)).default
  validate(raw, file)

  const configDir = dirname(file)
  const resolveFrom = (p: string) => (isAbsolute(p) ? p : resolvePath(configDir, p))
  return {
    file,
    config: {
      ...raw,
      configDir,
      entry: resolveFrom(raw.entry),
      icon: {
        darwin: raw.icon?.darwin ? resolveFrom(raw.icon.darwin) : undefined,
        win32: raw.icon?.win32 ? resolveFrom(raw.icon.win32) : undefined,
      },
      outDir: resolveFrom(raw.outDir ?? "dist/package"),
      extraResources: (raw.extraResources ?? []).map(resolveFrom),
      minSystemVersion: raw.minSystemVersion ?? "13.0",
      smokeTimeoutMs: raw.smokeTimeoutMs ?? 60_000,
    },
  }
}

function validate(raw: PackageConfig, file: string): void {
  const problems: string[] = []
  for (const key of ["entry", "productName", "bundleId", "version"] as const) {
    if (!raw[key]) problems.push(`missing required field "${key}"`)
  }
  if (problems.length > 0) {
    throw new Error(`Invalid packaging config ${file}: ${problems.join("; ")}`)
  }
}
