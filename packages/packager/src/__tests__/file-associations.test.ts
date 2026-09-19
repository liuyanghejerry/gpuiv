import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { infoPlist } from "../macos.js"
import { loadConfig, type PackageConfig } from "../config.js"

const temporary: string[] = []
function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gpuiv-associations-"))
  temporary.push(dir)
  return dir
}
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const config: PackageConfig = {
  entry: "./app.tsx", productName: "Notes & More", bundleId: "dev.gpuiv.notes", version: "1.0.0",
  mac: {
    documentTypes: [{ name: "Markdown <文档>", contentTypes: ["net.daringfireball.markdown"] }],
    typeDeclarations: [
      { identifier: "net.daringfireball.markdown", conformsTo: ["public.plain-text"], extensions: ["md", "markdown"], mimeTypes: ["text/markdown"] },
      { identifier: "dev.gpuiv.notes.document", conformsTo: ["public.data"], extensions: ["gpunote"], exported: true },
    ],
    plist: { CFBundleURLTypes: [{ CFBundleURLName: "Notes", CFBundleURLSchemes: ["gpuiv-notes"] }] },
  },
}

describe("macOS document declarations", () => {
  it("emits escaped nested declarations and preserves explicit plist overrides", () => {
    const xml = infoPlist(config)
    expect(xml).toContain("Markdown &lt;文档&gt;")
    expect(xml).toContain("Notes &amp; More")
    expect(xml).toContain("<key>LSHandlerRank</key><string>Alternate</string>")
    expect(xml).toContain("<key>UTImportedTypeDeclarations</key>")
    expect(xml).toContain("<key>UTExportedTypeDeclarations</key>")
    expect(xml).toContain("<key>CFBundleURLSchemes</key><array><string>gpuiv-notes</string></array>")
    const override = infoPlist({ ...config, mac: { ...config.mac, plist: { CFBundleDocumentTypes: [], "custom<&": 1.5 } } })
    expect(override).toContain("<key>CFBundleDocumentTypes</key>\n  <array></array>")
    expect(override).toContain("<key>custom&lt;&amp;</key>\n  <real>1.5</real>")
  })

  it.skipIf(process.platform !== "darwin")("is a valid plist with actual arrays/dictionaries, accepted by Apple's parser", () => {
    const file = path.join(temp(), "Info.plist")
    writeFileSync(file, infoPlist(config))
    const parsed = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }))
    expect(parsed.CFBundleDocumentTypes).toEqual([{
      CFBundleTypeName: "Markdown <文档>", CFBundleTypeRole: "Editor",
      LSHandlerRank: "Alternate", LSItemContentTypes: ["net.daringfireball.markdown"],
    }])
    expect(parsed.UTImportedTypeDeclarations[0].UTTypeTagSpecification["public.filename-extension"]).toEqual(["md", "markdown"])
    expect(parsed.UTExportedTypeDeclarations[0].UTTypeIdentifier).toBe("dev.gpuiv.notes.document")
  })

  it("loads valid JSON declarations and rejects invalid declarations early", async () => {
    const file = path.join(temp(), "gpuiv.package.json")
    writeFileSync(file, JSON.stringify(config))
    expect((await loadConfig(file)).config.mac).toEqual(config.mac)
    for (const mac of [
      { documentTypes: [{ name: "Bad", contentTypes: [] }] },
      { documentTypes: [{ name: "Bad", contentTypes: ["public.text"], role: "Writer" }] },
      { typeDeclarations: [{ identifier: "bad", conformsTo: [], extensions: [".md"] }] },
      { typeDeclarations: [config.mac!.typeDeclarations![0], config.mac!.typeDeclarations![0]] },
      { typeDeclarations: {} },
      { documentTypes: [null] },
    ]) {
      writeFileSync(file, JSON.stringify({ ...config, mac }))
      await expect(loadConfig(file)).rejects.toThrow("Invalid packaging config")
    }
  })

  it("keeps file association keys absent for apps that do not opt in", () => {
    const xml = infoPlist({ ...config, mac: undefined })
    expect(xml).not.toMatch(/CFBundleDocumentTypes|UTImportedTypeDeclarations|UTExportedTypeDeclarations/)
  })

  it("loads explicit relative module configs in Bun, including escaped filenames", () => {
    const file = path.join(temp(), "config #1.mjs")
    writeFileSync(file, `export default ${JSON.stringify(config)}`)
    // Exercise the packager runtime: Vite's import transform interprets URL
    // escapes in generated module names differently from Bun's ESM loader.
    const module = fileURLToPath(new URL("../config.ts", import.meta.url))
    const loaded = JSON.parse(execFileSync("bun", ["--eval",
      `import { loadConfig } from ${JSON.stringify(module)}; console.log(JSON.stringify(await loadConfig(${JSON.stringify(path.relative(process.cwd(), file))})))`,
    ], { encoding: "utf8" }))
    expect(loaded.file).toBe(file)
    expect(loaded.config.entry).toBe(path.join(path.dirname(file), "app.tsx"))
    expect(loaded.config.mac).toEqual(config.mac)
  })
})
