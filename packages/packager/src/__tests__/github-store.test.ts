import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verify as cryptoVerify } from "node:crypto"
import { createServer, type Server } from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { generateKeyPair, rawPublicKeyToKeyObject } from "../keys.js"
import { GithubStore, resolveGithubConfig } from "../github.js"
import { promoteRelease, publishRelease } from "../publish.js"

/** In-memory GitHub REST API: the routes GithubStore touches, nothing more.
 * Releases and assets live in Maps; ids count up. Asset downloads 302 to an
 * in-memory blob served by the same server (the store follows redirects). */
function startMockGithub(): Promise<{
  api: string
  uploadApi: string
  releases: Map<string, { id: number; assets: Map<string, { id: number; body: Buffer }> }>
  deletedAssets: string[]
  stop: () => Promise<void>
}> {
  const releases = new Map<string, { id: number; assets: Map<string, { id: number; body: Buffer }> }>()
  const deletedAssets: string[] = []
  let nextId = 1

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const body = Buffer.concat(chunks)
      const url = new URL(request.url ?? "/", "http://mock")
      const method = request.method ?? "GET"

      const respond = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, headers)
        response.end(typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload))
      }
      const releaseJson = (tag: string) => {
        const release = releases.get(tag)!
        return {
          id: release.id,
          tag_name: tag,
          assets: [...release.assets.entries()].map(([name, asset]) => ({
            id: asset.id,
            name,
            url: `http://127.0.0.1:${(server.address() as { port: number }).port}/repos/o/r/releases/assets/${asset.id}`,
          })),
        }
      }

      if (url.pathname === "/repos/o/r/releases" && method === "POST") {
        const tag = (JSON.parse(body.toString()) as { tag_name: string }).tag_name
        if (releases.has(tag)) return respond(422, { message: "already_exists" })
        releases.set(tag, { id: nextId++, assets: new Map() })
        return respond(201, releaseJson(tag))
      }

      const tagMatch = url.pathname.match(/^\/repos\/o\/r\/releases\/tags\/(.+)$/)
      if (tagMatch && method === "GET") {
        const tag = decodeURIComponent(tagMatch[1])
        if (!releases.has(tag)) return respond(404, { message: "Not Found" })
        return respond(200, releaseJson(tag))
      }

      const uploadMatch = url.pathname.match(/^\/repos\/o\/r\/releases\/(\d+)\/assets$/)
      if (uploadMatch && method === "POST") {
        const release = [...releases.values()].find((candidate) => candidate.id === Number(uploadMatch[1]))
        if (!release) return respond(404, { message: "Not Found" })
        const name = url.searchParams.get("name")!
        release.assets.set(name, { id: nextId++, body })
        return respond(201, { id: nextId - 1, name })
      }

      const deleteMatch = url.pathname.match(/^\/repos\/o\/r\/releases\/assets\/(\d+)$/)
      if (deleteMatch && method === "DELETE") {
        for (const release of releases.values()) {
          for (const [name, asset] of release.assets) {
            if (asset.id === Number(deleteMatch[1])) {
              release.assets.delete(name)
              deletedAssets.push(name)
              return respond(204, "")
            }
          }
        }
        return respond(404, { message: "Not Found" })
      }

      const downloadMatch = url.pathname.match(/^\/repos\/o\/r\/releases\/assets\/(\d+)$/)
      if (downloadMatch && method === "GET") {
        if (request.headers.accept !== "application/octet-stream") {
          return respond(415, { message: "wrong accept" })
        }
        for (const release of releases.values()) {
          for (const asset of release.assets.values()) {
            if (asset.id === Number(downloadMatch[1])) {
              // The real API 302s to a signed CDN URL; same-server Location
              // exercises the store's redirect-following download path.
              response.writeHead(302, { Location: `/cdn/${asset.id}` })
              return response.end()
            }
          }
        }
        return respond(404, { message: "Not Found" })
      }

      if (url.pathname.startsWith("/cdn/") && method === "GET") {
        const id = Number(url.pathname.slice("/cdn/".length))
        for (const release of releases.values()) {
          for (const asset of release.assets.values()) {
            if (asset.id === id) return respond(200, asset.body, { "Content-Type": "application/octet-stream" })
          }
        }
        return respond(404, { message: "Not Found" })
      }

      return respond(405, { message: "MethodNotAllowed" })
    })
  })

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        rejectStart(new Error("no listen address"))
        return
      }
      const base = `http://127.0.0.1:${address.port}`
      resolveStart({
        api: base,
        uploadApi: base,
        releases,
        deletedAssets,
        stop: () => new Promise((resolve) => server.close(() => resolve())),
      })
    })
  })
}

describe("github feed store", () => {
  const keyPair = generateKeyPair()
  let github: Awaited<ReturnType<typeof startMockGithub>>
  let appDir: string
  const githubOverrides = () => ({
    api: github.api,
    uploadApi: github.uploadApi,
    repository: "o/r",
    token: "test-token",
  })

  beforeAll(async () => {
    github = await startMockGithub()
    appDir = path.join(tmpdir(), `gpuiv-publish-github-${Date.now()}`)
    mkdirSync(path.join(appDir, "dist", "package"), { recursive: true })
    writeFileSync(
      path.join(appDir, "gpuiv.package.json"),
      JSON.stringify({
        entry: "./app.tsx",
        productName: "Chat App",
        bundleId: "dev.gpuiv.chatapp",
        version: "0.3.0",
        updatePublicKeys: [keyPair.publicKeyBase64],
      }),
    )
    writeFileSync(path.join(appDir, "dist", "package", "Chat-App-darwin-arm64.zip"), Buffer.alloc(2048, 7))
  })

  afterAll(() => github.stop())

  it("maps feed keys to version releases and the feed release", () => {
    const store = new GithubStore(
      resolveGithubConfig({ ...githubOverrides(), tagPrefix: "app-v", feedTag: "app-feed" }),
    )
    expect(store.url("releases/0.3.0/Chat-App-darwin-arm64.zip")).toBe(
      "https://github.com/o/r/releases/download/app-v0.3.0/Chat-App-darwin-arm64.zip",
    )
    expect(store.url("stable.json")).toBe("https://github.com/o/r/releases/download/app-feed/stable.json")
    expect(() => store.url("nested/odd/key.json")).toThrow(/Unsupported feed key/)
  })

  it("publishes fragments as assets with github download urls", async () => {
    process.env.GPUIV_UPDATE_PRIVATE_KEY = keyPair.privateKeyPem
    await publishRelease({
      configPath: path.join(appDir, "gpuiv.package.json"),
      outDir: path.join(appDir, "dist", "package"),
      targets: ["darwin-arm64"],
      channel: "stable",
      store: "github",
      github: githubOverrides(),
    })

    const release = github.releases.get("app-v0.3.0")
    expect(release, "version release created").toBeTruthy()
    const names = [...release!.assets.keys()].sort()
    expect(names).toEqual(["Chat-App-darwin-arm64.zip", "Chat-App-darwin-arm64.zip.sig", "manifest-darwin-arm64.json"])

    const fragment = JSON.parse(release!.assets.get("manifest-darwin-arm64.json")!.body.toString())
    expect(fragment.platforms["darwin-arm64"].url).toBe(
      "https://github.com/o/r/releases/download/app-v0.3.0/Chat-App-darwin-arm64.zip",
    )
    // The signature verifies against the pinned key over the uploaded bytes.
    const verified = cryptoVerify(
      null,
      release!.assets.get("Chat-App-darwin-arm64.zip")!.body,
      rawPublicKeyToKeyObject(keyPair.publicKeyBase64),
      Buffer.from(fragment.platforms["darwin-arm64"].signature, "base64"),
    )
    expect(verified).toBe(true)
  })

  it("promote reads fragments back and replaces the channel pointer asset", async () => {
    await promoteRelease({
      version: "0.3.0",
      channel: "stable",
      targets: ["darwin-arm64"],
      store: "github",
      github: githubOverrides(),
    })

    const versionRelease = github.releases.get("app-v0.3.0")!
    const release = JSON.parse(versionRelease.assets.get("release.json")!.body.toString())
    expect(Object.keys(release.platforms)).toEqual(["darwin-arm64"])

    const feedRelease = github.releases.get("app-feed")
    expect(feedRelease, "feed release created").toBeTruthy()
    const pointer = JSON.parse(feedRelease!.assets.get("stable.json")!.body.toString())
    expect(pointer.releaseUrl).toBe("https://github.com/o/r/releases/download/app-v0.3.0/release.json")

    // Re-promoting replaces the pointer asset instead of failing with 422.
    await promoteRelease({
      version: "0.3.0",
      channel: "stable",
      targets: ["darwin-arm64"],
      store: "github",
      github: githubOverrides(),
    })
    expect(github.deletedAssets).toContain("stable.json")
    expect(github.deletedAssets).toContain("release.json")
  })
})
