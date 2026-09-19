import { describe, expect, it, vi } from "vitest"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { onOpenRequests, onOpenUrls, parseOpenRequest } from "../deep-links.js"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"
import type { NativeRenderer } from "../types.js"

describe("open request parsing", () => {
  it("decodes paths without losing spaces, Unicode, percent signs or batch order", () => {
    const paths = [path.resolve("中文 notes #1%.md"), path.resolve("second.txt")]
    const urls = paths.map((value) => pathToFileURL(value).href)
    expect(parseOpenRequest([urls[0], "notes://open/42", urls[1], urls[0]])).toEqual({
      paths: [...paths, paths[0]], urls: ["notes://open/42"], errors: [],
    })
  })

  it("isolates malformed file URLs and never truncates query/fragment or accepts NUL", () => {
    const invalid = ["file:///bad%ZZ", "file:///bad%2Fpath", "file:///bad%00path", "file:///a?query", "file:///a#fragment"]
    const good = path.resolve("good.md")
    const result = parseOpenRequest([...invalid, pathToFileURL(good).href, "app://settings"])
    expect(result.paths).toEqual([good])
    expect(result.urls).toEqual(["app://settings"])
    expect(result.errors.map((entry) => entry.url)).toEqual(invalid)
    expect(result.errors.every((entry) => entry.error instanceof Error)).toBe(true)
  })

  it("uses host platform path semantics", () => {
    const result = parseOpenRequest(["file://server/share/a%20b.md", "file:///C:/notes/a.md"])
    if (process.platform === "win32") {
      expect(result.paths).toEqual(["\\\\server\\share\\a b.md", "C:\\notes\\a.md"])
    } else {
      expect(result.errors).toHaveLength(1)
      expect(result.paths).toEqual(["/C:/notes/a.md"])
    }
  })

  it("a stale disposer cannot remove the replacement and disposed callbacks are inert", () => {
    const callbacks: Array<((error: Error | null, urls: string[]) => void) | null> = []
    const renderer: NativeRenderer = { applyBatch: () => [], onOpenUrls: (callback) => { callbacks.push(callback) } }
    const old = vi.fn(), current = vi.fn()
    const disposeOld = onOpenUrls(renderer, old)
    const dispose = onOpenRequests(renderer, current)
    disposeOld()
    expect(callbacks).toHaveLength(2)
    callbacks[0]?.(null, ["app://queued-before-replacement"])
    callbacks[1]?.(null, ["app://current"])
    expect(old).not.toHaveBeenCalled()
    expect(current).toHaveBeenNthCalledWith(1, { paths: [], urls: ["app://queued-before-replacement"], errors: [] })
    expect(current).toHaveBeenNthCalledWith(2, { paths: [], urls: ["app://current"], errors: [] })
    dispose()
    dispose()
    expect(callbacks).toHaveLength(3)
    expect(callbacks[2]).toBeNull()
    callbacks[1]?.(null, ["app://disposed"])
    expect(current).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(!hasNativeTestRenderer)("native open request delivery", () => {
  it("replays startup batches once before subsequent OS events", async () => {
    const renderer = new TestRenderer()
    const batches: string[][] = []
    renderer.fireOpenUrls(["app://first", "app://second"])
    renderer.fireOpenUrls(["app://third"])
    const dispose = onOpenUrls(renderer, (urls) => batches.push(urls))
    try {
      renderer.fireOpenUrls(["app://fourth"])
      await vi.waitFor(() => expect(batches).toEqual([
        ["app://first", "app://second"], ["app://third"], ["app://fourth"],
      ]))
      dispose()
      renderer.fireOpenUrls(["app://between-subscriptions"])
      const second: string[][] = []
      const disposeNext = onOpenUrls(renderer, (urls) => second.push(urls))
      try {
        await vi.waitFor(() => expect(second).toEqual([["app://between-subscriptions"]]))
      } finally { disposeNext() }
      expect(batches).toHaveLength(3)
    } finally { dispose() }
  })

  it("delivers mixed files/deep links through the same callback without cross-renderer test leakage", async () => {
    const first = new TestRenderer(), second = new TestRenderer()
    const receive = vi.fn(), receiveOther = vi.fn()
    const file = path.resolve("中文 file.md")
    first.fireOpenUrls([pathToFileURL(file).href, "app://settings"])
    const dispose = onOpenRequests(first, receive)
    const disposeOther = onOpenRequests(second, receiveOther)
    try {
      await vi.waitFor(() => expect(receive).toHaveBeenCalledExactlyOnceWith({ paths: [file], urls: ["app://settings"], errors: [] }))
      expect(receiveOther).not.toHaveBeenCalled()
    } finally { dispose(); disposeOther() }
  })
})
