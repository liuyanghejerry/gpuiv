import { describe, expect, it } from "vitest"
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import {
  applyDarwinSwap,
  compareVersions,
  decideUpdate,
  parseUpdatePublicKey,
  platformKey,
  verifyArtifact,
  type ReleasePlatformEntry,
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
