/** Run-time file-association registration for the portable products
 * (Windows exe, Linux tarball) — the piece `mac.documentTypes` gets for free
 * from the `.app` bundle.
 *
 * Everything is per-user: HKCU registry keys on Windows, `~/.local/share` on
 * Linux. No installer, no admin, no elevation — the honest portable-app
 * story. `gpuiv-packager register` runs the host-matching half; builders are
 * pure so any host can inspect (and test) exactly what would be written. */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { LinuxFileAssociation, WinFileAssociation } from "./config.js"
import { loadConfig, defaultHostTargetName } from "./config.js"
import { getTargetSpec } from "./targets.js"
import { executableLayout } from "./bundle.js"
import { run } from "./run.js"

// ── Windows (registry plan) ───────────────────────────────────────────

export interface RegistryValue {
  /** Empty string is the key's default value. */
  name: string
  type: "REG_SZ"
  data: string
}

export interface RegistryKey {
  key: string
  values: RegistryValue[]
}

export interface WindowsAssociationPlan {
  progId: string
  keys: RegistryKey[]
}

/** The per-user registration plan for one association group. The app appears
 * in Explorer's "Open with" list for its extensions; claiming the DEFAULT
 * handler needs the user's one click (Microsoft hash-protects UserChoice
 * against programmatic writes, by design). */
export function windowsAssociationPlan(opts: {
  bundleId: string
  productName: string
  exePath: string
  association: WinFileAssociation
  groupIndex: number
}): WindowsAssociationPlan {
  const progId = opts.association.progId ?? `${opts.bundleId}.file${opts.groupIndex}`
  const name = opts.association.name ?? opts.productName
  const quoted = `"${opts.exePath}"`
  const keys: RegistryKey[] = [
    {
      key: `HKCU\\Software\\Classes\\${progId}`,
      values: [{ name: "", type: "REG_SZ", data: name }],
    },
    {
      key: `HKCU\\Software\\Classes\\${progId}\\DefaultIcon`,
      values: [{ name: "", type: "REG_SZ", data: `${quoted},0` }],
    },
    {
      key: `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`,
      values: [{ name: "", type: "REG_SZ", data: `${quoted} "%1"` }],
    },
  ]
  for (const extension of opts.association.extensions) {
    keys.push({
      key: `HKCU\\Software\\Classes\\.${extension}\\OpenWithProgids`,
      values: [{ name: progId, type: "REG_SZ", data: "" }],
    })
  }
  return { progId, keys }
}

/** Write the plan with `reg add`. Windows only — callers gate the host. */
export function registerWindowsAssociations(plan: WindowsAssociationPlan): void {
  writeRegistryKeys(plan.keys)
}

/** The per-user registration plan for one URL scheme (`myapp://…`). Registers
 * the app as a candidate handler; the default-protocol claim is the user's
 * confirmation — Windows hash-protects protocol UserChoice exactly like file
 * extensions. */
export function windowsUrlSchemePlan(opts: {
  scheme: string
  productName: string
  exePath: string
}): RegistryKey[] {
  const quoted = `"${opts.exePath}"`
  return [
    {
      key: `HKCU\\Software\\Classes\\${opts.scheme}`,
      values: [
        { name: "", type: "REG_SZ", data: `URL:${opts.productName} ${opts.scheme} protocol` },
        { name: "URL Protocol", type: "REG_SZ", data: "" },
      ],
    },
    {
      key: `HKCU\\Software\\Classes\\${opts.scheme}\\DefaultIcon`,
      values: [{ name: "", type: "REG_SZ", data: `${quoted},0` }],
    },
    {
      key: `HKCU\\Software\\Classes\\${opts.scheme}\\shell\\open\\command`,
      values: [{ name: "", type: "REG_SZ", data: `${quoted} "%1"` }],
    },
  ]
}

export function writeRegistryKeys(keys: RegistryKey[]): void {
  for (const key of keys) {
    for (const value of key.values) {
      const args = ["add", key.key]
      if (value.name) args.push("/v", value.name)
      else args.push("/ve")
      args.push("/t", value.type, "/d", value.data, "/f")
      run("reg", args)
    }
  }
}

// ── Linux (desktop entry) ─────────────────────────────────────────────

export interface DesktopEntrySpec {
  bundleId: string
  productName: string
  exePath: string
  associations: LinuxFileAssociation[]
  /** URL schemes; each becomes `x-scheme-handler/<scheme>` in MimeType. */
  urlSchemes?: string[]
}

/** The `.desktop` entry text. `Exec` quotes a spaced path and appends `%f`
 * so the file manager passes the opened file as argv. */
export function desktopEntry(spec: DesktopEntrySpec): string {
  const mimeTypes = [
    ...spec.associations.flatMap((group) => group.mimeTypes),
    ...(spec.urlSchemes ?? []).map((scheme) => `x-scheme-handler/${scheme}`),
  ]
  const names = new Set(spec.associations.map((group) => group.name ?? spec.productName))
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${[...names].join(" / ")}`,
    `Exec="${spec.exePath}" %f`,
    "Terminal=false",
    "NoDisplay=false",
  ]
  if (mimeTypes.length > 0) lines.push(`MimeType=${[...new Set(mimeTypes)].join(";")};`)
  return lines.join("\n") + "\n"
}

/** Install the entry per-user and refresh the desktop databases. Linux
 * only — callers gate the host. `update-desktop-database` and `xdg-mime`
 * may be absent on minimal distros; their failure warns instead of throwing
 * (the entry itself is what matters). */
export function registerLinuxAssociations(opts: DesktopEntrySpec & { iconPath?: string }): void {
  const home = process.env.HOME
  if (!home) throw new Error("HOME is unset — cannot locate ~/.local/share/applications")
  const applications = path.join(home, ".local", "share", "applications")
  mkdirSync(applications, { recursive: true })
  const desktopFile = `${opts.bundleId}.desktop`
  writeFileSync(path.join(applications, desktopFile), desktopEntry(opts))
  console.log(`[gpuiv-packager] wrote ${path.join(applications, desktopFile)}`)

  if (opts.iconPath && existsSync(opts.iconPath)) {
    const icons = path.join(home, ".local", "share", "icons", "hicolor", "512x512", "apps")
    mkdirSync(icons, { recursive: true })
    const iconTarget = path.join(icons, `${opts.bundleId}${path.extname(opts.iconPath)}`)
    writeFileSync(iconTarget, readFileSync(opts.iconPath))
    console.log(`[gpuiv-packager] wrote ${iconTarget}`)
  }

  const spawnSoft = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: "utf8" })
    if (result.status !== 0) {
      console.warn(`[gpuiv-packager] ${command} ${args.join(" ")} failed — the entry is installed; refresh databases manually if needed`)
    }
  }
  spawnSoft("update-desktop-database", [applications])
  const mimeTypes = [
    ...new Set([
      ...opts.associations.flatMap((group) => group.mimeTypes),
      ...(opts.urlSchemes ?? []).map((scheme) => `x-scheme-handler/${scheme}`),
    ]),
  ]
  for (const mime of mimeTypes) {
    spawnSoft("xdg-mime", ["default", desktopFile, mime])
  }
}

// ── The register command (cli entry calls this) ────────────────────────

/** Run-time per-user file-association registration for the HOST platform.
 * Registration is inherently local — the user who downloaded the portable
 * product runs this on the target OS. macOS associations ship inside the
 * `.app` bundle (mac.documentTypes), so there is nothing to register.
 * Returns the CLI exit code. */
export async function registerAssociations(opts: {
  configPath?: string
  productDir?: string
  dryRun: boolean
}): Promise<number> {
  const { config } = await loadConfig(opts.configPath)
  const spec = getTargetSpec(defaultHostTargetName())
  if (spec.platform === "darwin") {
    console.log(
      "[gpuiv-packager] macOS associations ship inside the .app bundle (mac.documentTypes) — nothing to register",
    )
    return 0
  }
  const foreign = spec.platform !== process.platform
  const dryRun = opts.dryRun || foreign
  const layout = executableLayout({
    outDir: opts.productDir ?? config.outDir,
    productName: config.productName,
    spec,
  })
  // The layout names the Windows exe without `.exe` on foreign hosts.
  const exePath =
    spec.platform === "win32" && !layout.exePath.endsWith(".exe")
      ? `${layout.exePath}.exe`
      : layout.exePath

  if (spec.platform === "win32") {
    const associations = config.win?.fileAssociations ?? []
    const urlSchemes = config.win?.urlSchemes ?? []
    if (associations.length === 0 && urlSchemes.length === 0) {
      console.log("[gpuiv-packager] no win.fileAssociations / win.urlSchemes in the config — nothing to register")
      return 0
    }
    for (const [index, association] of associations.entries()) {
      const plan = windowsAssociationPlan({
        bundleId: config.bundleId,
        productName: config.productName,
        exePath,
        association,
        groupIndex: index,
      })
      if (dryRun) {
        console.log(`[gpuiv-packager] plan (ProgId ${plan.progId}):`)
        for (const key of plan.keys) {
          for (const value of key.values) {
            console.log(`  ${key.key} / ${value.name || "(default)"} = "${value.data}"`)
          }
        }
        continue
      }
      registerWindowsAssociations(plan)
      console.log(`[gpuiv-packager] registered ${association.extensions.join(", ")} → ${plan.progId}`)
    }
    for (const scheme of urlSchemes) {
      const keys = windowsUrlSchemePlan({ scheme, productName: config.productName, exePath })
      if (dryRun) {
        console.log(`[gpuiv-packager] plan (URL scheme ${scheme}:):`)
        for (const key of keys) {
          for (const value of key.values) {
            console.log(`  ${key.key} / ${value.name || "(default)"} = "${value.data}"`)
          }
        }
        continue
      }
      writeRegistryKeys(keys)
      console.log(`[gpuiv-packager] registered ${scheme}: links (default claim is the user's confirmation)`)
    }
  } else {
    const associations = config.linux?.fileAssociations ?? []
    const urlSchemes = config.linux?.urlSchemes ?? []
    if (associations.length === 0 && urlSchemes.length === 0) {
      console.log("[gpuiv-packager] no linux.fileAssociations / linux.urlSchemes in the config — nothing to register")
      return 0
    }
    const entry = {
      bundleId: config.bundleId,
      productName: config.productName,
      exePath,
      associations,
      urlSchemes,
    }
    if (dryRun) {
      console.log(`[gpuiv-packager] plan (~/.local/share/applications/${config.bundleId}.desktop):`)
      console.log(desktopEntry(entry).trimEnd())
    } else {
      registerLinuxAssociations(entry)
    }
  }

  if (foreign) {
    console.warn(
      `[gpuiv-packager] this host cannot register ${spec.platform} associations — the plan above is what would be written`,
    )
    return 1
  }
  return 0
}
