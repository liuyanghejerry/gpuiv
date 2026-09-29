---
'@gpuiv/packager': minor
---

Linux targets now produce a distributable artifact: the executable folder is archived as `<Product>-<target>.tar.gz` (self-contained top-level directory, bsdtar/GNU-tar compatible flags), replacing the "shipping the folder unpacked" warning. `PackageResult.artifactZip` reports the tarball. A `package-linux` CI job builds both linux arches on an ubuntu runner and uploads the artifacts; auto-update for linux targets remains P2. AppImage stays P2 — it needs `linuxdeploy` on a Linux host.
