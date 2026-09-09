# Publishing

**Never publish from a local machine.** CI is the only release path. Both packages' `prepublishOnly` scripts exit if `CI` is unset.

`.github/workflows/ci.yml` builds `@gpuiv/native` for every napi target (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64), uploads the `.node` artifacts, then the publish jobs download them, run `napi create-npm-dirs` + `napi artifacts`, and publish every package. macOS and Windows build with `build` (test-support included: Metal / DirectX `TestGpuixRenderer`), and CI runs the full vue + example suites on both. Linux builds with `build:release` (`--no-default-features`, no test-support — waiting on GPUI's wgpu image readback).

Publish order is required. `@gpuiv/vue` depends on `@gpuiv/native` (`workspace:^`, rewritten to the exact published version in CI). If Vue publishes first, an install in that window cannot resolve native.

1. `publish-platform` (matrix) publishes the per-platform packages (`@gpuiv/native-darwin-arm64`, `@gpuiv/native-linux-x64-gnu`, …), one job per package
2. `publish-native` writes the per-platform `optionalDependencies` (`napi pre-publish --skip-optional-publish`), then publishes `@gpuiv/native` with `--ignore-scripts` (its `prepublishOnly` would re-run the platform publishes)
3. `publish-vue` publishes `@gpuiv/vue`

Publishing authenticates with **npm Trusted Publishing** (OIDC): no npm token is stored in GitHub or anywhere else. Each of the 8 packages must have a trusted publisher configured on npmjs.com (package → Settings → Trusted Publisher: org/user `liuyanghejerry`, repository `gpuiv`, workflow filename `ci.yml`); npm only allows configuring this on a package that already exists, so a brand-new package's first version must be published once with a temporary granular token. Each package publishes in its own job because every `npm publish` requests its own OIDC token from GitHub (npm CLI ≥ 11.5.1 required; Node 24 ships 11.19). The publish steps skip versions already on npm. To release: bump versions via changesets, push to `main`.
