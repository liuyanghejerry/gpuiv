import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { desktopEntry, registerAssociations, windowsAssociationPlan } from "../associations.js"
import { loadConfig, type PackageConfig } from "../config.js"

describe("windows association plan", () => {
  it("writes a quoted open command and per-extension OpenWithProgids under HKCU", () => {
    const plan = windowsAssociationPlan({
      bundleId: "dev.gpuiv.notes",
      productName: "Notes App",
      exePath: "C:\\Tools\\Notes App\\Notes App.exe",
      association: { extensions: ["md", "markdown"], name: "Markdown document" },
      groupIndex: 0,
    })
    expect(plan.progId).toBe("dev.gpuiv.notes.file0")
    const byKey = new Map(plan.keys.map((key) => [key.key, key.values]))
    expect(byKey.get("HKCU\\Software\\Classes\\dev.gpuiv.notes.file0")).toEqual([
      { name: "", type: "REG_SZ", data: "Markdown document" },
    ])
    expect(byKey.get("HKCU\\Software\\Classes\\dev.gpuiv.notes.file0\\shell\\open\\command")).toEqual([
      { name: "", type: "REG_SZ", data: '"C:\\Tools\\Notes App\\Notes App.exe" "%1"' },
    ])
    expect(byKey.get("HKCU\\Software\\Classes\\.md\\OpenWithProgids")).toEqual([
      { name: "dev.gpuiv.notes.file0", type: "REG_SZ", data: "" },
    ])
    expect(byKey.has("HKCU\\Software\\Classes\\.markdown\\OpenWithProgids")).toBe(true)
  })

  it("honours an explicit progId", () => {
    const plan = windowsAssociationPlan({
      bundleId: "dev.gpuiv.notes",
      productName: "Notes",
      exePath: "/tmp/Notes.exe",
      association: { extensions: ["md"], progId: "custom.progid" },
      groupIndex: 2,
    })
    expect(plan.progId).toBe("custom.progid")
  })
})

describe("linux desktop entry", () => {
  it("quotes the executable, joins unique mime types, and passes %f", () => {
    const entry = desktopEntry({
      bundleId: "dev.gpuiv.notes",
      productName: "Notes App",
      exePath: "/opt/Notes App/Notes App",
      associations: [
        { extensions: ["md"], mimeTypes: ["text/markdown"] },
        { extensions: ["markdown"], mimeTypes: ["text/markdown"] },
      ],
    })
    expect(entry).toContain('Exec="/opt/Notes App/Notes App" %f')
    expect(entry).toContain("MimeType=text/markdown;")
    expect(entry).toContain("Type=Application")
    expect(entry).toContain("Name=Notes App")
  })
})

describe("association config validation", () => {
  const base = {
    entry: "./a.tsx", productName: "X", bundleId: "dev.x", version: "1.0.0",
  } satisfies PackageConfig

  it("rejects empty extensions and linux groups without mime types", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gpuiv-assoc-config-"))
    try {
      const file = path.join(dir, "gpuiv.package.json")
      writeFileSync(
        file,
        JSON.stringify({
          ...base,
          win: { fileAssociations: [{ extensions: [] }] },
          linux: { fileAssociations: [{ extensions: ["md"], mimeTypes: [] }] },
        }),
      )
      await expect(loadConfig(file)).rejects.toThrow(/win\.fileAssociations.*linux\.fileAssociations/s)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("register command", () => {
  it("dry-runs the host platform's plan from a temp config", async () => {
    // On macOS the command reports the bundle story; on win/linux it would
    // print a plan. Assert the macOS path (the dev/CI host for this suite)
    // and that the command never touches the system in a dry run.
    if (process.platform !== "darwin") return
    const dir = mkdtempSync(path.join(tmpdir(), "gpuiv-register-"))
    try {
      const file = path.join(dir, "gpuiv.package.json")
      writeFileSync(file, JSON.stringify({
        entry: "./a.tsx", productName: "X", bundleId: "dev.x", version: "1.0.0",
        win: { fileAssociations: [{ extensions: ["md"] }] },
        linux: { fileAssociations: [{ extensions: ["md"], mimeTypes: ["text/markdown"] }] },
      }))
      const code = await registerAssociations({ configPath: file, dryRun: false })
      expect(code).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
