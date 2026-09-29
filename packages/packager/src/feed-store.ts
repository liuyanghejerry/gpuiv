/** The storage seam of the update feed (docs/auto-update-plan.md).
 *
 * The feed is a small set of keys: immutable per-version objects under
 * `releases/<version>/…` and one mutable `<channel>.json` pointer. S3 was
 * the first backend; the GitHub store serves the same keys as release
 * assets so publish/promote and the updater protocol stay unchanged. */

import { GithubStore, resolveGithubConfig, type GithubEnvConfig } from "./github.js"
import { resolveS3Config, S3Store, type S3EnvConfig } from "./s3.js"

export interface FeedStorePutOptions {
  contentType: string
  cacheControl: string
}

export interface FeedStore {
  /** Public URL of an object (what goes into the release manifest). */
  url(key: string): string
  put(key: string, body: Buffer | string, options: FeedStorePutOptions): Promise<void>
  /** `null` when the key does not exist (promote's fragment lookup). */
  get(key: string): Promise<Buffer | null>
}

export type FeedStoreKind = "s3" | "github"

export interface FeedStoreOptions {
  s3?: Partial<S3EnvConfig>
  github?: Partial<GithubEnvConfig>
}

export function openFeedStore(kind: FeedStoreKind, options: FeedStoreOptions = {}): FeedStore {
  if (kind === "github") {
    return new GithubStore(resolveGithubConfig(options.github))
  }
  return new S3Store(resolveS3Config(options.s3))
}
