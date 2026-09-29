import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { buildDmg } from "../macos.js"

// hdiutil only exists on macOS; the packager suite runs on macos-latest in CI
// and wherever a contributor develops.
const describeMac = describe.skipIf(process.platform !== "darwin")

describeMac("macos dmg", () => {
  let dir: string

  beforeAll(() => {
    dir = path.join(tmpdir(), `gpuiv-dmg-test-${Date.now()}`)
    const app = path.join(dir, "Chat App.app", "Contents", "MacOS")
    mkdirSync(app, { recursive: true })
    writeFileSync(path.join(app, "chat"), "#!/bin/sh\nsleep 1000\n")
    writeFileSync(
      path.join(dir, "Chat App.app", "Contents", "Info.plist"),
      "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>CFBundleName</key><string>Chat App</string></dict></plist>",
    )
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it(
    "builds a compressed image that mounts the app",
    { timeout: 60_000 },
    () => {
    const dmgPath = path.join(dir, "Chat-App-darwin-arm64.dmg")
    buildDmg({ appPath: path.join(dir, "Chat App.app"), dmgPath, volumeName: "Chat App" })
    expect(existsSync(dmgPath)).toBe(true)

    // The image must verify and actually contain the bundle.
    const verify = spawnSync("hdiutil", ["verify", dmgPath], { encoding: "utf8" })
    expect(verify.status, verify.stderr).toBe(0)
    const mount = path.join(dir, "mounted")
    mkdirSync(mount)
    const attach = spawnSync(
      "hdiutil",
      ["attach", dmgPath, "-mountpoint", mount, "-nobrowse", "-quiet"],
      { encoding: "utf8" },
    )
    expect(attach.status, attach.stderr).toBe(0)
    try {
      expect(existsSync(path.join(mount, "Chat App.app", "Contents", "Info.plist"))).toBe(true)
    } finally {
      spawnSync("hdiutil", ["detach", mount, "-quiet"], { encoding: "utf8" })
    }
  })
})
