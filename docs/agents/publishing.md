# Publishing

**Never publish from a local machine.** CI is the only release path. Both packages' `prepublishOnly` scripts exit if `CI` is unset.

`.github/workflows/ci.yml` builds `@gpuiv/native` for every napi target (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64), uploads the `.node` artifacts, then the publish jobs download them, run `napi create-npm-dirs` + `napi artifacts`, and publish every package. macOS and Windows build with `build` (test-support included: Metal / DirectX `TestGpuixRenderer`), and CI runs the full vue + example suites on both. Linux builds with `build:release` (`--no-default-features`, no test-support — waiting on GPUI's wgpu image readback).

Publish order is required. `@gpuiv/vue` depends on `@gpuiv/native` (`workspace:^`, rewritten to `^<published native version>` in CI). If Vue publishes first, an install in that window cannot resolve native.

1. `publish-platform` (matrix) publishes the per-platform packages (`@gpuiv/native-darwin-arm64`, `@gpuiv/native-linux-x64-gnu`, …), one job per package
2. `publish-native` writes the per-platform `optionalDependencies` (`napi pre-publish --skip-optional-publish`), then publishes `@gpuiv/native` with `--ignore-scripts` (its `prepublishOnly` would re-run the platform publishes)
3. `publish-vue` publishes `@gpuiv/vue`

Publishing authenticates with **npm Trusted Publishing** (OIDC): no npm token is stored in GitHub or anywhere else. Each of the 8 packages must have a trusted publisher configured on npmjs.com (package → Settings → Trusted Publisher: org/user `liuyanghejerry`, repository `gpuiv`, workflow filename `ci.yml`); npm only allows configuring this on a package that already exists, so a brand-new package's first version must be published once with a temporary granular token. Each package publishes in its own job because every `npm publish` requests its own OIDC token from GitHub (npm CLI ≥ 11.5.1 required; Node 24 ships 11.19). The publish steps skip versions already on npm. To release: bump versions via changesets, push to `main`.

Concretely: run `bunx @changesets/cli version` (the `changepub` tool referenced in older notes is not on npm). It consumes `.changeset/*.md`, bumps both packages together (fixed group in `.changeset/config.json`) and writes `packages/{native,vue}/CHANGELOG.md`; the root `CHANGELOG.md` is a pointer. Then rebuild native (`bun run build` in `packages/native`) so `index.js` carries the new loader version check, run the suites, and push the release commit straight to `main` — **do not open a PR for it**: the publish jobs also run on PR CI, and the version guard only checks npm, so a PR whose version is not yet published would publish it before merge. Because every publish step skips versions already on npm, re-running a partially failed release workflow after fixing the cause (e.g. a missing npm trusted publisher) completes the release.
