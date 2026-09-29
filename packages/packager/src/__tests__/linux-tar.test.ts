import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { tarLinux } from "../linux.js"

describe("linux tarball", () => {
  let dir: string

  beforeAll(() => {
    dir = path.join(tmpdir(), `gpuiv-tar-test-${Date.now()}`)
    mkdirSync(path.join(dir, "Chat-linux-x64"), { recursive: true })
    writeFileSync(path.join(dir, "Chat-linux-x64", "Chat"), "#!/bin/sh\nsleep 1000\n")
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("archives the product directory under its own name", () => {
    const tarPath = path.join(dir, "Chat-linux-x64.tar.gz")
    tarLinux({ productDir: path.join(dir, "Chat-linux-x64"), tarPath })
    // bsdtar (macOS dev) and GNU tar (Linux CI) share these listing flags.
    const listing = execFileSync("tar", ["-tzf", tarPath], { encoding: "utf8" })
    expect(listing).toContain("Chat-linux-x64/Chat")
  })
})
