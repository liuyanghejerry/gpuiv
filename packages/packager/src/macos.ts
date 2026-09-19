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
import type { PackageConfig, PlistValue } from "./config.js"

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
  for (const resource of config.extraResources ?? []) {
    copyFileSync(resource, path.join(resources, path.basename(resource)))
  }

  writeFileSync(path.join(appPath, "Contents", "Info.plist"), infoPlist(config))
  // Bump the bundle so Finder picks up the freshly written plist/icon.
  run("touch", [appPath])
  adHocSign(appPath)
}

export function infoPlist(config: PackageConfig): string {
  const entries: Record<string, PlistValue> = {
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
    ...documentDeclarations(config),
    ...(config.mac?.plist ?? {}),
  }
  const body = Object.entries(entries)
    .map(([key, value]) => {
      return `  <key>${escapeXml(key)}</key>\n  ${plistValue(value)}`
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`
}

function documentDeclarations(config: PackageConfig): Record<string, PlistValue> {
  const result: Record<string, PlistValue> = {}
  if (config.mac?.documentTypes?.length) {
    result.CFBundleDocumentTypes = config.mac.documentTypes.map((type) => ({
      CFBundleTypeName: type.name,
      CFBundleTypeRole: type.role ?? "Editor",
      LSHandlerRank: type.rank ?? "Alternate",
      LSItemContentTypes: type.contentTypes,
    }))
  }
  for (const type of config.mac?.typeDeclarations ?? []) {
    const key = type.exported ? "UTExportedTypeDeclarations" : "UTImportedTypeDeclarations"
    const declarations = (result[key] ??= []) as PlistValue[]
    declarations.push({
      UTTypeIdentifier: type.identifier,
      ...(type.description ? { UTTypeDescription: type.description } : {}),
      UTTypeConformsTo: type.conformsTo,
      UTTypeTagSpecification: {
        "public.filename-extension": type.extensions,
        ...(type.mimeTypes ? { "public.mime-type": type.mimeTypes } : {}),
      },
    })
  }
  return result
}

function plistValue(value: PlistValue): string {
  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>"
  if (typeof value === "number" && Number.isFinite(value)) {
    const tag = Number.isInteger(value) ? "integer" : "real"
    return `<${tag}>${value}</${tag}>`
  }
  if (Array.isArray(value)) return `<array>${value.map(plistValue).join("\n")}</array>`
  if (value && typeof value === "object") {
    return `<dict>${Object.entries(value).map(([key, child]) => `<key>${escapeXml(key)}</key>${plistValue(child)}`).join("\n")}</dict>`
  }
  throw new Error("Info.plist values must be strings, finite numbers, booleans, arrays or dictionaries")
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
