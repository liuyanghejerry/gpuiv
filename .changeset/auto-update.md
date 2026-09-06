---
'@gpuiv/vue': minor
---

Add S3-backed auto-update for packaged apps: `createUpdater()` checks a signed channel feed, downloads with progress, verifies sha256 + an ed25519 signature against keys pinned at package time, and applies a two-phase per-platform swap (`.app` rename on macOS, running-exe rename on Windows) before relaunching; the Windows replacement cleans the renamed old exe at startup. `isPackaged()` now also detects bun 1.3 compiled executables (`$bunfs` entry path). The packager gains `keygen`/`publish`/`promote` commands (aws4fetch, any S3-compatible endpoint) and `updatePublicKeys`/`updateFeedUrl` config baked into products via define injection; a manual-dispatch CI job verifies the full self-update on macOS and Windows against an in-process mock S3. Design record: `docs/auto-update-plan.md`.
