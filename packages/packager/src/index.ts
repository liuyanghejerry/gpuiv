/** @gpuiv/packager — turn a GPUIV app into a distributable desktop product.
 *
 * One command per target:
 *
 *   1. resolve the napi binary for the target and stage the binding shim
 *   2. `Bun.build({ compile })` — JS, assets and the pinned `.node` end up
 *      inside one executable
 *   3. organize the product (macOS `.app` / Windows portable folder)
 *   4. zip it
 *   5. smoke-test the packaged artifact through the automation protocol
 *
 * See docs/packaging-plan.md for the design record. */

import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { defaultHostTargetName, loadConfig, type PackageConfig, type ResolvedConfig } from "./config.js"
import { bundleApp, executableLayout } from "./bundle.js"
import { stageBindingShim } from "./shim.js"
import { resolveNodeFile, getTarget, TARGETS, type TargetSpec } from "./targets.js"
import { wrapMacApp, zipDarwin } from "./macos.js"
import { organizeWindowsProduct, zipWindows } from "./windows.js"
import { smokeTest } from "./smoke.js"

export { defaultHostTargetName, loadConfig } from "./config.js"
export type { PackageConfig, ResolvedConfig } from "./config.js"
export { TARGETS } from "./targets.js"
export { buildAppIcons, writeIco } from "./icons.js"

export interface BuildPackageArgs {
  configPath?: string
  /** Explicit target names; default is `config.targets` or the host target. */
  targets?: string[]
  nodePath?: string
  outDir?: string
  /** Default true. The smoke test also requires a `smokeTestId` in the config. */
  smoke?: boolean
  /** Overrides the config's smokeTimeoutMs. */
  smokeTimeoutMs?: number
}

export interface PackageResult {
  target: string
  productDir: string
  exePath: string
  artifactZip: string
  artifactMb: number
  smokeScreenshot?: string
}

export async function buildPackage(args: BuildPackageArgs): Promise<PackageResult[]> {
  const { config } = await loadConfig(args.configPath)
  if (args.outDir) config.outDir = path.resolve(args.outDir)
  mkdirSync(config.outDir, { recursive: true })
  // Deliberately not wiping outDir: separate invocations per target must not
  // erase each other's artifacts; each build clears its own product below.

  const explicit = (args.targets?.length ?? 0) > 0
  const targets = explicit ? args.targets! : config.targets ?? [defaultHostTargetName()]
  const results: PackageResult[] = []
  for (const name of targets) {
    // A config's default target list names every platform the product ships
    // on; the ones this host cannot build (Windows needs Windows) are a
    // warning, not a failure — CI builds those. An explicit --target stays
    // a hard error so typos never pass silently.
    let spec
    try {
      spec = getTarget(name)
    } catch (error) {
      if (!explicit) {
        console.warn(`[gpuiv-packager] skipping ${name}: ${error instanceof Error ? error.message : error}`)
        continue
      }
      throw error
    }
    results.push(await buildOne(config, spec, args))
  }
  return results
}

async function buildOne(config: ResolvedConfig, spec: TargetSpec, args: BuildPackageArgs): Promise<PackageResult> {
  console.log(`[gpuiv-packager] === ${spec.name} ===`)

  const nodeFile = resolveNodeFile(spec, { explicitPath: args.nodePath, configDir: config.configDir })
  console.log(`[gpuiv-packager] binding: ${nodeFile}`)

  const stagingDir = path.join(config.outDir, ".staging", spec.name)
  const shimPath = stageBindingShim({
    stagingDir,
    nodeFile,
    targetName: spec.name,
    configDir: config.configDir,
  })

  const layout = executableLayout({ outDir: config.outDir, productName: config.productName, spec })
  rmSync(layout.productDir, { recursive: true, force: true })
  mkdirSync(path.dirname(layout.exePath), { recursive: true })

  await bundleApp({ config, spec, entry: config.entry, shimPath, outfile: layout.exePath })
  relocateSourcemaps(layout.productDir, config.outDir, spec.name)
  rmSync(stagingDir, { recursive: true, force: true })
  console.log(`[gpuiv-packager] compiled: ${layout.exePath} (${mb(layout.exePath)} MB)`)

  const zipName = `${sanitize(config.productName)}-${spec.name}.zip`
  const zipPath = path.join(config.outDir, zipName)
  let smokeScreenshot: string | undefined

  if (spec.platform === "darwin") {
    wrapMacApp({ config, appPath: layout.productDir, exePath: layout.exePath })
    zipDarwin({ appPath: layout.productDir, zipPath })
  } else if (spec.platform === "win32") {
    organizeWindowsProduct({ config, productDir: layout.productDir })
    zipWindows({ productDir: layout.productDir, zipPath })
  } else {
    // Linux products ship as the plain folder for now; AppImage is P2.
    console.warn(`[gpuiv-packager] linux target: shipping the folder unpacked (no zip yet)`)
  }

  const smokeEnabled = args.smoke !== false && config.smokeTestId !== null
  if (smokeEnabled && canRunOnHost(spec)) {
    smokeScreenshot = path.join(config.outDir, `smoke-${spec.name}.png`)
    await smokeTest({
      exePath: layout.exePath,
      cwd: path.dirname(layout.productDir),
      testId: config.smokeTestId ?? "app-root",
      timeoutMs: args.smokeTimeoutMs ?? config.smokeTimeoutMs ?? 30_000,
      screenshot: smokeScreenshot,
    })
  } else if (smokeEnabled) {
    console.warn(
      `[gpuiv-packager] smoke skipped for ${spec.name}: the target binary cannot run on this host`,
    )
  }

  console.log(`[gpuiv-packager] artifact: ${zipPath} (${mb(zipPath)} MB)`)
  return {
    target: spec.name,
    productDir: layout.productDir,
    exePath: layout.exePath,
    artifactZip: spec.platform === "linux" ? layout.productDir : zipPath,
    artifactMb: mb(spec.platform === "linux" ? layout.productDir : zipPath),
    smokeScreenshot,
  }
}

/** A darwin-x64 product runs on an arm64 host through Rosetta; a Windows
 * arm64 product does not run on an x64 host at all. */
function canRunOnHost(spec: TargetSpec): boolean {
  if (spec.platform === "darwin") return process.platform === "darwin"
  return spec.platform === process.platform
}

/** With `sourcemap: "linked"`, bun ≤1.3 writes the `.map` next to the
 * executable instead of embedding it (embedding lands in bun 1.4). A map
 * inside `Contents/MacOS/` or the portable folder would ship debug data in
 * the product — keep it beside the artifacts for bug reports instead. */
function relocateSourcemaps(productDir: string, outDir: string, targetName: string): void {
  for (const file of readdirSync(productDir, { recursive: true })) {
    if (typeof file !== "string" || !file.endsWith(".map")) continue
    const from = path.join(productDir, file)
    const to = path.join(outDir, `${targetName}-${path.basename(file)}`)
    renameSync(from, to)
    console.log(`[gpuiv-packager] sourcemap kept out of the product: ${to}`)
  }
}

function sanitize(name: string): string {
  return name.replace(/\s+/g, "-")
}

function mb(file: string): number {
  return Math.round(statSync(file).size / 1024 / 1024)
}
