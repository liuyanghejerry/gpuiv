/** Compile the app into a standalone executable with `Bun.build`.
 *
 * JS, assets (`import … with { type: 'file' }`) and the pinned `.node`
 * binding all end up inside the executable's embedded filesystem; the first
 * run extracts the binding to a content-hashed temp file and reuses it.
 * Bytecode cuts startup on large bundles; the linked sourcemap is embedded
 * and applied to crash stacks automatically. */

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

export async function bundleApp(opts: BundleOptions): Promise<void> {
  const isWindowsHost = process.platform === "win32"
  const result = await Bun.build({
    entrypoints: [opts.entry],
    // The host build compiles for the host bun; foreign targets use the
    // explicit cross spellings, which download the target bun runtime.
    target: isHostBuild(opts.spec) ? "bun" : opts.spec.bunTarget,
    compile: {
      outfile: opts.outfile,
      ...(opts.spec.platform === "win32" && isWindowsHost
        ? {
            windows: {
              icon: opts.config.icon?.win32,
              hideConsole: true,
              title: opts.config.productName,
              publisher: opts.config.publisher ?? opts.config.bundleId,
              version: normalizeWindowsVersion(opts.config.version),
              description: opts.config.description ?? opts.config.productName,
            },
          }
        : {}),
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
    define: { "process.env.NODE_ENV": '"production"' },
  })
  if (!result.success) {
    throw new Error(`bun build --compile failed for ${opts.spec.name}:\n${result.logs.join("\n")}`)
  }
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
  const numeric = parts.map((p) => (/^\d+$/.test(p) ? p : "0")).slice(0, 4)
  return numeric.join(".")
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
