# Publishing

**Never publish from a local machine.** CI is the only release path. Both packages' `prepublishOnly` scripts exit if `CI` is unset.

`.github/workflows/ci.yml` builds `@gpuiv/native` for every napi target (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64), uploads the `.node` artifacts, then the `publish` job downloads them, runs `napi create-npm-dirs` + `napi artifacts`, and publishes `@gpuiv/native` and `@gpuiv/vue`. macOS and Windows build with `build` (test-support included: Metal / DirectX `TestGpuixRenderer`), and CI runs the full vue + example suites on both. Linux builds with `build:release` (`--no-default-features`, no test-support — waiting on GPUI's wgpu image readback).

Publish order is required. `@gpuiv/vue` depends on `@gpuiv/native` (`workspace:^`, rewritten to the exact published version in CI). If Vue publishes first, an install in that window cannot resolve native.

1. `napi pre-publish` publishes the per-platform packages (`darwin-arm64`, `linux-x64-gnu`, …)
2. `npm publish` publishes `@gpuiv/native`
3. `npm publish` publishes `@gpuiv/vue`

NPM tokens are a plain GitHub secret: `NPM_TOKEN` holds an npm **granular access token** with publish rights on the `gpuiv` org (granular is required for `--provenance`; classic/automation tokens cannot sign provenance). The publish steps skip versions already on npm. To release: bump versions via changesets, push to `main`.
