/** macOS product: wrap the compiled executable in a `.app` bundle, place the
 * icon and extra resources, ad-hoc codesign, and zip with `ditto` (which
 * preserves executable bits and the bundle structure — plain `zip` does not).
 *
 * Release signing/notarization is a CI concern (Developer ID + notarytool);
 * ad-hoc signing is what makes the bundle locally runnable and structurally
 * identical to a signed one. */

import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { run } from "./run.js"
import type { PackageConfig } from "./config.js"

export function wrapMacApp(opts: {
  config: PackageConfig
  appPath: string
  exePath: string
}): void {
  const { config, appPath, exePath } = opts
  mkdirSync(path.dirname(exePath), { recursive: true })
  const resources = path.join(appPath, "Contents", "Resources")
  mkdirSync(resources, { recursive: true })
  chmodSync(exePath, 0o755)

  if (config.icon?.darwin) {
    copyFileSync(config.icon.darwin, path.join(resources, "AppIcon.icns"))
  } else {
    console.warn("[gpuiv-packager] no darwin icon configured; the .app will use the generic system icon")
  }
  for (const resource of config.extraResources) {
    copyFileSync(resource, path.join(resources, path.basename(resource)))
  }

  writeFileSync(path.join(appPath, "Contents", "Info.plist"), infoPlist(config))
  // Bump the bundle so Finder picks up the freshly written plist/icon.
  run("touch", [appPath])
  adHocSign(appPath)
}

function infoPlist(config: PackageConfig): string {
  const entries: Record<string, string | number | boolean> = {
    CFBundleDevelopmentRegion: "en",
    CFBundleDisplayName: config.productName,
    CFBundleExecutable: config.productName,
    CFBundleIconFile: "AppIcon",
    CFBundleIdentifier: config.bundleId,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: config.productName,
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: config.version,
    CFBundleVersion: "1",
    LSMinimumSystemVersion: config.minSystemVersion ?? "13.0",
    NSHighResolutionCapable: true,
    ...(config.description ? { CFBundleGetInfoString: config.description } : {}),
    ...(config.mac?.plist ?? {}),
  }
  const body = Object.entries(entries)
    .map(([key, value]) => {
      const tag = typeof value === "number" ? "integer" : typeof value === "boolean" ? (value ? "true" : "false") : "string"
      if (typeof value === "boolean") return `  <key>${key}</key>\n  <${tag}/>`
      return `  <key>${key}</key>\n  <${tag}>${escapeXml(String(value))}</${tag}>`
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function adHocSign(appPath: string): void {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath], { allowFailure: true })
}

export function zipDarwin(opts: { appPath: string; zipPath: string }): void {
  rmSync(opts.zipPath, { force: true })
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", opts.appPath, opts.zipPath])
}
