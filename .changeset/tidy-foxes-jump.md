---
'@gpuiv/packager': minor
---

macOS packaging builds a `.dmg` beside the zip by default (plain UDZO image via `hdiutil`, volume name = product name): humans get the drag-to-Applications shape while the zip remains the auto-update and notarization artifact. Opt out with `--no-dmg` or `mac.dmg: false`; packaging from non-macOS hosts skips it automatically. `PackageResult.artifactDmg` reports the path.
