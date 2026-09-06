/** Minimal S3-compatible client over aws4fetch (docs/auto-update-plan.md).
 *
 * Four operations, path-style addressing, SigV4 — works against S3, R2,
 * MinIO, OSS, B2 and anything else that speaks the S3 REST surface. aws4fetch
 * is ~2 KB of WebCrypto; the AWS SDK v3 client would be a hundred times
 * heavier for four PUTs. */

import { AwsClient } from "aws4fetch"

export interface S3StoreOptions {
  /** e.g. `https://s3.us-east-1.amazonaws.com` or an R2/MinIO endpoint. */
  endpoint: string
  region: string
  bucket: string
  /** Key prefix inside the bucket (one product per prefix), no slashes. */
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3Store {
  private readonly client: AwsClient
  private readonly options: S3StoreOptions

  constructor(options: S3StoreOptions) {
    this.options = options
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      service: "s3",
      region: options.region,
    })
  }

  /** Public URL of an object (what goes into the release manifest). */
  url(key: string): string {
    const { endpoint, bucket, prefix } = this.options
    return `${endpoint.replace(/\/+$/, "")}/${bucket}/${prefix}/${key}`
  }

  async put(
    key: string,
    body: Buffer | string,
    opts: { contentType: string; cacheControl: string } = {
      contentType: "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    },
  ): Promise<void> {
    const response = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: typeof body === "string" ? body : new Uint8Array(body),
      headers: {
        "Content-Type": opts.contentType,
        "Cache-Control": opts.cacheControl,
      },
    })
    if (!response.ok) {
      throw new Error(`S3 PUT ${key} failed: ${response.status} ${await response.text().catch(() => "")}`)
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.client.fetch(this.url(key), { method: "GET" })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`S3 GET ${key} failed: ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
}

export interface S3EnvConfig {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

/** S3 location from flags over `GPUIV_S3_*` over `AWS_*` env. */
export function resolveS3Config(overrides: Partial<S3EnvConfig> = {}): S3EnvConfig {
  const env = process.env
  const config = {
    endpoint: overrides.endpoint ?? env.GPUIV_S3_ENDPOINT ?? "",
    region: overrides.region ?? env.GPUIV_S3_REGION ?? env.AWS_REGION ?? "us-east-1",
    bucket: overrides.bucket ?? env.GPUIV_S3_BUCKET ?? "",
    prefix: overrides.prefix ?? env.GPUIV_S3_PREFIX ?? "",
    accessKeyId: overrides.accessKeyId ?? env.GPUIV_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: overrides.secretAccessKey ?? env.GPUIV_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY ?? "",
  }
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(
      `Incomplete S3 configuration, missing: ${missing.join(", ")}. ` +
        `Set GPUIV_S3_ENDPOINT/REGION/BUCKET/PREFIX/ACCESS_KEY_ID/SECRET_ACCESS_KEY or pass --endpoint/--bucket/--prefix.`,
    )
  }
  return config
}
