import { describe, expect, it } from "vitest"

import { resolveResourcesPath } from "../packaged.js"

// Pure path logic — no renderer, no GPU. The packaged-app layout is a
// contract with @gpuiv/packager: Contents/Resources on macOS, resources/
// beside the exe elsewhere.
describe("resolveResourcesPath", () => {
  it("resolves the .app Resources dir on packaged macOS", () => {
    expect(
      resolveResourcesPath({
        execPath: "/Applications/Chat.app/Contents/MacOS/Chat",
        platform: "darwin",
        cwd: "/",
        packaged: true,
      }),
    ).toBe("/Applications/Chat.app/Contents/Resources")
  })

  it("resolves the portable resources dir on packaged Windows", () => {
    expect(
      resolveResourcesPath({
        execPath: "C:\\Apps\\Chat\\Chat.exe",
        platform: "win32",
        cwd: "C:\\",
        packaged: true,
      }),
    ).toBe("C:\\Apps\\Chat\\resources")
  })

  it("resolves the portable resources dir on packaged Linux", () => {
    expect(
      resolveResourcesPath({
        execPath: "/opt/chat/chat",
        platform: "linux",
        cwd: "/",
        packaged: true,
      }),
    ).toBe("/opt/chat/resources")
  })

  it("falls back to the working directory in development", () => {
    expect(
      resolveResourcesPath({
        execPath: "/usr/local/bin/bun",
        platform: "darwin",
        cwd: "/Users/me/app",
        packaged: false,
      }),
    ).toBe("/Users/me/app")
  })
})
