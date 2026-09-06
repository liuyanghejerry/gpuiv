/** Compile the app into a standalone executable with `Bun.build`.
 *
 * JS, assets (`import … with { type: 'file' }`) and the pinned `.node`
 * binding all end up inside the executable's embedded filesystem; the first
 * run extracts the binding to a content-hashed temp file and reuses it.
 * The linked sourcemap is embedded and applied to crash stacks
 * automatically (bun ≥1.4; on ≤1.3 it lands beside the exe and the packager
 * relocates it out of the product). */

import path from "node:path"
import type { PackageConfig } from "./config.js"
import type { TargetSpec } from "./targets.js"

export interface BundleOptions {
  config: PackageConfig
  spec: TargetSpec
  entry: string
  shimPath: string
  outfile: string
}

/** Cross-compilation downloads the target bun runtime; a stalled download
 * must fail the build instead of hanging the job for hours. */
const BUNDLE_TIMEOUT_MS = 10 * 60_000

export async function bundleApp(opts: BundleOptions): Promise<void> {
  const result = (await Promise.race([
    Bun.build(buildOptions(opts)),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`bun build exceeded ${BUNDLE_TIMEOUT_MS / 1000}s (stalled runtime download?)`)),
        BUNDLE_TIMEOUT_MS,
      ).unref(),
    ),
  ])) as Awaited<ReturnType<typeof Bun.build>>
  if (!result.success) {
    throw new Error(`bun build --compile failed for ${opts.spec.name}:\n${result.logs.join("\n")}`)
  }
}

/** The `windows` sub-object of Bun's compile options (icon optional). */
interface WindowsCompileOptions {
  icon?: string
  hideConsole: boolean
  title: string
  publisher: string
  version: string
  description: string
}

function buildOptions(opts: BundleOptions): Parameters<typeof Bun.build>[0] {
  const isWindowsHost = process.platform === "win32"
  // Assembled conditionally: an `icon: undefined` key still trips Bun's
  // "windows.icon must be a valid path" validation, so the key must be
  // absent — not undefined — when no icon is available.
  const windows: WindowsCompileOptions = {
    hideConsole: true,
    title: opts.config.productName,
    publisher: opts.config.publisher ?? opts.config.bundleId,
    version: normalizeWindowsVersion(opts.config.version),
    description: opts.config.description ?? opts.config.productName,
    ...(opts.config.icon?.win32 ? { icon: opts.config.icon.win32 } : {}),
  }
  return {
    entrypoints: [opts.entry],
    // The host build compiles for the host bun; foreign targets use the
    // explicit cross spellings, which download the target bun runtime.
    target: isHostBuild(opts.spec) ? "bun" : opts.spec.bunTarget,
    compile: {
      outfile: opts.outfile,
      ...(opts.spec.platform === "win32" && isWindowsHost ? { windows } : {}),
    },
    plugins: [
      {
        name: "gpuiv-native-pin",
        setup(build) {
          build.onResolve({ filter: /^@gpuiv\/native$/ }, () => ({ path: opts.shimPath }))
        },
      },
    ],
    minify: true,
    // No bytecode: bun ≤1.3.14 parses bytecode bundles as CJS, which breaks
    // apps with top-level await ("await can only be used inside an async
    // function"). Revisit on bun ≥1.4, where ESM bytecode is supported.
    sourcemap: "linked",
    define: buildDefines(opts.config),
  }
}

/** Build-time constants baked into the product. The updater reads them from
 * `process.env.GPUIV_*` — define-injected, so a compromised feed can never
 * change what the app trusts. */
function buildDefines(config: PackageConfig): Record<string, string> {
  const defines: Record<string, string> = {
    "process.env.NODE_ENV": '"production"',
    "process.env.GPUIV_APP_VERSION": JSON.stringify(config.version),
    "process.env.GPUIV_APP_BUNDLE_ID": JSON.stringify(config.bundleId),
  }
  if (config.updateFeedUrl) {
    defines["process.env.GPUIV_UPDATE_FEED_URL"] = JSON.stringify(config.updateFeedUrl)
    defines["process.env.GPUIV_UPDATE_CHANNEL"] = JSON.stringify(config.updateChannel ?? "stable")
  }
  if (config.updatePublicKeys?.length) {
    defines["process.env.GPUIV_UPDATE_PUBLIC_KEYS"] = JSON.stringify(config.updatePublicKeys.join(","))
  }
  return defines
}

function isHostBuild(spec: TargetSpec): boolean {
  return spec.platform === process.platform && spec.bunTarget.endsWith(hostArchSuffix())
}

function hostArchSuffix(): string {
  switch (process.arch) {
    case "x64":
      return "x64"
    case "arm64":
      return "arm64"
    default:
      return process.arch
  }
}

/** Windows version-info wants 4 dot-separated numeric parts. */
export function normalizeWindowsVersion(version: string): string {
  const parts = version.split(".")
  while (parts.length < 4) parts.push("0")
  return parts
    .map((p) => (/^\d+$/.test(p) ? p : "0"))
    .slice(0, 4)
    .join(".")
}

/** Where the compiled executable lands for a target. */
export function executableLayout(opts: {
  outDir: string
  productName: string
  spec: TargetSpec
}): { exePath: string; productDir: string } {
  if (opts.spec.platform === "darwin") {
    const app = path.join(opts.outDir, `${opts.productName}.app`)
    return { exePath: path.join(app, "Contents", "MacOS", opts.productName), productDir: app }
  }
  if (opts.spec.platform === "win32") {
    const dir = path.join(opts.outDir, `${opts.productName}-${opts.spec.name}`)
    const exe = process.platform === "win32" ? `${opts.productName}.exe` : opts.productName
    return { exePath: path.join(dir, exe), productDir: dir }
  }
  const dir = path.join(opts.outDir, `${opts.productName}-${opts.spec.name}`)
  return { exePath: path.join(dir, opts.productName), productDir: dir }
}
