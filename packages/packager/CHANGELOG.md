# @gpuiv/packager

## 0.2.1

### Patch Changes

- cab21fa: Add user-facing npm READMEs with installation instructions, minimal examples, platform notes, and documentation links for the native, Vue, Animal Island, and packager packages.
- Updated dependencies [cab21fa]
  - @gpuiv/vue@0.6.1

## 0.2.0

### Minor Changes

- dc3e33d: Windows and Linux file associations now have a run-time registration path for the portable products: new `win.fileAssociations` / `linux.fileAssociations` config groups, and `gpuiv-packager register [--config] [--product-dir] [--dry-run]` performs per-user registration on the host OS — no installer, no admin. Windows writes `HKCU\Software\Classes` ProgIds (quoted open command, icon) plus per-extension `OpenWithProgids`, so the app shows in Explorer's Open-with list (the default-handler claim stays the user's click — `UserChoice` is hash-protected by design); Linux installs `~/.local/share/applications/<bundleId>.desktop` (quoted `Exec`, joined `MimeType`) and refreshes `update-desktop-database` / `xdg-mime default`. Builders are pure and unit-tested on any host; on the wrong host the command prints the plan and exits non-zero. macOS needs no registration (bundle declarations). The Open Files example config declares `.md` associations for all three platforms.
- 9ecdebd: Linux targets now produce a distributable artifact: the executable folder is archived as `<Product>-<target>.tar.gz` (self-contained top-level directory, bsdtar/GNU-tar compatible flags), replacing the "shipping the folder unpacked" warning. `PackageResult.artifactZip` reports the tarball. A `package-linux` CI job builds both linux arches on an ubuntu runner and uploads the artifacts; auto-update for linux targets remains P2. AppImage stays P2 — it needs `linuxdeploy` on a Linux host.
- 4c9458f: `registerUrlScheme` now works on Windows and Linux instead of reporting unsupported. GPUI's platform ports leave the claim unimplemented, so the registration is done in GPUIV's own layer with the same per-user story the packager installs: Windows writes `HKCU\Software\Classes\<scheme>` candidate-handler keys (`URL Protocol` marker, quoted open command — the default-protocol claim remains the user's confirmation, Windows hash-protects protocol UserChoice), Linux merges `x-scheme-handler/<scheme>` into a per-user desktop entry and claims it via `xdg-mime`. Delivery (`onOpenUrls`) was already implemented on both platforms. The packager's `register` command also learned `win.urlSchemes` / `linux.urlSchemes` config for packaging-time declaration.
- 28cc549: macOS packaging builds a `.dmg` beside the zip by default (plain UDZO image via `hdiutil`, volume name = product name): humans get the drag-to-Applications shape while the zip remains the auto-update and notarization artifact. Opt out with `--no-dmg` or `mac.dmg: false`; packaging from non-macOS hosts skips it automatically. `PackageResult.artifactDmg` reports the path.
- bb60a1c: `gpuiv-packager publish`/`promote --store github` serves the auto-update feed from GitHub Releases instead of S3, for teams without object storage: immutable per-version objects (`releases/<version>/…`) land as assets of prereleases tagged `app-v<version>`, and the mutable `<channel>.json` pointer is replaced on the `app-feed` release (delete + re-upload). Manifest URLs point at public `github.com/…/releases/download/…` assets the updater fetches without auth — the client and the signing protocol are unchanged; S3 stays the default store. CI opts in with the `GPUIV_FEED_STORE=github` repository variable (the workflow token with `contents: write` is the only credential).

### Patch Changes

- Updated dependencies [4914c7b]
- Updated dependencies [811d00a]
- Updated dependencies [73772d7]
- Updated dependencies [879c2dc]
- Updated dependencies [04f9021]
- Updated dependencies [60ec8d1]
- Updated dependencies [3ef4af3]
- Updated dependencies [9cfbb1c]
- Updated dependencies [bff363b]
- Updated dependencies [08687c3]
- Updated dependencies [45f5d31]
- Updated dependencies [d634380]
- Updated dependencies [08687c3]
- Updated dependencies [5600352]
- Updated dependencies [4b0558b]
- Updated dependencies [525a332]
- Updated dependencies [11b7de2]
- Updated dependencies [eaf511d]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [5e230dd]
- Updated dependencies [71a105e]
- Updated dependencies [d2a05c5]
- Updated dependencies [d26b1c1]
- Updated dependencies [9f4fa9b]
- Updated dependencies [327fe05]
- Updated dependencies [3f526fe]
- Updated dependencies [21f87c4]
- Updated dependencies [94f6dc6]
- Updated dependencies [9f4fa9b]
- Updated dependencies [811d00a]
- Updated dependencies [1dd5711]
- Updated dependencies [cde4787]
- Updated dependencies [05167b2]
- Updated dependencies [8c272d1]
- Updated dependencies [0a97051]
- Updated dependencies [08687c3]
- Updated dependencies [435af61]
- Updated dependencies [07526d4]
- Updated dependencies [28ce86c]
- Updated dependencies [c785e86]
- Updated dependencies [4ccbf78]
- Updated dependencies [4ccbf78]
- Updated dependencies [364acfb]
- Updated dependencies [811d00a]
- Updated dependencies [1c53356]
- Updated dependencies [a596d9b]
- Updated dependencies [4c9458f]
- Updated dependencies [c2ff4ed]
- Updated dependencies [1f3d00a]
- Updated dependencies [e4f04a6]
- Updated dependencies [d2a05c5]
- Updated dependencies [848c464]
- Updated dependencies [5e95285]
- Updated dependencies [5eb859f]
- Updated dependencies [60e41d8]
- Updated dependencies [811d00a]
- Updated dependencies [1880c00]
- Updated dependencies [deda832]
- Updated dependencies [99a30d2]
- Updated dependencies [211e859]
- Updated dependencies [2cbf95f]
- Updated dependencies [ac3dacc]
- Updated dependencies [dbdd1dd]
- Updated dependencies [194ce52]
- Updated dependencies [bff363b]
  - @gpuiv/vue@0.6.0
