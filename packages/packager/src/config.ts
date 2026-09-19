/** Packager configuration — `gpuiv.package.ts` (or `.json`) at the app root.
 *
 * The config is app-authored and declarative: everything the packager needs
 * to produce a named, versioned, iconned product on every platform. Paths are
 * resolved against the config file's directory. */

import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue }

export interface MacDocumentType {
  name: string
  /** UTIs, e.g. public.plain-text. Declare non-system UTIs in typeDeclarations. */
  contentTypes: string[]
  role?: "Editor" | "Viewer" | "Shell" | "None"
  /** Defaults to Alternate: being an eligible handler does not claim ownership. */
  rank?: "Owner" | "Default" | "Alternate" | "None"
}

export interface MacTypeDeclaration {
  identifier: string
  description?: string
  /** Usually public.text or public.data. */
  conformsTo: string[]
  /** Extensions without a leading dot. */
  extensions: string[]
  mimeTypes?: string[]
  /** Export only formats owned by this app. Other formats are imported. */
  exported?: boolean
}

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
  /** macOS bundle declarations. They do not register Windows/Linux file
   * associations or implement a single-instance lock. */
  mac?: {
    documentTypes?: MacDocumentType[]
    typeDeclarations?: MacTypeDeclaration[]
    /** Extra Info.plist keys, merged over generated keys. Supports nested
     * dictionaries/arrays, e.g. CFBundleURLTypes for deep links. */
    plist?: Record<string, PlistValue>
  }
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
    file = resolvePath(explicitPath)
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
      : (await import(pathToFileURL(file).href)).default
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
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0)
  const identifier = (value: string) => /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)
  for (const key of ["documentTypes", "typeDeclarations"] as const) {
    if (raw.mac?.[key] !== undefined && !Array.isArray(raw.mac[key])) problems.push(`mac.${key} must be an array`)
  }
  for (const type of Array.isArray(raw.mac?.documentTypes) ? raw.mac.documentTypes : []) {
    if (!type || typeof type.name !== "string" || !type.name.trim()
      || !strings(type.contentTypes) || !type.contentTypes.every(identifier)) {
      problems.push("mac.documentTypes require a name and non-empty contentTypes containing UTIs")
    }
    if (type?.role !== undefined && !["Editor", "Viewer", "Shell", "None"].includes(type.role)) problems.push("invalid document type role")
    if (type?.rank !== undefined && !["Owner", "Default", "Alternate", "None"].includes(type.rank)) problems.push("invalid document type rank")
  }
  const identifiers = new Set<string>()
  for (const type of Array.isArray(raw.mac?.typeDeclarations) ? raw.mac.typeDeclarations : []) {
    if (!type || typeof type.identifier !== "string" || !identifier(type.identifier)
      || !strings(type.conformsTo) || !type.conformsTo.every(identifier)
      || !strings(type.extensions) || !type.extensions.every((ext) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(ext))) {
      problems.push("mac.typeDeclarations require a UTI identifier, conformsTo UTIs and extensions without dots")
    }
    if (type?.identifier && identifiers.has(type.identifier)) problems.push(`duplicate type declaration ${type.identifier}`)
    identifiers.add(type?.identifier)
    if (type?.mimeTypes !== undefined && !strings(type.mimeTypes)) problems.push("mimeTypes must be a non-empty string array")
    if (type?.exported !== undefined && typeof type.exported !== "boolean") problems.push("exported must be boolean")
  }
  if (problems.length > 0) {
    throw new Error(`Invalid packaging config ${file}: ${problems.join("; ")}`)
  }
}
