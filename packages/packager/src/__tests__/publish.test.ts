import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verify as cryptoVerify } from "node:crypto"
import { createServer } from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { generateKeyPair, rawPublicKeyToKeyObject } from "../keys.js"
import { promoteRelease, publishRelease } from "../publish.js"

/** In-memory S3: records PUTs, serves GETs. Path-style addressing like the
 * real thing; auth headers ignored (aws4fetch still signs against this URL,
 * which is what we want to exercise — the flow, not SigV4 itself). Plain
 * node:http because vitest workers run under node, without the Bun global. */
function startMockS3(): Promise<{
  objects: Map<string, { body: Buffer; contentType: string; cacheControl: string }>
  url: string
  stop: () => Promise<void>
}> {
  return new Promise((resolveStart, rejectStart) => {
    const objects = new Map<string, { body: Buffer; contentType: string; cacheControl: string }>()
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        const key = (request.url ?? "").replace(/^\/test-bucket\/chat\//, "")
        if (request.method === "PUT") {
          objects.set(key, {
            body: Buffer.concat(chunks),
            contentType: request.headers["content-type"] ?? "",
            cacheControl: request.headers["cache-control"] ?? "",
          })
          response.writeHead(200).end()
        } else if (request.method === "GET") {
          const object = objects.get(key)
          if (!object) {
            response.writeHead(404).end("NotFound")
          } else {
            response
              .writeHead(200, { "Content-Type": object.contentType, "Cache-Control": object.cacheControl })
              .end(object.body)
          }
        } else {
          response.writeHead(405).end("MethodNotAllowed")
        }
      })
    })
    server.once("error", rejectStart)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        rejectStart(new Error("no listen address"))
        return
      }
      resolveStart({
        objects,
        url: `http://127.0.0.1:${address.port}`,
        stop: () => new Promise((resolve) => server.close(() => resolve())),
      })
    })
  })
}

describe("publish + promote", () => {
  let s3: ReturnType<typeof startMockS3>
  const keyPair = generateKeyPair()
  let appDir: string

  beforeAll(async () => {
    s3 = await startMockS3()
    appDir = path.join(tmpdir(), `gpuiv-publish-test-${Date.now()}`)
    mkdirSync(path.join(appDir, "dist", "package"), { recursive: true })
    writeFileSync(
      path.join(appDir, "gpuiv.package.json"),
      JSON.stringify({
        entry: "./app.tsx",
        productName: "Chat App",
        bundleId: "dev.gpuiv.chatapp",
        version: "0.2.0",
        updatePublicKeys: [keyPair.publicKeyBase64],
      }),
    )
    // Two fake artifacts: deterministic bytes, different per target.
    for (const target of ["darwin-arm64", "win32-x64"]) {
      const zip = Buffer.alloc(64 * 1024, target.charCodeAt(0))
      writeFileSync(path.join(appDir, "dist", "package", `Chat-App-${target}.zip`), zip)
    }
  })

  afterAll(() => s3.stop())

  it("publishes signed artifacts and per-target fragments", async () => {
    process.env.GPUIV_UPDATE_PRIVATE_KEY = keyPair.privateKeyPem
    await publishRelease({
      configPath: path.join(appDir, "gpuiv.package.json"),
      outDir: path.join(appDir, "dist", "package"),
      targets: ["darwin-arm64", "win32-x64"],
      channel: "stable",
      s3: {
        endpoint: s3.url,
        region: "us-east-1",
        bucket: "test-bucket",
        prefix: "chat",
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    })

    const zipKey = "releases/0.2.0/Chat-App-darwin-arm64.zip"
    const zip = s3.objects.get(zipKey)
    expect(zip, zipKey).toBeTruthy()
    expect(zip!.cacheControl).toContain("immutable")

    const fragment = JSON.parse(
      s3.objects.get("releases/0.2.0/manifest-darwin-arm64.json")!.body.toString(),
    )
    expect(fragment.version).toBe("0.2.0")
    expect(fragment.platforms["darwin-arm64"].size).toBe(64 * 1024)

    // The signature must verify against the pinned public key over the exact
    // bytes that landed in the bucket.
    const entry = fragment.platforms["darwin-arm64"]
    const verified = cryptoVerify(
      null,
      zip!.body,
      rawPublicKeyToKeyObject(keyPair.publicKeyBase64),
      Buffer.from(entry.signature, "base64"),
    )
    expect(verified).toBe(true)
  })

  it("refuses to publish when no public key is pinned", async () => {
    const unsignedDir = path.join(appDir, "unsigned")
    mkdirSync(unsignedDir, { recursive: true })
    writeFileSync(
      path.join(unsignedDir, "gpuiv.package.json"),
      JSON.stringify({ entry: "./a.tsx", productName: "X", bundleId: "x", version: "1.0.0" }),
    )
    await expect(
      publishRelease({
        configPath: path.join(unsignedDir, "gpuiv.package.json"),
        targets: ["darwin-arm64"],
        channel: "stable",
        s3: { endpoint: s3.url, region: "r", bucket: "b", prefix: "p", accessKeyId: "t", secretAccessKey: "t" },
      }),
    ).rejects.toThrow(/updatePublicKeys/)
  })

  it("promote merges fragments and writes the channel pointer", async () => {
    await promoteRelease({
      version: "0.2.0",
      channel: "stable",
      targets: ["darwin-arm64", "win32-x64"],
      s3: {
        endpoint: s3.url,
        region: "us-east-1",
        bucket: "test-bucket",
        prefix: "chat",
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    })

    const release = JSON.parse(s3.objects.get("releases/0.2.0/release.json")!.body.toString())
    expect(Object.keys(release.platforms).sort()).toEqual(["darwin-arm64", "win32-x64"])

    const pointer = JSON.parse(s3.objects.get("stable.json")!.body.toString())
    expect(pointer).toEqual({
      channel: "stable",
      release: "0.2.0",
      releaseUrl: `${s3.url}/test-bucket/chat/releases/0.2.0/release.json`,
    })
    expect(s3.objects.get("stable.json")!.cacheControl).toContain("max-age=60")
  })

  it("promote fails loudly when a platform job did not publish", async () => {
    await expect(
      promoteRelease({
        version: "0.2.0",
        channel: "beta",
        targets: ["darwin-x64"],
        s3: {
          endpoint: s3.url,
          region: "us-east-1",
          bucket: "test-bucket",
          prefix: "chat",
          accessKeyId: "test",
          secretAccessKey: "test",
        },
      }),
    ).rejects.toThrow(/manifest-darwin-x64/)
  })
})
