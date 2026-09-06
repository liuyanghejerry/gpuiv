/** CLI entry.
 *
 *   gpuiv-packager build    [--config] [--target]… [--node-path] [--out] [--no-smoke]
 *   gpuiv-packager keygen   [--out <path prefix>]
 *   gpuiv-packager publish  --channel <c> [--target]… [--notes] [--private-key] [s3 flags]
 *   gpuiv-packager promote  --channel <c> --version <v> [--target]… [s3 flags]
 *
 * S3 location flags: --endpoint --region --bucket --prefix (over
 * GPUIV_S3_* / AWS_* env). */

import { writeFileSync } from "node:fs"
import { buildPackage } from "./index.js"
import { generateKeyPair } from "./keys.js"
import { promoteRelease, publishRelease } from "./publish.js"
import { TARGETS } from "./targets.js"

export async function runCli(argv: string[]): Promise<number> {
  const command = argv[0]
  if (!command || argv.includes("--help") || argv.includes("-h")) {
    printUsage()
    return command ? 0 : 1
  }

  try {
    switch (command) {
      case "build": {
        const flags = parseFlags(argv.slice(1), ["no-smoke"])
        const results = await buildPackage({
          configPath: flags.config,
          targets: flagList(flags.target),
          nodePath: flags["node-path"],
          outDir: flags.out,
          smoke: !flags["no-smoke"],
          smokeTimeoutMs: flags["smoke-timeout"] ? Number(flags["smoke-timeout"]) : undefined,
        })
        console.log(`\n[gpuiv-packager] ${results.length} artifact(s):`)
        for (const result of results) {
          const smoke = result.smokeScreenshot ? "smoke ✓" : "no smoke"
          console.log(`  ${result.artifactZip} (${result.artifactMb} MB, ${smoke})`)
        }
        return 0
      }
      case "keygen": {
        const flags = parseFlags(argv.slice(1), [])
        const prefix = flags.out ?? "gpuiv-update-key"
        const pair = generateKeyPair()
        writeFileSync(`${prefix}-private.pem`, pair.privateKeyPem)
        writeFileSync(`${prefix}-public.pem`, pair.publicKeyPem)
        console.log(`[gpuiv-packager] wrote ${prefix}-private.pem / ${prefix}-public.pem`)
        console.log(`\nPublic key for gpuiv.package.ts (updatePublicKeys):\n  ${pair.publicKeyBase64}`)
        console.log(
          `\nKeep the private key in CI secrets (GPUIV_UPDATE_PRIVATE_KEY, PEM string) — never commit it.`,
        )
        return 0
      }
      case "publish": {
        const flags = parseFlags(argv.slice(1), [])
        requireFlags(flags, ["channel"])
        await publishRelease({
          configPath: flags.config,
          outDir: flags.out,
          targets: flagList(flags.target),
          channel: String(flags.channel),
          notes: flags.notes,
          privateKeyPath: flags["private-key"],
          s3: s3Overrides(flags),
        })
        return 0
      }
      case "promote": {
        const flags = parseFlags(argv.slice(1), [])
        requireFlags(flags, ["channel", "version"])
        await promoteRelease({
          channel: String(flags.channel),
          version: String(flags.version),
          targets: flagList(flags.target),
          s3: s3Overrides(flags),
        })
        return 0
      }
      default:
        console.error(`[gpuiv-packager] unknown command "${command}"`)
        printUsage()
        return 1
    }
  } catch (error) {
    console.error(`\n[gpuiv-packager] FAILED: ${error instanceof Error ? error.message : error}`)
    return 1
  }
}

/** Flags that stand alone (`--no-smoke`) rather than taking a value. */
function parseFlags(args: string[], booleanFlags: string[]): Record<string, string | string[]> {
  const flags: Record<string, string | string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}"`)
    const key = arg.slice(2)
    if (booleanFlags.includes(key)) {
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

function requireFlags(flags: Record<string, string | string[]>, names: string[]): void {
  for (const name of names) {
    if (!flags[name]) throw new Error(`--${name} is required`)
  }
}

function flagList(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

type FlagValue = string | string[] | undefined

function s3Overrides(flags: Record<string, string | string[]>): {
  endpoint?: string
  region?: string
  bucket?: string
  prefix?: string
} {
  const overrides: Record<string, string> = {}
  for (const key of ["endpoint", "region", "bucket", "prefix"]) {
    const value = flags[key] as FlagValue
    if (typeof value === "string") overrides[key] = value
  }
  return overrides
}

function printUsage(): void {
  console.log(`gpuiv-packager — package a GPUIV app for distribution

Usage:
  gpuiv-packager build [flags]        compile, wrap, zip, smoke-test
  gpuiv-packager keygen [--out <p>]   generate the ed25519 update-signing key pair
  gpuiv-packager publish [flags]      upload immutable release objects + fragment
  gpuiv-packager promote [flags]      merge fragments, flip the channel pointer

build flags:
  --config <path>        config file (default: ./gpuiv.package.ts|js|json)
  --target <name>        target to build, repeatable
                        (${Object.keys(TARGETS).join(", ")}; default: host)
  --node-path <path>     explicit .node binding for the target
  --out <dir>            output directory (default: dist/package)
  --no-smoke             skip the packaged-app smoke test
  --smoke-timeout <ms>   smoke test timeout (default from config)

publish/promote flags:
  --channel <name>       release channel (required)
  --target <name>        targets this invocation covers, repeatable
  --version <v>          (promote) the release to point the channel at
  --notes <text>         (publish) release notes
  --private-key <path>   signing key file (or GPUIV_UPDATE_PRIVATE_KEY env)
  --endpoint/--region/--bucket/--prefix
                         S3 location (or GPUIV_S3_* / AWS_* env)`)
}
