# @gpuiv/packager

Package [GPUIV](https://github.com/liuyanghejerry/gpuiv) applications into distributable desktop products. The packager uses Bun's executable compiler to bundle the application, its assets, and the selected native binding into one product.

- **macOS:** `.app`, zip, and optionally `.dmg`
- **Windows:** portable executable folder and zip
- **Linux:** x64 and ARM64 `.tar.gz` archives
- Optional per-user file associations, URL schemes, and signed auto-update feeds

Bun is required: the CLI and library execute their TypeScript sources directly.

## Install

```bash
bun add -d @gpuiv/packager
```

Create `gpuiv.package.ts` next to your application entry:

```ts
import type { PackageConfig } from '@gpuiv/packager'

export default {
  entry: './app.tsx',
  productName: 'My GPUIV App',
  bundleId: 'dev.example.myapp',
  version: '0.1.0',
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'],
} satisfies PackageConfig
```

Build the host target, or select one explicitly:

```bash
bunx gpuiv-packager build --config gpuiv.package.ts
bunx gpuiv-packager build --config gpuiv.package.ts --target darwin-arm64
```

Artifacts are written to `dist/package/` by default. Windows products must be built on Windows because their icon and version metadata use host Windows APIs. macOS `.dmg` creation requires macOS; Linux artifacts can be cross-compiled from a Linux x64 host.

When `smokeTestId` is configured and the target can run on the host, the packager launches the product through GPUIV's automation protocol and captures a screenshot before reporting success.

## Programmatic API

```ts
import { buildPackage } from '@gpuiv/packager'

const results = await buildPackage({
  configPath: './gpuiv.package.ts',
  targets: ['darwin-arm64'],
})
```

Each result reports the product directory, executable path, archive path, optional DMG path, and smoke-test screenshot.

## Documentation

- [Complete packaging guide](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md#packaging)
- [File associations and URL schemes](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/reference.md#file-opening-and-macos-document-associations)
- [Auto-update design](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/auto-update-plan.md)
- [Example configuration](https://github.com/liuyanghejerry/gpuiv/blob/main/examples/gpuiv.package.ts)
- [GPUIV application quick start](https://github.com/liuyanghejerry/gpuiv#quick-start)

Release signing/notarization, Linux AppImage output, and Linux self-update remain under development. See the [feature status](https://github.com/liuyanghejerry/gpuiv/blob/main/docs/status.md) for current boundaries.

[Apache-2.0](https://github.com/liuyanghejerry/gpuiv/blob/main/LICENSE)
