/** Publish and promote — the write side of the update feed
 * (docs/auto-update-plan.md).
 *
 * Layout under the product prefix:
 *
 *   releases/<version>/<artifact>.zip          immutable, signed
 *   releases/<version>/<artifact>.zip.sig      detached ed25519 signature
 *   releases/<version>/manifest-<target>.json  per-platform fragment,
 *                                              written by the CI job that
 *                                              built that target
 *   releases/<version>/release.json            merged manifest, written
 *                                              once by promote
 *   <channel>.json                             the ONE mutable pointer
 *
 * Platform jobs run `publish` concurrently without touching the pointer;
 * a final `promote` merges fragments and flips the channel. That single-
 * writer rule is what keeps two CI jobs from dropping each other's
 * platforms out of the feed. */

import { createHash, createPrivateKey, createPublicKey } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { loadConfig } from "./config.js"
import { getTargetSpec } from "./targets.js"
import { loadPrivateKey, parsePublicKey, publicKeyId, signBuffer } from "./keys.js"
import { resolveS3Config, S3Store, type S3EnvConfig } from "./s3.js"

export interface ReleasePlatformEntry {
  url: string
  size: number
  sha256: string
  signature: string
}

export interface ReleaseManifest {
  name: string
  version: string
  notes: string
  pubDate: string
  minimumAutoupdateVersion: string
  platforms: Record<string, ReleasePlatformEntry>
}

export interface ChannelPointer {
  channel: string
  release: string
  releaseUrl: string
}

export interface PublishArgs {
  configPath?: string
  outDir?: string
  targets: string[]
  channel: string
  notes?: string
  privateKeyPath?: string
  s3?: Partial<S3EnvConfig>
}

export async function publishRelease(args: PublishArgs): Promise<void> {
  const { config } = await loadConfig(args.configPath)
  if (args.outDir) config.outDir = path.resolve(args.outDir)
  if (!config.updatePublicKeys?.length) {
    throw new Error(
      "updatePublicKeys is not set in the packaging config — publish refuses to produce an unsigned feed. Add the ed25519 public key (see `gpuiv-packager keygen`).",
    )
  }

  const privateKeyPem = loadPrivateKey(process.env.GPUIV_UPDATE_PRIVATE_KEY, args.privateKeyPath)
  const signerId = publicKeyId(
    createPublicKey(createPrivateKey(privateKeyPem)),
  )
  if (!config.updatePublicKeys.some((key) => publicKeyId(parsePublicKey(key)) === signerId)) {
    throw new Error(
      "The private key does not match any updatePublicKeys entry in the config. Fix the config or use the matching key.",
    )
  }

  const store = new S3Store({ ...resolveS3Config(args.s3) })
  const version = config.version
  const notes = args.notes ?? config.releaseNotes ?? ""
  const pubDate = new Date().toISOString()

  for (const targetName of args.targets) {
    const spec = getTargetSpec(targetName)
    if (spec.platform === "linux") {
      console.warn(`[gpuiv-packager] skipping ${targetName}: linux products are folders, not zips (update support is P2)`)
      continue
    }
    const zipName = `${sanitize(config.productName)}-${targetName}.zip`
    const zipPath = path.join(config.outDir, zipName)
    if (!existsSync(zipPath)) {
      throw new Error(`Artifact not found: ${zipPath}. Build it first (bun run package --target ${targetName}).`)
    }
    const bytes = readFileSync(zipPath)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const signature = signBuffer(bytes, privateKeyPem)

    const key = `releases/${version}`
    await store.put(`${key}/${zipName}`, bytes, { contentType: "application/zip", cacheControl: immutableCache })
    await store.put(`${key}/${zipName}.sig`, signature, { contentType: "text/plain", cacheControl: immutableCache })
    console.log(`[gpuiv-packager] published ${zipName} (${Math.round(bytes.length / 1024 / 1024)} MB)`)

    const fragment: ReleaseManifest = {
      name: version,
      version,
      notes,
      pubDate,
      minimumAutoupdateVersion: config.updateMinimumAutoupdateVersion ?? "0.0.0",
      platforms: {
        [targetName]: {
          url: store.url(`${key}/${zipName}`),
          size: bytes.length,
          sha256,
          signature,
        },
      },
    }
    await store.put(`${key}/manifest-${targetName}.json`, JSON.stringify(fragment, null, 2) + "\n", {
      contentType: "application/json",
      cacheControl: immutableCache,
    })
    console.log(`[gpuiv-packager] fragment releases/${version}/manifest-${targetName}.json`)
  }
}

export interface PromoteArgs {
  version: string
  channel: string
  targets: string[]
  s3?: Partial<S3EnvConfig>
}

export async function promoteRelease(args: PromoteArgs): Promise<void> {
  const store = new S3Store({ ...resolveS3Config(args.s3) })
  const releaseKey = `releases/${args.version}`
  let manifest: ReleaseManifest | null = null
  for (const targetName of args.targets) {
    const bytes = await store.get(`${releaseKey}/manifest-${targetName}.json`)
    if (!bytes) {
      throw new Error(
        `Missing fragment releases/${args.version}/manifest-${targetName}.json — did every platform job publish before promote?`,
      )
    }
    const fragment = JSON.parse(bytes.toString("utf8")) as ReleaseManifest
    if (!manifest) {
      manifest = fragment
    } else {
      for (const field of ["version", "notes", "pubDate", "minimumAutoupdateVersion"] as const) {
        if (manifest[field] !== fragment[field]) {
          throw new Error(
            `Fragment mismatch for ${field}: "${manifest[field]}" vs "${fragment[field]}" — publish all targets from the same commit.`,
          )
        }
      }
      manifest.platforms = { ...manifest.platforms, ...fragment.platforms }
    }
  }
  if (!manifest) throw new Error("promote needs at least one --target")

  await store.put(`${releaseKey}/release.json`, JSON.stringify(manifest, null, 2) + "\n", {
    contentType: "application/json",
    cacheControl: immutableCache,
  })
  const pointer: ChannelPointer = {
    channel: args.channel,
    release: args.version,
    releaseUrl: store.url(`${releaseKey}/release.json`),
  }
  await store.put(`${args.channel}.json`, JSON.stringify(pointer, null, 2) + "\n", {
    contentType: "application/json",
    cacheControl: "public, max-age=60",
  })
  console.log(
    `[gpuiv-packager] promoted ${args.version} (${Object.keys(manifest.platforms).join(", ")}) → ${args.channel}.json`,
  )
}

const immutableCache = "public, max-age=31536000, immutable"

function sanitize(name: string): string {
  return name.replace(/\s+/g, "-")
}
