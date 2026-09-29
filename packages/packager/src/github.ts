/** GitHub Releases feed store — the update feed as release assets.
 *
 * Key mapping (mirrors the S3 layout, docs/auto-update-plan.md):
 *
 *   releases/<version>/<asset>   → release tagged `<tagPrefix><version>`
 *                                  (prerelease, machine-managed), asset
 *                                  `<asset>` — immutable by convention
 *   <channel>.json               → the feed release (tag `<feedTag>`),
 *                                  asset `<channel>.json` — replaced on
 *                                  promote (delete + re-upload, the only
 *                                  mutable object in the feed)
 *
 * `cacheControl` is accepted and ignored: GitHub serves assets from its own
 * CDN. Public releases give stable download URLs the updater can fetch
 * without auth; publishing needs a token with `contents:write`. */

import type { FeedStore, FeedStorePutOptions } from "./feed-store.js"

interface GithubReleaseAsset {
  id: number
  name: string
  url: string
}

interface GithubRelease {
  id: number
  tag_name: string
  assets: GithubReleaseAsset[]
}

export interface GithubEnvConfig {
  /** REST base, `https://api.github.com` (Actions: `GITHUB_API_URL`). */
  api: string
  /** Upload base, `https://uploads.github.com`. */
  uploadApi: string
  /** `owner/name`. */
  repository: string
  token: string
  /** Version releases are tagged `<prefix><version>`. */
  tagPrefix: string
  /** The release carrying the mutable channel pointers. */
  feedTag: string
}

export function resolveGithubConfig(overrides: Partial<GithubEnvConfig> = {}): GithubEnvConfig {
  const env = process.env
  const config = {
    api: overrides.api ?? env.GPUIV_GITHUB_API ?? env.GITHUB_API_URL ?? "https://api.github.com",
    uploadApi:
      overrides.uploadApi ?? env.GPUIV_GITHUB_UPLOAD_API ?? env.GITHUB_UPLOAD_URL ?? "https://uploads.github.com",
    repository: overrides.repository ?? env.GPUIV_GITHUB_REPOSITORY ?? env.GITHUB_REPOSITORY ?? "",
    token: overrides.token ?? env.GPUIV_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? "",
    tagPrefix: overrides.tagPrefix ?? env.GPUIV_GITHUB_TAG_PREFIX ?? "app-v",
    feedTag: overrides.feedTag ?? env.GPUIV_GITHUB_FEED_TAG ?? "app-feed",
  }
  const missing = (["repository", "token"] as const).filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(
      `Incomplete GitHub feed configuration, missing: ${missing.join(", ")}. ` +
        `Set GPUIV_GITHUB_REPOSITORY/GPUIV_GITHUB_TOKEN (or the GITHUB_REPOSITORY/GITHUB_TOKEN Actions defaults).`,
    )
  }
  return config
}

export class GithubStore implements FeedStore {
  private readonly config: GithubEnvConfig
  /** Releases fetched this run — assets are looked up and replaced by name. */
  private readonly releases = new Map<string, GithubRelease>()

  constructor(config: GithubEnvConfig) {
    this.config = config
  }

  url(key: string): string {
    const { tag, asset } = this.splitKey(key)
    return `https://github.com/${this.config.repository}/releases/download/${tag}/${asset}`
  }

  async put(key: string, body: Buffer | string, _options: FeedStorePutOptions): Promise<void> {
    const { tag, asset } = this.splitKey(key)
    const release = await this.ensureRelease(tag)
    // An existing asset of the same name is replaced: re-publishing a
    // fragment and flipping the channel pointer must not 422.
    const existing = release.assets.find((candidate) => candidate.name === asset)
    if (existing) {
      await this.request(`/repos/${this.config.repository}/releases/assets/${existing.id}`, {
        method: "DELETE",
        expect: 204,
      })
      release.assets = release.assets.filter((candidate) => candidate.id !== existing.id)
    }
    const upload = await this.request(
      `${this.config.uploadApi}/repos/${this.config.repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset)}`,
      {
        method: "POST",
        body: typeof body === "string" ? body : new Uint8Array(body),
        headers: { "Content-Type": "application/octet-stream" },
        expect: 201,
      },
    )
    const uploaded = (await upload.json()) as GithubReleaseAsset
    release.assets.push(uploaded)
  }

  async get(key: string): Promise<Buffer | null> {
    const { tag, asset } = this.splitKey(key)
    const release = await this.ensureRelease(tag)
    const found = release.assets.find((candidate) => candidate.name === asset)
    if (!found) return null
    // octet-stream makes the API 302 to a signed CDN URL; the auth header
    // is deliberately dropped on that hop (the signature is the credential).
    const response = await this.request(found.url, {
      headers: { Accept: "application/octet-stream" },
      expect: 200,
      followRedirects: true,
    })
    return Buffer.from(await response.arrayBuffer())
  }

  private splitKey(key: string): { tag: string; asset: string } {
    const versioned = key.match(/^releases\/([^/]+)\/(.+)$/)
    if (versioned) {
      return { tag: `${this.config.tagPrefix}${versioned[1]}`, asset: versioned[2] }
    }
    if (key && !key.includes("/")) {
      return { tag: this.config.feedTag, asset: key }
    }
    throw new Error(
      `Unsupported feed key "${key}" for the GitHub store — expected releases/<version>/<asset> or <channel>.json`,
    )
  }

  private async ensureRelease(tag: string): Promise<GithubRelease> {
    const cached = this.releases.get(tag)
    if (cached) return cached
    const response = await this.request(
      `/repos/${this.config.repository}/releases/tags/${encodeURIComponent(tag)}`,
      { allowNotFound: true },
    )
    let release: GithubRelease
    if (response.status === 404) {
      const created = await this.request(`/repos/${this.config.repository}/releases`, {
        method: "POST",
        body: JSON.stringify({
          tag_name: tag,
          name: tag,
          prerelease: true,
          body: "Auto-update feed objects — managed by gpuiv-packager (publish/promote).",
        }),
        expect: 201,
      })
      release = (await created.json()) as GithubRelease
    } else {
      release = (await response.json()) as GithubRelease
    }
    this.releases.set(tag, release)
    return release
  }

  private async request(
    url: string,
    options: {
      method?: string
      body?: string | Uint8Array
      headers?: Record<string, string>
      expect?: number
      allowNotFound?: boolean
      followRedirects?: boolean
    } = {},
  ): Promise<Response> {
    const absolute = url.startsWith("http") ? url : `${this.config.api.replace(/\/+$/, "")}${url}`
    const response = await fetch(absolute, {
      method: options.method ?? "GET",
      body: options.body,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
      redirect: options.followRedirects ? "follow" : "manual",
    })
    if (options.allowNotFound && response.status === 404) return response
    if (options.expect && response.status !== options.expect) {
      throw new Error(
        `GitHub ${options.method ?? "GET"} ${url} failed: ${response.status} ${await response.text().catch(() => "")}`,
      )
    }
    if (!options.expect && !response.ok) {
      throw new Error(`GitHub ${options.method ?? "GET"} ${url} failed: ${response.status}`)
    }
    return response
  }
}
