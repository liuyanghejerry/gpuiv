import { afterEach, describe, expect, it, vi } from "vitest"

import { isPackaged, resolveResourcesPath, resourcesPath } from "../packaged.js"

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

describe("isPackaged", () => {
  it("reports false under a plain runtime", () => {
    expect(isPackaged({})).toBe(false)
  })

  it("detects bun >= 1.4 standalone executables", () => {
    expect(isPackaged({ Bun: { isStandaloneExecutable: true } })).toBe(true)
  })

  it("detects the $bunfs entrypoint of bun 1.3.x builds", () => {
    expect(isPackaged({ Bun: { main: "/$bunfs/app.entry.js" } })).toBe(true)
  })

  it("stays false for development mains and explicit negatives", () => {
    expect(isPackaged({ Bun: { main: "/home/dev/app.ts" } })).toBe(false)
    expect(isPackaged({ Bun: { isStandaloneExecutable: false, main: "/home/dev/app.ts" } })).toBe(false)
  })
})

describe("resourcesPath", () => {
  const realPlatform = process.platform
  const realExecPath = process.execPath

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
    Object.defineProperty(process, "execPath", { value: realExecPath, writable: true, configurable: true })
    vi.restoreAllMocks()
  })

  function pretend(input: { platform: NodeJS.Platform; execPath: string; cwd?: string; packaged?: boolean }) {
    Object.defineProperty(process, "platform", { value: input.platform, configurable: true })
    Object.defineProperty(process, "execPath", { value: input.execPath, configurable: true })
    vi.spyOn(process, "cwd").mockReturnValue(input.cwd ?? "/mock/cwd")
    return { Bun: input.packaged === false ? {} : { isStandaloneExecutable: true } }
  }

  it("uses the working directory in development", () => {
    expect(resourcesPath(pretend({ platform: "linux", execPath: "/usr/local/bin/bun", cwd: "/Users/me/app", packaged: false }))).toBe("/Users/me/app")
  })

  it("resolves beside the exe on packaged Linux", () => {
    expect(resourcesPath(pretend({ platform: "linux", execPath: "/opt/chat/chat" }))).toBe("/opt/chat/resources")
  })

  it("resolves the bundle Resources dir on packaged macOS", () => {
    expect(resourcesPath(pretend({ platform: "darwin", execPath: "/Applications/Chat.app/Contents/MacOS/Chat" }))).toBe("/Applications/Chat.app/Contents/Resources")
  })

  it("keeps win32 path semantics on packaged Windows", () => {
    expect(resourcesPath(pretend({ platform: "win32", execPath: "C:\\Apps\\Chat\\Chat.exe" }))).toBe("C:\\Apps\\Chat\\resources")
  })
})
