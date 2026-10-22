import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  applyDarwinSwap,
  applyUpdateSync,
  applyWindowsHandoff,
  compareVersions,
  createUpdater,
  decideUpdate,
  finishPendingWindowsUpdate,
  parseUpdatePublicKey,
  platformKey,
  relaunchExecutable,
  verifyArtifact,
  type ReleaseManifest,
  type ReleasePlatformEntry,
  type UpdaterEvent,
  type UpdaterOptions,
} from "../updater.js"

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyBase64: der.subarray(der.length - 32).toString("base64"),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }
}

function signedEntry(bytes: Buffer, privateKeyPem: string, corrupt = false): ReleasePlatformEntry {
  const signature = cryptoSign(null, bytes, privateKeyPem).toString("base64")
  return {
    url: "https://example.com/a.zip",
    size: bytes.length,
    sha256: "",
    signature: corrupt ? signature.slice(0, -4) + "AAAA" : signature,
  }
}

describe("compareVersions", () => {
  it("orders cores numerically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0)
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0)
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0)
  })

  it("sorts prereleases below their release", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBeLessThan(0)
    expect(compareVersions("1.2.3-rc.1", "1.2.3-rc.2")).toBeLessThan(0)
    expect(compareVersions("1.2.3-2", "1.2.3-rc")).toBeLessThan(0) // numeric < alphanumeric
  })
})

describe("platformKey", () => {
  it("maps process triples to packager targets", () => {
    expect(platformKey("darwin", "arm64")).toBe("darwin-arm64")
    expect(platformKey("darwin", "x64")).toBe("darwin-x64")
    expect(platformKey("win32", "x64")).toBe("win32-x64")
    expect(platformKey("win32", "arm64")).toBe("win32-arm64")
  })
})

describe("decideUpdate", () => {
  const manifest = { version: "0.3.0", platforms: {} }

  it("reports newer versions", () => {
    expect(decideUpdate("0.2.0", manifest).state).toBe("update-available")
  })

  it("is quiet on the same or older version", () => {
    expect(decideUpdate("0.3.0", manifest).state).toBe("up-to-date")
    expect(decideUpdate("0.4.0", manifest).state).toBe("up-to-date")
  })

  it("refuses to jump versions below minimumAutoupdateVersion", () => {
    const gated = { ...manifest, minimumAutoupdateVersion: "0.2.5" }
    expect(decideUpdate("0.2.0", gated).state).toBe("manual-update-required")
    expect(decideUpdate("0.2.5", gated).state).toBe("update-available")
  })
})

describe("verifyArtifact", () => {
  const keys = keyMaterial()
  const bytes = Buffer.alloc(4096, 7)

  it("accepts a valid signature from a base64-raw pinned key", () => {
    expect(verifyArtifact(bytes, signedEntry(bytes, keys.privateKeyPem), [keys.publicKeyBase64])).toBe(true)
  })

  it("accepts a PEM pinned key (config accepts either form)", () => {
    expect(verifyArtifact(bytes, signedEntry(bytes, keys.privateKeyPem), [keys.publicKeyPem])).toBe(true)
  })

  it("rejects tampered bytes or signatures", () => {
    expect(verifyArtifact(Buffer.alloc(4096, 8), signedEntry(bytes, keys.privateKeyPem), [keys.publicKeyBase64])).toBe(false)
    expect(verifyArtifact(bytes, signedEntry(bytes, keys.privateKeyPem, true), [keys.publicKeyBase64])).toBe(false)
  })

  it("verifies against any pinned key (rotation window)", () => {
    const second = keyMaterial()
    expect(
      verifyArtifact(bytes, signedEntry(bytes, second.privateKeyPem), [
        keys.publicKeyBase64,
        second.publicKeyBase64,
      ]),
    ).toBe(true)
  })
})

describe("parseUpdatePublicKey", () => {
  it("round-trips a base64-raw key", () => {
    const keys = keyMaterial()
    const parsed = parseUpdatePublicKey(keys.publicKeyBase64)
    const der = parsed.export({ type: "spki", format: "der" }) as Buffer
    expect(der.subarray(der.length - 32).toString("base64")).toBe(keys.publicKeyBase64)
  })
})

// The swap is the risky part — exercise it against a real (fake) bundle.
describe.skipIf(process.platform !== "darwin")("applyDarwinSwap", () => {
  it("swaps a .app in place with the new content live", () => {
    const root = path.join(tmpdir(), `gpuiv-swap-test-${Date.now()}`)
    const installDir = path.join(root, "Apps")
    const bundleRoot = path.join(installDir, "Foo.app")

    // Current app: version 1.
    mkdirSync(path.join(bundleRoot, "Contents", "MacOS"), { recursive: true })
    writeFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "#!/bin/sh\necho v1\n")
    writeFileSync(path.join(bundleRoot, "Contents", "Info.plist"), "<dict/>")

    // Update zip: version 2 bundle, packed with the same tool the packager
    // uses (ditto --keepParent, like the real product zip).
    const incoming = path.join(root, "incoming", "Foo.app")
    mkdirSync(path.join(incoming, "Contents", "MacOS"), { recursive: true })
    writeFileSync(path.join(incoming, "Contents", "MacOS", "Foo"), "#!/bin/sh\necho v2\n")
    const zip = path.join(root, "update.zip")
    spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", incoming, zip])
    expect(() => readFileSync(zip)).not.toThrow()

    const newExe = applyDarwinSwap(zip, bundleRoot)
    expect(newExe).toBe(path.join(bundleRoot, "Contents", "MacOS", "Foo"))
    expect(readFileSync(newExe, "utf8")).toContain("v2")
    // Old bundle and staging leftovers are gone; only the new one remains.
    expect(() => readFileSync(path.join(installDir, ".Foo.app.backup"))).toThrow()
    expect(() => readFileSync(path.join(installDir, ".Foo.app.update"))).toThrow()

    rmSync(root, { recursive: true, force: true })
  })
})

// ── Engine & apply mechanics — runs on every platform; the OS surface
// (node:os, tar, spawn) is stubbed so Linux exercises the Windows and macOS
// branches too. ────────────────────────────────────────────────────────────

const osStub = vi.hoisted(() => ({
  platform: process.platform as NodeJS.Platform,
  arch: process.arch as string,
  homedir: (process.env.TMPDIR ?? "/tmp") as string,
}))
const cpStub = vi.hoisted(() => ({
  spawn: null as null | ((...args: unknown[]) => { unref(): void }),
  spawnSync: null as null
    | ((command: string, args: string[], options: { cwd?: string } | undefined) => { status: number | null; stderr?: string }),
}))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, platform: () => osStub.platform, arch: () => osStub.arch, homedir: () => osStub.homedir }
})
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...args: unknown[]) =>
      cpStub.spawn
        ? cpStub.spawn(...args)
        : (actual.spawn as unknown as (...spawnArgs: unknown[]) => unknown)(...args),
    spawnSync: (...args: unknown[]) =>
      cpStub.spawnSync
        ? cpStub.spawnSync(args[0] as string, args[1] as string[], args[2] as { cwd?: string } | undefined)
        : (actual.spawnSync as unknown as (...syncArgs: unknown[]) => unknown)(...args),
  }
})

describe("updater engine and apply mechanics (no native code)", () => {
  const engineKeys = keyMaterial()
  const pointer = { channel: "stable", release: "0.3.0", releaseUrl: "https://feed.example/releases/0.3.0.json" }
  const bundleId = "test.gpuiv.updater"
  const realExecPath = process.execPath
  const registered: Array<{ event: string | symbol; listener: (...args: unknown[]) => unknown }> = []
  const realProcessOn = process.on.bind(process)

  const jsonResponse = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

  function artifactResponse(bytes: Buffer, options: { ok?: boolean; status?: number; chunks?: number; withBody?: boolean } = {}) {
    const { ok = true, status = 200, chunks = 2, withBody = true } = options
    let read = 0
    const size = Math.max(1, Math.ceil(bytes.length / chunks))
    return {
      ok,
      status,
      body: withBody
        ? {
            getReader: () => ({
              read: async () =>
                read < bytes.length
                  ? { done: false as const, value: bytes.subarray(read, (read += size)) }
                  : { done: true as const, value: undefined },
            }),
          }
        : null,
    }
  }

  function stubResponses(...responses: unknown[]) {
    const fetchMock = vi.fn(() => Promise.resolve(responses.shift()))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  function setExecPath(value: string): void {
    Object.defineProperty(process, "execPath", { value, configurable: true })
  }

  /** A tar that "extracts" a prepared directory tree into its cwd. */
  function stubTarExtract(extractedFrom: string | null, status = 0): void {
    cpStub.spawnSync = (_command, args, options) => {
      if (args[0] === "-xf" && options?.cwd) {
        if (extractedFrom) cpSync(extractedFrom, options.cwd, { recursive: true })
        return { status, stderr: status === 0 ? "" : "tar: archive is corrupt" }
      }
      return { status: 1, stderr: "unexpected command" }
    }
  }

  function trackExitListeners(): void {
    vi.spyOn(process, "on").mockImplementation(((event: string | symbol, listener: (...args: unknown[]) => unknown) => {
      registered.push({ event, listener })
      return realProcessOn(event, listener as never)
    }) as never)
  }

  function engineFixture(options: Partial<UpdaterOptions> = {}) {
    ;(globalThis as { Bun?: unknown }).Bun = { isStandaloneExecutable: true }
    const events: UpdaterEvent[] = []
    const updater = createUpdater({
      feedUrl: "https://feed.example/stable.json",
      channel: "stable",
      publicKeys: [engineKeys.publicKeyBase64],
      currentVersion: "0.2.0",
      bundleId,
      ...options,
    })
    updater.on((event) => events.push(event))
    return { updater, events }
  }

  function manifestFor(entry: Partial<ReleasePlatformEntry>, version = "0.3.0", extra: Partial<ReleaseManifest> = {}): ReleaseManifest {
    return { version, platforms: { [platformKey()]: { url: "https://cdn.example/app.zip", ...entry } }, ...extra }
  }

  function entryFor(bytes: Buffer, signWith = engineKeys.privateKeyPem, overrides: Partial<ReleasePlatformEntry> = {}): ReleasePlatformEntry {
    return {
      url: "https://cdn.example/app.zip",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      signature: cryptoSign(null, bytes, signWith).toString("base64"),
      ...overrides,
    }
  }

  /** Feed → manifest → artifact, all succeeding; returns the staged zip path. */
  async function stageDownload(
    updater: { checkForUpdates(): Promise<unknown>; downloadUpdate(): Promise<string> },
    bytes: Buffer,
    entry: ReleasePlatformEntry = entryFor(bytes),
  ) {
    stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entry)), artifactResponse(bytes))
    await updater.checkForUpdates()
    return updater.downloadUpdate()
  }

  beforeEach(() => {
    osStub.platform = process.platform
    osStub.arch = process.arch
    osStub.homedir = mkdtempSync(path.join(tmpdir(), "gpuiv-updater-home-"))
    cpStub.spawn = null
    cpStub.spawnSync = null
  })

  afterEach(() => {
    delete (globalThis as { Bun?: unknown }).Bun
    Object.defineProperty(process, "execPath", { value: realExecPath, writable: true, configurable: true })
    delete process.env.GPUIV_FINISH_UPDATE
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
    for (const { event, listener } of registered.splice(0)) process.removeListener(event, listener as never)
    rmSync(osStub.homedir, { recursive: true, force: true })
  })

  describe("version comparison edges", () => {
    it("treats identical prereleases as equal and pads shorter cores with zeros", () => {
      expect(compareVersions("1.2.3-rc.1", "1.2.3-rc.1")).toBe(0)
      expect(compareVersions("1.2", "1.2.0")).toBe(0)
      expect(compareVersions("1.2", "1.2.1")).toBeLessThan(0)
      expect(compareVersions("7.0", "7")).toBe(0)
    })

    it("orders alphanumeric identifiers lexically and above numeric ones", () => {
      expect(compareVersions("1.2.3-alpha", "1.2.3-beta")).toBeLessThan(0)
      expect(compareVersions("1.2.3-rc", "1.2.3-2")).toBeGreaterThan(0)
      expect(compareVersions("1.2.3-rc", "1.2.3-rc.1")).toBeGreaterThan(0)
      expect(compareVersions("1.2.3", "1.2.3-rc.1")).toBeGreaterThan(0)
    })
  })

  describe("platform keys", () => {
    it("maps linux and any other platform, defaulting unknown arches to arm64", () => {
      expect(platformKey("linux", "x64")).toBe("linux-x64")
      expect(platformKey("linux", "arm64")).toBe("linux-arm64")
      expect(platformKey("freebsd", "ia64")).toBe("linux-arm64")
      expect(typeof platformKey()).toBe("string")
    })
  })

  describe("key parsing edges", () => {
    it("rejects raw keys that do not decode to 32 bytes", () => {
      expect(() => parseUpdatePublicKey("not-a-key")).toThrow(/32-byte/)
      expect(() => parseUpdatePublicKey("")).toThrow(/32-byte/)
    })

    it("accepts base64:-prefixed raw keys", () => {
      const parsed = parseUpdatePublicKey(`base64:${engineKeys.publicKeyBase64}`)
      const der = parsed.export({ type: "spki", format: "der" }) as Buffer
      expect(der.subarray(der.length - 32).toString("base64")).toBe(engineKeys.publicKeyBase64)
    })

    it("skips pinned keys that fail to parse instead of throwing", () => {
      const bytes = Buffer.alloc(64, 3)
      const entry = entryFor(bytes)
      expect(verifyArtifact(bytes, entry, ["%%%unparseable", engineKeys.publicKeyBase64])).toBe(true)
      expect(
        verifyArtifact(bytes, entry, ["%%%unparseable", "-----BEGIN GARBAGE-----\n@@@\n-----END GARBAGE-----"]),
      ).toBe(false)
    })
  })

  describe("engine guards", () => {
    it("refuses to run without a configured feed", async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal("fetch", fetchMock)
      const { updater, events } = engineFixture({ feedUrl: "" })
      await expect(updater.checkForUpdates()).rejects.toThrow("No update feed configured")
      expect(events).toEqual([{ type: "error", message: expect.stringContaining("No update feed configured") }])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("refuses to run without pinned keys", async () => {
      const { updater } = engineFixture({ publicKeys: [] })
      await expect(updater.checkForUpdates()).rejects.toThrow("No update public keys pinned")
      await expect(updater.downloadUpdate()).rejects.toThrow("No update public keys pinned")
    })

    it("refuses to run in development", async () => {
      const { updater } = engineFixture()
      delete (globalThis as { Bun?: unknown }).Bun
      await expect(updater.checkForUpdates()).rejects.toThrow("development runs never update")
    })

    it("isolates listener errors and supports unsubscribing", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const { updater, events } = engineFixture({ feedUrl: "" })
      const off = updater.on(() => {
        throw new Error("listener boom")
      })
      await expect(updater.checkForUpdates()).rejects.toThrow("No update feed configured")
      expect(errorSpy).toHaveBeenCalledWith("[gpuiv-updater] listener:", expect.objectContaining({ message: "listener boom" }))
      off()
      await expect(updater.checkForUpdates()).rejects.toThrow("No update feed configured")
      expect(events).toHaveLength(2)
      expect(errorSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("checkForUpdates", () => {
    it("emits checking and update-available", async () => {
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entryFor(Buffer.alloc(1000, 7)))))
      const { updater, events } = engineFixture()
      expect(await updater.checkForUpdates()).toMatchObject({ state: "update-available" })
      expect(events).toEqual([{ type: "checking" }, { type: "update-available", version: "0.3.0", notes: "" }])
    })

    it("emits up-to-date when the feed holds no newer version", async () => {
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entryFor(Buffer.alloc(1)), "0.1.0")))
      const { updater, events } = engineFixture()
      expect(await updater.checkForUpdates()).toEqual({ state: "up-to-date", version: "0.2.0" })
      expect(events).toEqual([{ type: "checking" }, { type: "up-to-date", version: "0.2.0" }])
    })

    it("emits manual-update-required below minimumAutoupdateVersion", async () => {
      const gated = manifestFor(entryFor(Buffer.alloc(1)), "0.3.0", { minimumAutoupdateVersion: "0.2.5" })
      stubResponses(jsonResponse(pointer), jsonResponse(gated))
      const { updater, events } = engineFixture()
      expect((await updater.checkForUpdates()).state).toBe("manual-update-required")
      expect(events[1]).toEqual({ type: "manual-update-required", version: "0.3.0" })
    })

    it("fails on feed, pointer and manifest transport errors", async () => {
      stubResponses({ ok: false, status: 503, json: async () => ({}) })
      const failing = engineFixture()
      await expect(failing.updater.checkForUpdates()).rejects.toThrow("Feed fetch failed: 503")

      stubResponses(jsonResponse(null))
      const noPointer = engineFixture()
      await expect(noPointer.updater.checkForUpdates()).rejects.toThrow("Feed pointer has no releaseUrl")

      stubResponses(jsonResponse(pointer), { ok: false, status: 404, json: async () => ({}) })
      const noManifest = engineFixture()
      await expect(noManifest.updater.checkForUpdates()).rejects.toThrow("Release manifest fetch failed: 404")
    })

    it("fails on a malformed release manifest", async () => {
      for (const malformed of [{ version: "0.3.0" }, { platforms: {} }, null]) {
        stubResponses(jsonResponse(pointer), jsonResponse(malformed))
        const { updater } = engineFixture()
        await expect(updater.checkForUpdates()).rejects.toThrow("Release manifest is malformed")
      }
    })
  })

  describe("downloadUpdate", () => {
    it("fails before downloading when nothing is pending or the platform is missing a build", async () => {
      const { updater } = engineFixture()
      await expect(updater.downloadUpdate()).rejects.toThrow("checkForUpdates() found nothing to download")

      stubResponses(jsonResponse(pointer), jsonResponse({ version: "0.3.0", platforms: { "darwin-arm64": entryFor(Buffer.alloc(8)) } }))
      const { updater: second } = engineFixture()
      await second.checkForUpdates()
      await expect(second.downloadUpdate()).rejects.toThrow(`The release has no build for ${platformKey()}.`)
    })

    it("fails on artifact transport errors", async () => {
      const bytes = Buffer.alloc(100, 7)
      const entry = entryFor(bytes)
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entry)), { ok: false, status: 500, body: {} })
      const failing = engineFixture()
      await failing.updater.checkForUpdates()
      await expect(failing.updater.downloadUpdate()).rejects.toThrow("Artifact download failed: 500")

      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entry)), { ok: true, status: 200, body: null })
      const bodiless = engineFixture()
      await bodiless.updater.checkForUpdates()
      await expect(bodiless.updater.downloadUpdate()).rejects.toThrow("Artifact download failed: 200")
    })

    it("verifies size and sha256 before writing anything", async () => {
      const bytes = Buffer.alloc(100, 7)
      const mismatchedSize = entryFor(bytes, engineKeys.privateKeyPem, { size: bytes.length + 5 })
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(mismatchedSize)), artifactResponse(bytes))
      const oversized = engineFixture()
      await oversized.updater.checkForUpdates()
      await expect(oversized.updater.downloadUpdate()).rejects.toThrow("Artifact size mismatch")

      const wrongSha = entryFor(bytes, engineKeys.privateKeyPem, { sha256: "0".repeat(64) })
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(wrongSha)), artifactResponse(bytes))
      const unhashed = engineFixture()
      await unhashed.updater.checkForUpdates()
      await expect(unhashed.updater.downloadUpdate()).rejects.toThrow("sha256 mismatch")
    })

    it("rejects artifacts signed by a key that is not pinned", async () => {
      const bytes = Buffer.alloc(100, 7)
      const stranger = keyMaterial()
      stubResponses(jsonResponse(pointer), jsonResponse(manifestFor(entryFor(bytes, stranger.privateKeyPem))), artifactResponse(bytes))
      const { updater } = engineFixture()
      await updater.checkForUpdates()
      await expect(updater.downloadUpdate()).rejects.toThrow("signature rejected")
    })

    it("streams the artifact, reports progress and stages the verified zip", async () => {
      const bytes = Buffer.alloc(1000, 7)
      const { updater, events } = engineFixture()
      const zipPath = await stageDownload(updater, bytes)
      expect(zipPath).toBe(path.join(osStub.homedir, ".local", "share", bundleId, "updates", `0.3.0-${platformKey()}.zip`))
      expect(readFileSync(zipPath).equals(bytes)).toBe(true)
      expect(events.filter((event) => event.type === "download-progress")).toEqual([
        { type: "download-progress", received: 500, total: 1000, percent: 50 },
        { type: "download-progress", received: 1000, total: 1000, percent: 100 },
      ])
      expect(events.at(-1)).toEqual({ type: "downloaded", version: "0.3.0" })
    })

    it("stages under Application Support on macOS and APPDATA on Windows", async () => {
      const bytes = Buffer.alloc(10, 1)
      osStub.platform = "darwin"
      const mac = engineFixture()
      expect(await stageDownload(mac.updater, bytes)).toContain(path.join("Library", "Application Support", bundleId, "updates"))

      osStub.platform = "win32"
      const previous = process.env.APPDATA
      const roaming = path.join(osStub.homedir, "Roaming")
      process.env.APPDATA = roaming
      try {
        const windows = engineFixture()
        expect(await stageDownload(windows.updater, bytes)).toContain(path.join(roaming, bundleId, "updates"))
      } finally {
        if (previous === undefined) delete process.env.APPDATA
        else process.env.APPDATA = previous
      }
    })
  })

  describe("applyAndRelaunch and queueApplyOnQuit", () => {
    it("reports that Linux self-update is not implemented", async () => {
      expect(() => applyUpdateSync("/tmp/never.zip", bundleId)).toThrow("Linux self-update is not implemented")
      const { updater } = engineFixture()
      await stageDownload(updater, Buffer.alloc(50, 7))
      await expect(updater.applyAndRelaunch()).rejects.toThrow("Linux self-update is not implemented")
    })

    it("routes win32 applies to the staged handoff beside the exe", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-win-route-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        const exeName = "Fake.exe"
        setExecPath(path.join(productDir, exeName))
        const prepared = path.join(root, "prepared", "Inner")
        mkdirSync(prepared, { recursive: true })
        writeFileSync(path.join(prepared, exeName), "new exe")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(path.join(root, "prepared"))
        cpStub.spawn = vi.fn(() => ({ unref() {} }))

        osStub.platform = "win32"
        expect(applyUpdateSync(zip, bundleId)).toBeNull()
        expect(cpStub.spawn).toHaveBeenCalledWith(path.join(root, ".Product-update", "Inner", exeName), [], expect.anything())
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("refuses to apply or queue an apply without a staged update", async () => {
      const { updater } = engineFixture()
      expect(() => updater.queueApplyOnQuit()).toThrow("downloadUpdate() has not staged an update")
      await expect(updater.applyAndRelaunch()).rejects.toThrow("downloadUpdate() has not staged an update")
    })

    it("swaps, relaunches and exits after a darwin apply", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-apply-"))
      try {
        const installDir = path.join(root, "Apps")
        const bundleRoot = path.join(installDir, "Foo.app")
        mkdirSync(path.join(bundleRoot, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "v1")
        const prepared = path.join(root, "prepared", "Foo.app")
        mkdirSync(path.join(prepared, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(prepared, "Contents", "MacOS", "Foo"), "v2")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")

        osStub.platform = "darwin"
        setExecPath(path.join(bundleRoot, "Contents", "MacOS", "Foo"))
        stubTarExtract(path.join(root, "prepared"))
        cpStub.spawn = vi.fn(() => ({ unref() {} }))
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)

        const { updater, events } = engineFixture()
        await stageDownload(updater, Buffer.alloc(64, 9))
        await expect(updater.applyAndRelaunch()).resolves.toBeUndefined()
        expect(events.at(-1)).toEqual({ type: "applied", version: "0.3.0" })
        expect(exitSpy).toHaveBeenCalledWith(0)
        expect(cpStub.spawn).toHaveBeenCalledWith(
          path.join(bundleRoot, "Contents", "MacOS", "Foo"),
          [],
          expect.objectContaining({ detached: true, stdio: "ignore" }),
        )
        expect(readFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "utf8")).toBe("v2")
        expect(existsSync(path.join(installDir, ".Foo.app.backup"))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("applies on exit and logs a failed apply", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      trackExitListeners()
      const { updater } = engineFixture()
      await stageDownload(updater, Buffer.alloc(30, 5))
      expect(() => updater.queueApplyOnQuit()).not.toThrow()
      process.emit("exit", 0)
      expect(errorSpy).toHaveBeenCalledWith(
        "[gpuiv-updater] apply-on-quit failed:",
        expect.objectContaining({ message: "Linux self-update is not implemented (P2)." }),
      )
    })

    it("relaunches from the exit handler when the platform swaps in place", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-quit-apply-"))
      try {
        const installDir = path.join(root, "Apps")
        const bundleRoot = path.join(installDir, "Foo.app")
        mkdirSync(path.join(bundleRoot, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "v1")
        const prepared = path.join(root, "prepared", "Foo.app")
        mkdirSync(path.join(prepared, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(prepared, "Contents", "MacOS", "Foo"), "v2")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")

        trackExitListeners()
        osStub.platform = "darwin"
        setExecPath(path.join(bundleRoot, "Contents", "MacOS", "Foo"))
        stubTarExtract(path.join(root, "prepared"))
        cpStub.spawn = vi.fn(() => ({ unref() {} }))
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)

        const { updater } = engineFixture()
        await stageDownload(updater, Buffer.alloc(30, 5))
        expect(() => updater.queueApplyOnQuit()).not.toThrow()
        process.emit("exit", 0)
        expect(readFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "utf8")).toBe("v2")
        expect(cpStub.spawn).toHaveBeenCalledWith(path.join(bundleRoot, "Contents", "MacOS", "Foo"), [], expect.anything())
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe("windows leftover cleanup", () => {
    it("cleans leftovers at creation and again after five seconds", () => {
      vi.useFakeTimers()
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-leftovers-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        writeFileSync(path.join(productDir, "legacy.old"), "left behind by an earlier engine")
        const staging = path.join(root, `.${path.basename(productDir)}-update`)
        mkdirSync(staging)
        writeFileSync(path.join(staging, "payload"), "stale handoff")

        osStub.platform = "win32"
        ;(globalThis as { Bun?: unknown }).Bun = { isStandaloneExecutable: true }
        setExecPath(path.join(productDir, "Fake.exe"))
        createUpdater({ feedUrl: "https://feed.example/stable.json", publicKeys: ["k"], currentVersion: "1.0.0", bundleId })

        expect(existsSync(path.join(productDir, "legacy.old"))).toBe(false)
        expect(existsSync(staging)).toBe(false)

        writeFileSync(path.join(productDir, "second.old"), "arrives later")
        vi.advanceTimersByTime(5_000)
        expect(existsSync(path.join(productDir, "second.old"))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("keeps leftovers while a windows update handoff is finishing", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-finishing-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        writeFileSync(path.join(productDir, "in-flight.old"), "still needed")
        osStub.platform = "win32"
        ;(globalThis as { Bun?: unknown }).Bun = { isStandaloneExecutable: true }
        setExecPath(path.join(productDir, "Fake.exe"))
        process.env.GPUIV_FINISH_UPDATE = productDir
        createUpdater({ feedUrl: "https://feed.example/stable.json", publicKeys: ["k"], currentVersion: "1.0.0", bundleId })
        expect(existsSync(path.join(productDir, "in-flight.old"))).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe("apply mechanics without a real archive tool", () => {
    it("swaps a .app bundle via stubbed tar", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-swap-"))
      try {
        const installDir = path.join(root, "Apps")
        const bundleRoot = path.join(installDir, "Foo.app")
        mkdirSync(path.join(bundleRoot, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(bundleRoot, "Contents", "MacOS", "Foo"), "v1")
        const prepared = path.join(root, "prepared", "Foo.app")
        mkdirSync(path.join(prepared, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(prepared, "Contents", "MacOS", "Foo"), "v2")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(path.join(root, "prepared"))

        const exe = applyDarwinSwap(zip, bundleRoot)
        expect(exe).toBe(path.join(bundleRoot, "Contents", "MacOS", "Foo"))
        expect(readFileSync(exe, "utf8")).toBe("v2")
        expect(existsSync(path.join(installDir, ".Foo.app.backup"))).toBe(false)
        expect(existsSync(path.join(installDir, ".Foo.app.update"))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("installs into an empty install directory", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-install-"))
      try {
        const installDir = path.join(root, "Apps")
        mkdirSync(installDir, { recursive: true })
        const prepared = path.join(root, "prepared", "New.app")
        mkdirSync(path.join(prepared, "Contents", "MacOS"), { recursive: true })
        writeFileSync(path.join(prepared, "Contents", "MacOS", "New"), "v1")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(path.join(root, "prepared"))

        const exe = applyDarwinSwap(zip, path.join(installDir, "New.app"))
        expect(readFileSync(exe, "utf8")).toBe("v1")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("reports archives that do not contain the bundle", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-wrongbundle-"))
      try {
        const installDir = path.join(root, "Apps")
        const bundleRoot = path.join(installDir, "Foo.app")
        mkdirSync(bundleRoot, { recursive: true })
        const prepared = path.join(root, "prepared", "Bar.app")
        mkdirSync(prepared, { recursive: true })
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(path.join(root, "prepared"))

        expect(() => applyDarwinSwap(zip, bundleRoot)).toThrow(/does not contain Foo\.app/)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("surfaces tar failures", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-badtar-"))
      try {
        const bundleRoot = path.join(root, "Apps", "Foo.app")
        mkdirSync(bundleRoot, { recursive: true })
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(null, 1)
        expect(() => applyDarwinSwap(zip, bundleRoot)).toThrow(/Extraction failed \(tar 1\)/)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("extracts beside the product and spawns the staged successor", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-handoff-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        const exeName = "Fake.exe"
        setExecPath(path.join(productDir, exeName))
        const prepared = path.join(root, "prepared")
        mkdirSync(path.join(prepared, "Inner"), { recursive: true })
        writeFileSync(path.join(prepared, "Inner", exeName), "new exe")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(prepared)
        cpStub.spawn = vi.fn(() => ({ unref() {} }))

        expect(applyWindowsHandoff(zip, productDir)).toBeNull()
        const staging = path.join(root, ".gpuiv-update-staging")
        expect(existsSync(path.join(staging, "Inner", exeName))).toBe(true)
        expect(cpStub.spawn).toHaveBeenCalledWith(
          path.join(staging, "Inner", exeName),
          [],
          expect.objectContaining({ detached: true, env: expect.objectContaining({ GPUIV_FINISH_UPDATE: productDir }) }),
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("falls back to the staging root for multi-entry archives", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-multientry-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        const exeName = "Fake.exe"
        setExecPath(path.join(productDir, exeName))
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        cpStub.spawnSync = (_command, _args, options) => {
          const cwd = options?.cwd
          if (!cwd) return { status: 1 }
          writeFileSync(path.join(cwd, exeName), "exe at root")
          mkdirSync(path.join(cwd, "Extra"))
          return { status: 0, stderr: "" }
        }
        cpStub.spawn = vi.fn(() => ({ unref() {} }))

        expect(applyWindowsHandoff(zip, productDir)).toBeNull()
        expect(cpStub.spawn).toHaveBeenCalledWith(path.join(root, ".gpuiv-update-staging", exeName), [], expect.anything())
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("reports archives that lack the executable", () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-noexe-"))
      try {
        const productDir = path.join(root, "Product")
        mkdirSync(productDir)
        setExecPath(path.join(productDir, "Fake.exe"))
        const prepared = path.join(root, "prepared", "Inner")
        mkdirSync(prepared, { recursive: true })
        writeFileSync(path.join(prepared, "README.md"), "no exe")
        const zip = path.join(root, "update.zip")
        writeFileSync(zip, "fake zip")
        stubTarExtract(path.join(root, "prepared"))

        expect(() => applyWindowsHandoff(zip, productDir)).toThrow(/does not contain Fake\.exe/)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("relaunches executables detached and unrefed", () => {
      cpStub.spawn = vi.fn(() => ({ unref() {} }))
      relaunchExecutable("/opt/app/Foo")
      expect(cpStub.spawn).toHaveBeenCalledWith("/opt/app/Foo", [], { detached: true, stdio: "ignore" })
    })
  })

  describe("finishPendingWindowsUpdate", () => {
    it("does nothing without the finish marker", async () => {
      cpStub.spawn = vi.fn(() => ({ unref() {} }))
      await finishPendingWindowsUpdate()
      expect(cpStub.spawn).not.toHaveBeenCalled()
    })

    it("copies itself over the product dir, relaunches and exits", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-finish-"))
      try {
        const sourceDir = path.join(root, "staged")
        const targetDir = path.join(root, "product")
        mkdirSync(sourceDir, { recursive: true })
        mkdirSync(targetDir, { recursive: true })
        writeFileSync(path.join(sourceDir, "Fake.exe"), "new binary")
        writeFileSync(path.join(targetDir, "Fake.exe"), "old binary")
        setExecPath(path.join(sourceDir, "Fake.exe"))
        process.env.GPUIV_FINISH_UPDATE = targetDir
        cpStub.spawn = vi.fn(() => ({ unref() {} }))
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)

        await finishPendingWindowsUpdate()
        expect(readFileSync(path.join(targetDir, "Fake.exe"), "utf8")).toBe("new binary")
        const launched = (cpStub.spawn as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { env: Record<string, string | undefined> }
        expect(launched.env.GPUIV_FINISH_UPDATE).toBeUndefined()
        expect(exitSpy).toHaveBeenCalledWith(0)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it("retries the copy and gives up after ten attempts", async () => {
      vi.useFakeTimers()
      const root = mkdtempSync(path.join(tmpdir(), "gpuiv-finish-retry-"))
      try {
        const sourceDir = path.join(root, "staged")
        mkdirSync(sourceDir, { recursive: true })
        writeFileSync(path.join(sourceDir, "Fake.exe"), "new")
        const targetFile = path.join(root, "occupied")
        writeFileSync(targetFile, "not a directory")
        setExecPath(path.join(sourceDir, "Fake.exe"))
        process.env.GPUIV_FINISH_UPDATE = targetFile
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)

        const finishing = finishPendingWindowsUpdate()
        const assertion = expect(finishing).rejects.toThrow("could not copy")
        await vi.advanceTimersByTimeAsync(10_500)
        await assertion
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
