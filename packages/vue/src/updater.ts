/** Self-update engine for packaged apps (docs/auto-update-plan.md).
 *
 * Pure TypeScript: fetch the feed, verify sha256 + an ed25519 signature
 * against keys pinned into the product at package time, swap the app in
 * place, relaunch. No native code — the trust anchor (`process.env.GPUIV_*`
 * constants define-injected by @gpuiv/packager) is what makes the feed
 * untrusted-but-safe.
 *
 * The engine is inert in development: no injected feed URL or not packaged
 * → every action is a no-op or throws a clear error, and `bun --hot` never
 * updates itself. */

import { spawn, spawnSync } from "node:child_process"
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir, platform, arch } from "node:os"
import path from "node:path"
import { isPackaged } from "./packaged.js"

/** Set on the staged exe by the Windows handoff; `finishPendingWindowsUpdate`
 * consumes it at the app entry. */
const FINISH_UPDATE_ENV = "GPUIV_FINISH_UPDATE"

// ── Feed types ────────────────────────────────────────────────────────────

export interface ReleasePlatformEntry {
  url: string
  size: number
  sha256: string
  /** base64 ed25519 signature over the artifact bytes. */
  signature: string
}

export interface ReleaseManifest {
  version: string
  notes?: string
  pubDate?: string
  /** Oldest version allowed to auto-update to this release. */
  minimumAutoupdateVersion?: string
  platforms: Record<string, ReleasePlatformEntry>
}

export interface ChannelPointer {
  channel: string
  release: string
  releaseUrl: string
}

export type UpdateStatus =
  | { state: "up-to-date"; version: string }
  | { state: "update-available"; manifest: ReleaseManifest }
  | { state: "manual-update-required"; manifest: ReleaseManifest }

// ── Pure helpers (exported for tests) ────────────────────────────────────

/** Semver compare with prerelease handling: 1.2.3-rc.1 < 1.2.3, numeric
 * identifiers compare numerically, otherwise lexically. */
export function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = a.replace(/^v/, "").split("-")
  const [bCore, bPre] = b.replace(/^v/, "").split("-")
  const aParts = aCore.split(".").map(Number)
  const bParts = bCore.split(".").map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const delta = (aParts[i] ?? 0) - (bParts[i] ?? 0)
    if (delta !== 0) return delta
  }
  if (aPre === bPre) return 0
  // A prerelease sorts below the release it belongs to.
  if (aPre === undefined) return 1
  if (bPre === undefined) return -1
  const aIds = aPre.split(".")
  const bIds = bPre.split(".")
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const aId = aIds[i]
    const bId = bIds[i]
    if (aId === bId) continue
    const aNum = /^\d+$/.test(aId) ? Number(aId) : null
    const bNum = /^\d+$/.test(bId) ? Number(bId) : null
    if (aNum !== null && bNum !== null) return aNum - bNum
    if (aNum !== null) return -1 // numeric < alphanumeric
    if (bNum !== null) return 1
    return aId < bId ? -1 : 1
  }
  return 0
}

/** The manifest key for this process, matching @gpuiv/packager targets. */
export function platformKey(p: NodeJS.Platform = platform(), a: string = arch()): string {
  const archName = a === "x64" ? "x64" : "arm64"
  if (p === "darwin") return `darwin-${archName}`
  if (p === "win32") return `win32-${archName}`
  return `linux-${archName}`
}

/** Feed decision, separated from the network for tests. */
export function decideUpdate(currentVersion: string, manifest: ReleaseManifest): UpdateStatus {
  const minimum = manifest.minimumAutoupdateVersion ?? "0.0.0"
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return { state: "up-to-date", version: currentVersion }
  }
  if (compareVersions(currentVersion, minimum) < 0) {
    return { state: "manual-update-required", manifest }
  }
  return { state: "update-available", manifest }
}

/** DER SPKI header for an ed25519 public key; prepending it to the raw 32
 * bytes makes a parseable key. (Duplicated from the packager's keys module —
 * @gpuiv/vue cannot depend on @gpuiv/packager.) */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export function parseUpdatePublicKey(key: string): KeyObject {
  const trimmed = key.trim()
  if (trimmed.startsWith("-----")) return createPublicKey(trimmed)
  const raw = Buffer.from(trimmed.replace(/^base64:/, ""), "base64")
  if (raw.length !== 32) throw new Error(`expected a 32-byte ed25519 public key, got ${raw.length} bytes`)
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" })
}

/** Accept when ANY pinned key verifies (rotation: sign with the new key
 * while the old one stays accepted for a cycle). */
export function verifyArtifact(
  bytes: Buffer,
  entry: ReleasePlatformEntry,
  publicKeys: string[],
): boolean {
  const signature = Buffer.from(entry.signature, "base64")
  return publicKeys.some((key) => {
    try {
      return cryptoVerify(null, bytes, parseUpdatePublicKey(key), signature)
    } catch {
      return false
    }
  })
}

// ── Options & defaults ───────────────────────────────────────────────────

export interface UpdaterOptions {
  /** Channel pointer URL (…/stable.json). */
  feedUrl: string
  channel: string
  /** Accepted ed25519 public keys (PEM or base64-raw). */
  publicKeys: string[]
  currentVersion: string
  bundleId: string
}

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "up-to-date"; version: string }
  | { type: "manual-update-required"; version: string }
  | { type: "update-available"; version: string; notes: string }
  | { type: "download-progress"; received: number; total: number; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "applied"; version: string }
  | { type: "error"; message: string }

export interface Updater {
  on(listener: (event: UpdaterEvent) => void): () => void
  checkForUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<string>
  /** Extract, verify once more, swap the product in place, relaunch. */
  applyAndRelaunch(): Promise<never>
  /** Same swap, run synchronously when the process exits. */
  queueApplyOnQuit(): void
}

function defaultOptions(): UpdaterOptions {
  // Read `process.env.X` with literal member expressions: the packager
  // define-injects exactly these, and `const env = process.env` would
  // silently defeat the injection.
  return {
    feedUrl: process.env.GPUIV_UPDATE_FEED_URL ?? "",
    channel: process.env.GPUIV_UPDATE_CHANNEL ?? "stable",
    publicKeys: (process.env.GPUIV_UPDATE_PUBLIC_KEYS ?? "").split(",").filter(Boolean),
    currentVersion: process.env.GPUIV_APP_VERSION ?? "0.0.0",
    bundleId: process.env.GPUIV_APP_BUNDLE_ID ?? "gpuiv-app",
  }
}

// ── Engine ────────────────────────────────────────────────────────────────

export function createUpdater(userOptions: Partial<UpdaterOptions> = {}): Updater {
  const options: UpdaterOptions = { ...defaultOptions(), ...userOptions }
  const listeners = new Set<(event: UpdaterEvent) => void>()
  let pendingManifest: ReleaseManifest | null = null
  let stagedZip: string | null = null

  // Windows update leftovers (the staging dir of the previous handoff, old
  // `.old` files from earlier versions of this engine) are cleaned here,
  // best-effort with a retry — the dying process may still hold locks.
  if (platform() === "win32" && isPackaged() && !process.env[FINISH_UPDATE_ENV]) {
    const tryClean = () => {
      try {
        cleanWindowsLeftovers(path.dirname(process.execPath))
        const staging = windowsStagingDir()
        if (staging) rmSync(staging, { recursive: true, force: true })
      } catch {
        // read-only installs, races — the next launch tries again
      }
    }
    tryClean()
    setTimeout(tryClean, 5_000).unref()
  }

  const emit = (event: UpdaterEvent) => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error("[gpuiv-updater] listener:", error)
      }
    }
  }
  // Annotated on the variable (not just the arrow) so TypeScript treats
  // `fail(...)` calls as never-returning and narrows null checks above.
  const fail: (message: string) => never = (message) => {
    emit({ type: "error", message })
    throw new Error(message)
  }

  const guard = (): void => {
    if (!options.feedUrl) fail("No update feed configured (GPUIV_UPDATE_FEED_URL is unset).")
    if (options.publicKeys.length === 0) fail("No update public keys pinned (GPUIV_UPDATE_PUBLIC_KEYS is unset).")
    if (!isPackaged()) fail("Self-update only applies to packaged apps; development runs never update themselves.")
  }

  return {
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async checkForUpdates() {
      guard()
      emit({ type: "checking" })
      const pointerResponse = await fetch(options.feedUrl, { cache: "no-store" })
      if (!pointerResponse.ok) fail(`Feed fetch failed: ${pointerResponse.status}`)
      const pointer = (await pointerResponse.json()) as ChannelPointer
      if (!pointer?.releaseUrl) fail("Feed pointer has no releaseUrl.")

      const releaseResponse = await fetch(pointer.releaseUrl, { cache: "no-cache" })
      if (!releaseResponse.ok) fail(`Release manifest fetch failed: ${releaseResponse.status}`)
      const manifest = (await releaseResponse.json()) as ReleaseManifest
      if (!manifest?.version || !manifest.platforms) fail("Release manifest is malformed.")

      const status = decideUpdate(options.currentVersion, manifest)
      if (status.state === "update-available") {
        pendingManifest = manifest
        emit({ type: "update-available", version: manifest.version, notes: manifest.notes ?? "" })
      } else if (status.state === "manual-update-required") {
        emit({ type: "manual-update-required", version: manifest.version })
      } else {
        emit({ type: "up-to-date", version: status.version })
      }
      return status
    },

    async downloadUpdate() {
      guard()
      const manifest = pendingManifest
      if (!manifest) fail("checkForUpdates() found nothing to download.")
      const key = platformKey()
      const entry = manifest.platforms[key]
      if (!entry) fail(`The release has no build for ${key}.`)

      const response = await fetch(entry.url)
      if (!response.ok || !response.body) fail(`Artifact download failed: ${response.status}`)

      const stagingDir = path.join(appDataDir(options.bundleId), "updates")
      mkdirSync(stagingDir, { recursive: true })
      const zipPath = path.join(stagingDir, `${manifest.version}-${key}.zip`)

      const chunks: Buffer[] = []
      const hash = createHash("sha256")
      const reader = response.body.getReader()
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        chunks.push(chunk)
        hash.update(chunk)
        received += chunk.length
        const percent = entry.size > 0 ? Math.floor((received / entry.size) * 100) : 0
        emit({ type: "download-progress", received, total: entry.size, percent })
      }

      const bytes = Buffer.concat(chunks)
      if (bytes.length !== entry.size) {
        fail(`Artifact size mismatch: expected ${entry.size}, got ${bytes.length}.`)
      }
      if (hash.digest("hex") !== entry.sha256) {
        fail("Artifact sha256 mismatch; refusing to apply.")
      }
      // The single most important check: the bytes must verify against a key
      // pinned inside this binary, not against anything the feed says.
      if (!verifyArtifact(bytes, entry, options.publicKeys)) {
        fail("Artifact signature rejected by the pinned update keys; refusing to apply.")
      }

      writeFileSync(zipPath, bytes)
      stagedZip = zipPath
      emit({ type: "downloaded", version: manifest.version })
      return zipPath
    },

    async applyAndRelaunch(): Promise<never> {
      const zip = stagedZip ?? fail("downloadUpdate() has not staged an update.")
      const manifest = pendingManifest!
      const exePath = applyUpdateSync(zip, options.bundleId)
      emit({ type: "applied", version: manifest.version })
      // The Windows handoff already spawned its successor (null); relaunch
      // is only ours on platforms that swap in place.
      if (exePath) relaunchExecutable(exePath)
      process.exit(0)
    },

    queueApplyOnQuit() {
      if (!stagedZip) fail("downloadUpdate() has not staged an update.")
      process.on("exit", () => {
        try {
          const exePath = applyUpdateSync(stagedZip!, options.bundleId)
          if (exePath) relaunchExecutable(exePath)
        } catch (error) {
          console.error("[gpuiv-updater] apply-on-quit failed:", error)
        }
      })
    },
  }
}

// ── Apply mechanics ───────────────────────────────────────────────────────

function appDataDir(bundleId: string): string {
  if (platform() === "darwin") {
    return path.join(homedir(), "Library", "Application Support", bundleId)
  }
  if (platform() === "win32") {
    const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming")
    return path.join(appdata, bundleId)
  }
  return path.join(homedir(), ".local", "share", bundleId)
}

/** Extract + swap. Returns the executable to relaunch, or null when the
 * platform's swap already spawned its successor (the Windows handoff).
 * Exported for tests. */
export function applyUpdateSync(zipPath: string, bundleId: string): string | null {
  const exePath = process.execPath
  const exeDir = path.dirname(exePath)

  if (platform() === "darwin") {
    // exePath = Foo.app/Contents/MacOS/Foo
    const bundleRoot = path.resolve(exeDir, "..", "..")
    return applyDarwinSwap(zipPath, bundleRoot)
  }
  if (platform() === "win32") {
    return applyWindowsHandoff(zipPath, exeDir)
  }
  throw new Error("Linux self-update is not implemented (P2).")
}

/** bsdtar reads zip on macOS and Windows 10+ alike — one extraction path,
 * no zip library. `--force-local` (a GNU tar option the Windows bsdtar
 * accepts, macOS's does not) keeps the drive colon in `C:\…` paths from
 * being parsed as a remote host. */
function extractZip(zipPath: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  const args = [...(platform() === "win32" ? ["--force-local"] : []), "-xf", zipPath, "-C", destDir]
  const result = spawnSync("tar", args, { timeout: 120_000 })
  if (result.status !== 0) {
    throw new Error(`Extraction failed (tar ${result.status}): ${result.stderr}`)
  }
}

/** macOS: swap `.app` bundles with two same-volume renames. At every point
 * a complete bundle exists at either the old or the new name; the old
 * bundle is deleted only after the new one is in place. */
export function applyDarwinSwap(zipPath: string, bundleRoot: string): string {
  const installDir = path.dirname(bundleRoot)
  const bundleName = path.basename(bundleRoot) // Foo.app
  const innerName = bundleName.replace(/\.app$/, "")
  const staging = mkdtempSync(path.join(tmpdir(), ".gpuiv-update-"))
  try {
    extractZip(zipPath, staging)
    const extracted = path.join(staging, bundleName)
    if (!existsSync(extracted)) {
      throw new Error(`The update zip does not contain ${bundleName}.`)
    }
    // Same volume (beside the app) so these renames are atomic-per-file.
    const incoming = path.join(installDir, `.${innerName}.app.update`)
    const backup = path.join(installDir, `.${innerName}.app.backup`)
    rmSync(incoming, { recursive: true, force: true })
    rmSync(backup, { recursive: true, force: true })
    renameSync(extracted, incoming)
    if (existsSync(bundleRoot)) renameSync(bundleRoot, backup)
    renameSync(incoming, bundleRoot)
    rmSync(backup, { recursive: true, force: true })
    return path.join(bundleRoot, "Contents", "MacOS", innerName)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Windows apply is a lock-free relay — renaming or overwriting the file of
 * a running executable is not reliable for bun products (the process holds
 * a mapping of its own binary), so nothing ever touches a running file:
 *
 *   old exe: extract the update beside the product, spawn the NEW exe from
 *   there with the finish marker, exit
 *   → new exe (before any UI): copy itself over the product dir, spawn the
 *     product exe without the marker, exit
 *   → product exe v2: runs normally, cleans the staging dir at init
 */
export function applyWindowsHandoff(zipPath: string, productDir: string): null {
  const staging = windowsStagingDir() ?? path.join(path.dirname(productDir), ".gpuiv-update-staging")
  rmSync(staging, { recursive: true, force: true })
  extractZip(zipPath, staging)
  const inner = singleChild(staging) ?? staging
  const innerExe = path.join(inner, path.basename(process.execPath))
  if (!existsSync(innerExe)) {
    throw new Error(`The update zip does not contain ${path.basename(process.execPath)} at the expected layout.`)
  }
  spawn(innerExe, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [FINISH_UPDATE_ENV]: productDir },
  }).unref()
  return null
}

/** The relay's second leg, awaited at the app entry before anything else:
 * when the finish marker is set, this process is the staged update — copy
 * itself into the product dir, relaunch from there, exit. No-op otherwise. */
export async function finishPendingWindowsUpdate(): Promise<void> {
  const targetDir = process.env[FINISH_UPDATE_ENV]
  if (!targetDir) return
  const sourceDir = path.dirname(process.execPath)
  const exeName = path.basename(process.execPath)

  // The old process exits right after spawning us; its locks may need a
  // moment to clear.
  let copied = false
  for (let attempt = 0; attempt < 10 && !copied; attempt++) {
    try {
      cpSync(sourceDir, targetDir, { recursive: true, force: true })
      copied = true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  if (!copied) throw new Error(`finish-update: could not copy ${sourceDir} over ${targetDir}`)

  const env = { ...process.env }
  delete env[FINISH_UPDATE_ENV]
  spawn(path.join(targetDir, exeName), [], { detached: true, stdio: "ignore", env }).unref()
  process.exit(0)
}

/** Where the Windows handoff stages an update: beside the product dir. */
function windowsStagingDir(): string | null {
  if (platform() !== "win32") return null
  const productDir = path.dirname(process.execPath)
  return path.join(path.dirname(productDir), `.${path.basename(productDir)}-update`)
}

function singleChild(dir: string): string | null {
  const entries = readdirSync(dir)
  return entries.length === 1 ? path.join(dir, entries[0]) : null
}

/** Remove `*.old` leftovers from earlier versions of this engine. */
export function cleanWindowsLeftovers(productDir: string): void {
  for (const name of readdirSync(productDir)) {
    if (name.endsWith(".old")) rmSync(path.join(productDir, name), { force: true })
  }
}

export function relaunchExecutable(exePath: string): void {
  const child = spawn(exePath, [], { detached: true, stdio: "ignore" })
  child.unref()
}
