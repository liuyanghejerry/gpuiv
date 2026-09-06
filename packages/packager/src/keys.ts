/** ed25519 update signing (docs/auto-update-plan.md).
 *
 * Sparkle 2's trust model: the private key lives in CI secrets, the public
 * key is pinned in `gpuiv.package.ts` and baked into the product. Config
 * accepts PEM or Sparkle-style base64-raw (32 bytes) public keys so keys
 * can be copy-pasted between the two worlds. */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto"

/** DER SPKI header for an ed25519 public key: everything before the raw 32
 * bytes. Prepending it turns a Sparkle-style raw key into a parseable one. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export interface UpdateKeyPair {
  privateKeyPem: string
  publicKeyPem: string
  /** Sparkle-style base64 of the raw 32 public key bytes (for the config). */
  publicKeyBase64: string
}

export function generateKeyPair(): UpdateKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString()
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem,
    publicKeyBase64: rawPublicKeyBase64(publicKey),
  }
}

export function privateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey(pem)
}

export function publicKeyFromPem(pem: string): KeyObject {
  return createPublicKey(pem)
}

export function rawPublicKeyToKeyObject(base64Raw: string): KeyObject {
  const raw = Buffer.from(base64Raw, "base64")
  if (raw.length !== 32) {
    throw new Error(`expected a 32-byte ed25519 public key, got ${raw.length} bytes`)
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  })
}

/** Accepts PEM (`-----BEGIN…`) or base64-raw public keys from the config. */
export function parsePublicKey(key: string): KeyObject {
  const trimmed = key.trim()
  return trimmed.startsWith("-----")
    ? publicKeyFromPem(trimmed)
    : rawPublicKeyToKeyObject(trimmed.replace(/base64:/, ""))
}

export function rawPublicKeyBase64(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" })
  return der.subarray(der.length - 32).toString("base64")
}

/** Stable identity of a key for config membership checks. */
export function publicKeyId(key: KeyObject): string {
  return rawPublicKeyBase64(key)
}

export function signBuffer(data: Buffer, privateKeyPem: string): string {
  const signature = cryptoSign(null, data, privateKeyFromPem(privateKeyPem))
  return signature.toString("base64")
}

/** The private key for a publish run: `GPUIV_UPDATE_PRIVATE_KEY` (a PEM
 * string) or a file path. CI uses the env; local runs the file. */
export function loadPrivateKey(envValue: string | undefined, pathValue?: string): string {
  const source = pathValue ?? envValue
  if (!source) {
    throw new Error(
      "No update signing key. Set GPUIV_UPDATE_PRIVATE_KEY (PEM string, CI) or pass --private-key <path> (local). Generate one with `gpuiv-packager keygen`.",
    )
  }
  const pem = source.includes("-----BEGIN") ? source : require("node:fs").readFileSync(source, "utf8")
  return pem
}
