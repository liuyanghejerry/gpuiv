/** CLI: `gpuiv-packager build [--config <path>] [--target <name>]…
 * [--node-path <path>] [--out <dir>] [--no-smoke] [--smoke-timeout <ms>]` */

import { buildPackage } from "./index.js"
import { TARGETS } from "./targets.js"

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0]
  if (command !== "build" || argv.includes("--help") || argv.includes("-h")) {
    printUsage()
    return command === "build" ? 0 : 1
  }

  const flags = parseFlags(argv.slice(1))
  try {
    const results = await buildPackage({
      configPath: flags.config,
      targets: flags.target,
      nodePath: flags["node-path"],
      outDir: flags.out,
      smoke: !flags["no-smoke"],
      smokeTimeoutMs: flags["smoke-timeout"] ? Number(flags["smoke-timeout"]) : undefined,
    })
    console.log(`\n[gpuiv-packager] ${results.length} artifact(s):`)
    for (const result of results) {
      const smoke = result.smokeScreenshot ? `smoke ✓` : `no smoke`
      console.log(`  ${result.artifactZip} (${result.artifactMb} MB, ${smoke})`)
    }
    return 0
  } catch (error) {
    console.error(`\n[gpuiv-packager] FAILED: ${error instanceof Error ? error.message : error}`)
    return 1
  }
}

/** Flags that stand alone (`--no-smoke`) rather than taking a value. */
const BOOLEAN_FLAGS = new Set(["no-smoke"])

function parseFlags(args: string[]): Record<string, string | string[]> {
  const flags: Record<string, string | string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}"`)
    const key = arg.slice(2)
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = "true"
      continue
    }
    const value = args[i + 1]
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Flag --${key} needs a value`)
    }
    i++
    if (key === "target") {
      const existing = flags[key]
      flags[key] = Array.isArray(existing) ? [...existing, value] : existing ? [existing, value] : [value]
    } else {
      flags[key] = value
    }
  }
  return flags
}

function printUsage(): void {
  console.log(`gpuiv-packager — package a GPUIV app for distribution

Usage:
  gpuiv-packager build [flags]

Flags:
  --config <path>        config file (default: ./gpuiv.package.ts|js|json)
  --target <name>        target to build, repeatable
                        (${Object.keys(TARGETS).join(", ")}; default: host)
  --node-path <path>     explicit .node binding for the target
  --out <dir>            output directory (default: dist/package)
  --no-smoke             skip the packaged-app smoke test
  --smoke-timeout <ms>   smoke test timeout (default from config)`)
}
