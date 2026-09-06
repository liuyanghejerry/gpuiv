---
title: Auto-Update Plan
description: S3-backed auto-update for packaged GPUIV apps — immutable versioned artifacts plus a signed channel manifest, an ed25519-pinned pure-TS updater client, per-platform apply-and-relaunch mechanics, and the publish CLI that drives it from CI.
---

# Auto-Update Plan

The update half of [packaging-plan.md](./packaging-plan.md). **P1 is
implemented** (`@gpuiv/packager publish`/`promote`/`keygen`,
`createUpdater` in `@gpuiv/vue`, per-platform apply, CI wiring behind
secrets, the chat update banner) **and verified end-to-end in CI**: the
manual-dispatch `update-e2e` job runs `examples/update-e2e.ts` on macOS
and Windows — two packaged versions against an in-process mock S3, the
v0.1.0 product auto-updates itself to the published v0.2.0 and the job
asserts the on-disk executable hash, leftover cleanup, and that the feed
actually served the download. The implementation record is at the bottom.
It assumes the P0 packaging pipeline exists (`bun run package` →
per-target zips).

## Goal

A packaged app checks a static HTTPS endpoint, downloads a newer version of
itself, verifies it, swaps itself in, and relaunches — without an installer,
without an app store, and without the user re-clicking anything after the
first install. The storage is any **S3-compatible object store** (S3, R2,
MinIO, Aliyun OSS, Backblaze B2): the update feed is plain objects, no
server-side logic anywhere.

Non-goals for v1: differential/delta updates, staged percentage rollout,
Linux (AppImage has its own story), and a UI — the framework ships the
engine and events; each app renders its own progress UI.

## Decision record

- **S3-compatible static storage, not GitHub Releases.** Releases tie the
  feed to one host, one auth model, and rate limits; an S3 prefix is a URL
  the client already knows how to consume, works on every cloud and
  self-hosted (MinIO), and puts a CDN in front for free. GitHub Releases can
  still *be* that URL later — the client never knows.
- **A custom JSON manifest + ed25519, not Sparkle.** Sparkle is the macOS
  standard but it is an Objective-C framework: wiring it in means linking it
  through the zed fork and exposing it over napi, a large native surface for
  one feature. Sparkle 2's *trust model* (ed25519 detached signatures, the
  public key baked into the app) is adopted instead — the update engine
  itself is ~pure TypeScript (fetch, fs, `node:child_process`), which is the
  smallest possible translation for this stack. Windows gets the same
  protocol instead of a second one (Squirrel/WU), so one client and one
  publish path cover every platform.
- **Signature on top of TLS and sha256.** TLS protects the transport, the
  hash protects integrity, the ed25519 signature protects against the thing
  this design actually fears: a compromised bucket, a hijacked CDN config,
  or a rollback attack served over perfectly valid HTTPS. The signing public
  key is injected at **package time** (`updatePublicKey` in
  `gpuiv.package.ts` → `define` constant), so no feed content can change
  what the app trusts.
- **Full-file updates in v1.** Products are 32–45 MB zipped; a desktop app
  shipping ~40 MB per update is normal (Slack and Discord ship more).
  Deltas are a real optimization later, not a blocker now.

## Feed layout

```
<s3://bucket/prefix>/                       ← one prefix per product
  stable.json                               ← the ONLY mutable object
  beta.json                                 ← (optional second channel)
  releases/
    0.2.0/                                  ← immutable once written
      GPUIX-Chat-0.2.0-darwin-arm64.zip
      GPUIX-Chat-0.2.0-darwin-arm64.zip.sig
      GPUIX-Chat-0.2.0-darwin-x64.zip
      GPUIX-Chat-0.2.0-darwin-x64.zip.sig
      GPUIX-Chat-0.2.0-win32-x64.zip
      GPUIX-Chat-0.2.0-win32-x64.zip.sig
      release.json                          ← per-release manifest (immutable)
```

- **Channel pointers** (`stable.json`) are tiny, re-pointed on every
  release, and must be served with `Cache-Control: max-age=60` (S3 or CDN).
  Everything under `releases/` is content-addressed by version and served
  `Cache-Control: immutable`.
- **Rollback** is re-pointing `stable.json` at an older `release.json`.
- **Concurrent publishes never fight over the pointer**: CI's macOS and
  Windows jobs write only their own immutable `releases/<version>/*`
  objects. A final `promote` step (below) is the only writer of the channel
  pointer — no read-modify-write races between platform jobs.

### `release.json` (per release, immutable)

```json
{
  "name": "0.2.0",
  "version": "0.2.0",
  "notes": "Fixes the composer paste…",
  "pubDate": "2026-09-20T12:00:00Z",
  "minimumAutoupdateVersion": "0.1.0",
  "platforms": {
    "darwin-arm64": {
      "url": "https://cdn.example.com/chat/releases/0.2.0/GPUIX-Chat-0.2.0-darwin-arm64.zip",
      "size": 33554432,
      "sha256": "…",
      "signature": "…ed25519 over the zip bytes…"
    },
    "darwin-x64": { "…": "…" },
    "win32-x64": { "…": "…" }
  }
}
```

### `stable.json` (channel pointer)

```json
{
  "channel": "stable",
  "release": "0.2.0",
  "releaseUrl": "https://cdn.example.com/chat/releases/0.2.0/release.json"
}
```

One indirection on purpose: the pointer is cheap to poll, the full release
manifest changes per version (cache-friendly), and a channel can be moved
or rolled back without rewriting platform lists.

## Trust model and keys

- `gpuiv-packager keygen` generates an **ed25519** pair once per product:
  the private key lives in CI secrets (or the maintainer's Keychain), the
  public key goes into `gpuiv.package.ts` (`updatePublicKey`) and is baked
  into the binary at package time.
- `gpuiv-packager publish` signs **the zip bytes** of every artifact
  (detached `.sig` uploaded beside it) and records `sha256` + signature in
  `release.json`.
- The client accepts a manifest only if: fetched over HTTPS, version is
  newer (semver), and the downloaded zip matches `size` + `sha256` and
  **verifies against the pinned public key** (`node:crypto` ed25519 works
  under bun; no native code needed).
- Key rotation follows Sparkle's pattern: the config takes an **array** of
  accepted public keys (`updatePublicKeys: [newKey, oldKey]`); sign with the
  new key, keep the old one accepted for one release cycle, then drop it.

## Client engine (pure TS, `@gpuiv/vue`)

New module `updater.ts`, exported as `createUpdater(opts)`:

```ts
const updater = createUpdater({
  feedUrl: 'https://cdn.example.com/chat/stable.json',
  channel: 'stable',
  publicKey: UPDATE_PUBLIC_KEY,   // define-injected at package time
  autoCheck: { onLaunch: true, everyMs: 4 * 3600_000 },
})
updater.on('download-progress', (p) => (bar.value = p))
await updater.checkForUpdates()
await updater.downloadUpdate()
await updater.applyAndRelaunch()  // or queueApplyOnQuit()
```

- **Checks** happen on launch and every `everyMs`; `isPackaged()` gates the
  whole engine — `bun --hot` development never self-updates.
- **Download** streams to a temp dir under the app data folder, emitting
  progress events (bytes, total, percent) so the app renders its own bar.
  sha256 is checked while streaming; a mismatch aborts before apply.
- **Apply is a two-phase commit per platform.** The invariant: at every
  instant there is a complete, launchable app on disk, and a crash at any
  point leaves the current version runnable.

### macOS apply

1. Unzip to `<app-dir>/../.gpuiv-update-<version>/` (verified product).
2. Move the running `Foo.app` → `~/Library/Application Support/<bundleId>/
   old-versions/Foo-<old>.app` (backup, pruned to the last 2).
3. Move the new `.app` into place; relaunch the new executable detached;
   exit.
   A crash between 2 and 3 leaves the app missing — so the order is
   *copy-in, then evict*: move new `.app` in under a temp name, swap names
   (two renames), keep the old as the backup. Renames on the same volume
   are atomic per-file; the swap window is two syscalls wide.

### Windows apply

A running exe cannot be overwritten but **can be renamed**:

1. Extract the new version to `app-dir/../.gpuiv-update-<version>/`.
2. Rename the running `Chat.exe` → `Chat.exe.old`; move the new exe and
   files over the old ones.
3. Spawn the new exe detached, exit; on next launch, delete any
   `*.old*` leftovers before the UI comes up.

### Relaunch

`spawn(newExe, [], { detached: true, stdio: 'ignore' }).unref()` from
`node:child_process`, then `process.exit(0)`. Works identically for the
GUI-subsystem Windows exe.

### Failure modes

| Failure | Behavior |
|---|---|
| Feed unreachable / bad JSON | Silent skip (log); next timer retries |
| Download interrupted | Temp file discarded; nothing applied |
| Hash/signature mismatch | Update refused with an error event — the single most important safety property |
| Power loss mid-swap | macOS: either old (rename not yet done) or new (renames done) `.app` is complete. Windows: `Chat.exe.old` dance completes or next launch cleans `*.old` |
| New version crashes at startup | v1: manual rollback by re-downloading; v2: launch-count health check before evicting the backup |

## Publish tooling (`gpuiv-packager`)

```
gpuiv-packager keygen                                     # once per product
gpuiv-packager publish \
  --channel stable \
  --endpoint https://<account>.r2.cloudflarestorage.com \
  --bucket chat-releases --prefix chat \
  --region auto \
  --target darwin-arm64 --target darwin-x64               # what THIS run built
```

- Signing requests with **aws4fetch** (≈2 KB, WebCrypto-based — works under
  bun against every S3-compatible endpoint; the AWS SDK v3 client is a
  hundred times heavier for four PUTs).
- `publish` uploads the immutable versioned objects for **only the targets
  it built** and writes `releases/<version>/release.json` with those
  platforms.
- **`promote --channel stable`** is a separate step: it downloads the
  release manifest, optionally merges platforms from other CI jobs'
  publishes, and writes the channel pointer. In CI, the macOS and Windows
  package jobs each `publish`; a final job (needs both) runs `promote`.
  This is the only writer of `stable.json`.
- The step is gated on secrets (`GPUIV_S3_*`, `GPUIV_UPDATE_PRIVATE_KEY`)
  exactly like the P1 signing hooks — absent on forks, CI stays green.

## App-side contract

- Config: `updatePublicKeys` (string[]), `updateFeedUrl`, `updateChannel`.
  Both are `define`-injected into the bundle at package time.
- The packager refuses `publish` when the config has no key pinned — an
  unsigned feed must be impossible to produce by accident.
- The updater emits: `checking`, `update-available`, `up-to-date`,
  `download-progress`, `downloaded`, `error`, plus `apply-and-relaunch` /
  `apply-on-quit` commands. A "Check for Updates…" menu item (the macOS
  convention, alongside `appName`) lands with the app-menu work.

## Phasing

**P1 — working updates, signed**
keygen + sign in publish CLI; updater engine (check/download/verify);
macOS + Windows apply-and-relaunch; `promote` + CI wiring behind secrets;
chat example update banner.

**P2 — polish**
delta updates (zstd patches from N−1, client picks by its own version);
staged rollout (`rolloutPercent` in the channel pointer, client-side
stable-random decision); startup health check before backup eviction;
key-rotation drill documented; Linux (AppImage `appimageupdate`-style or
same tar swap).

## Open questions

- **Delta patch format** — zstd double-diff of the zips (small, but the
  client must keep its original zip or re-derive it) vs binary diff of the
  executables (bsdiff is O(large) to compute in CI). Decide when sizes
  actually hurt.
- **Whether the channel pointer should carry the full release manifest
  inline** (one request, no indirection) at the cost of re-uploading it on
  every platform merge. Keep the pointer thin for now; revisit if the
  second request shows up in profiling.
- **Stats** — download counts are the one thing static hosting cannot
  answer. If needed later: one signed PUT per update to a counter object,
  off by default.

## Implementation record (P1)

Verified end-to-end on macOS: two packaged versions of the chat example
(v0.1.0 with a pinned local feed, v0.2.0 published through `publish` +
`promote` to a mock S3), the v0.1.0 product launched through automation,
auto-checked, auto-downloaded 31 MB, verified, and after clicking
*Restart* its `.app` on disk became byte-identical to the v0.2.0 build
with no swap leftovers. What the build surfaced beyond the design:

- **`Bun.isStandaloneExecutable` is `undefined` on bun 1.3.14**, so
  `isPackaged()` also detects the `$bunfs` virtual path in `Bun.main` —
  the first packaged chat never updated because the updater's own guard
  thought it was a development run.
- **Publish writes per-target fragments (`manifest-<target>.json`), not a
  partial `release.json`** — the design sketch had each platform job
  writing the release manifest with only its platforms, which the second
  job would overwrite. `promote` is the only writer of both the merged
  `release.json` and the channel pointer.
- **Binding resolution walks up from the entry file's directory too.** A
  config can live outside the app tree (CI checkouts, scratch configs);
  resolution from the config directory alone dead-ends in `/tmp`.
- **The publish CLI takes S3 credentials from env only** (flags carry the
  location: endpoint/region/bucket/prefix) — keys belong in CI secrets,
  not in command lines.
- **macOS swap deletes the old bundle after the new one is in place**
  (not the design's "keep two backups"): an 80 MB product makes 2×80 MB of
  retained backups hard to justify, and rollback-by-redownload matches
  everything else here. A power loss mid-swap still leaves either the old
  or the new bundle complete.
- **Styles are `StyleDesc`, not CSS**: the first banner used
  `padding: '8px 12px'` shorthand and the batch failed with
  `invalid type: string "8px 12px", expected f64` — per-side numeric
  padding only.
- **The updater engine is node-safe** (no `Bun.*` globals, `node:http`
  mocks) so the vitest suites cover semver, signature acceptance/rejection/
  rotation, feed decisions, and a real ditto-zipped `.app` swap without a
  GPU or a window.
- **The e2e driver must spawn children asynchronously**: its mock S3 lives
  in the same process, and a `spawnSync` child blocks the event loop that
  has to serve the publish PUTs — the first run deadlocked into a fetch
  timeout. The Windows swap deletes the `.old` exe at the replacement's
  startup with a delayed retry (the dying process may still hold the lock
  for a moment).
