---
'@gpuiv/packager': minor
---

`gpuiv-packager publish`/`promote --store github` serves the auto-update feed from GitHub Releases instead of S3, for teams without object storage: immutable per-version objects (`releases/<version>/…`) land as assets of prereleases tagged `app-v<version>`, and the mutable `<channel>.json` pointer is replaced on the `app-feed` release (delete + re-upload). Manifest URLs point at public `github.com/…/releases/download/…` assets the updater fetches without auth — the client and the signing protocol are unchanged; S3 stays the default store. CI opts in with the `GPUIV_FEED_STORE=github` repository variable (the workflow token with `contents: write` is the only credential).
