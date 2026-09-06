import type { PackageConfig } from '@gpuiv/packager'

/** Packaging config for the chat example.
 *
 * `bun run icons` generates dist/app-icon.icns / dist/app-icon.ico from the
 * SVG (dev machine only — the packager consumes the files, never makes
 * them), then `bun run package` builds the products listed in `targets`. */
export default {
  entry: './chat.tsx',
  productName: 'GPUIX Chat',
  bundleId: 'dev.gpuix.chat',
  version: '0.1.0',
  publisher: 'GPUIV',
  description: 'Waku-style desktop app built with GPUIV',
  icon: {
    darwin: './dist/app-icon.icns',
    win32: './dist/app-icon.ico',
  },
  // win32 targets build in the package-windows CI job (Windows icon/version
  // metadata needs host Windows APIs).
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'],
} satisfies PackageConfig
