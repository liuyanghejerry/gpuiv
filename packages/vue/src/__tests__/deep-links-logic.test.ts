/// Deep-link helpers exercised without a native renderer: file/URL request
/// parsing plus the renderer-callback bookkeeping of onOpenUrls,
/// onOpenRequests and registerUrlScheme against plain mock renderer objects.

import { describe, expect, it, vi } from "vitest"
import { onOpenRequests, onOpenUrls, parseOpenRequest, registerUrlScheme } from "../deep-links.js"
import type { NativeRenderer } from "../types.js"

type NativeCallback = ((error: Error | null, urls: string[]) => void) | null

// Windows file URLs need a drive letter, so the fixtures carry one there and
// expect the decoded backslash form back.
const windows = process.platform === "win32"
const tmpFileUrl = (suffix: string) => (windows ? `file:///C:/tmp/${suffix}` : `file:///tmp/${suffix}`)
const tmpPath = (name: string) => (windows ? `C:\\tmp\\${name}` : `/tmp/${name}`)

/** A renderer mock that records every callback armed on its onOpenUrls. */
function rendererWithOpenUrls(arm?: (callback: NativeCallback) => void) {
  const armed: NativeCallback[] = []
  const renderer = {
    onOpenUrls: (callback: NativeCallback) => {
      armed.push(callback)
      arm?.(callback)
    },
  }
  return { renderer: renderer as unknown as NativeRenderer, armed }
}

describe("parseOpenRequest", () => {
  it("passes non-file URLs through unchanged", () => {
    const request = parseOpenRequest(["myapp://thread/42", "mailto:a@b.c", "file2:///not-a-file"])
    expect(request).toEqual({ paths: [], urls: ["myapp://thread/42", "mailto:a@b.c", "file2:///not-a-file"], errors: [] })
  })

  it("decodes file URLs to absolute local paths", () => {
    const request = parseOpenRequest([tmpFileUrl("%E4%B8%AD%E6%96%87.md"), tmpFileUrl("notes.txt").replace("file:", "FILE:")])
    expect(request.paths).toEqual([tmpPath("中文.md"), tmpPath("notes.txt")])
    expect(request.errors).toEqual([])
  })

  it("rejects file URLs with a query, fragment or NUL byte, keeping valid siblings", () => {
    const request = parseOpenRequest([tmpFileUrl("a?version=2"), tmpFileUrl("b#anchor"), windows ? "file:///C:/a%00b" : "file:///a%00b", tmpFileUrl("ok")])
    expect(request.paths).toEqual([tmpPath("ok")])
    expect(request.errors.map((error) => error.url)).toEqual([
      tmpFileUrl("a?version=2"),
      tmpFileUrl("b#anchor"),
      windows ? "file:///C:/a%00b" : "file:///a%00b",
    ])
    expect(request.errors[0]!.error.message).toContain("query or fragment")
    // On Windows fileURLToPath rejects the encoded NUL before the explicit
    // check runs, with Node's own wording; both must error, either wording.
    expect(request.errors[2]!.error).toBeInstanceOf(Error)
    if (!windows) expect(request.errors[2]!.error.message).toContain("NUL")
  })

  it("reports individually file URLs that do not parse", () => {
    const request = parseOpenRequest(["file://[broken", tmpFileUrl("fine")])
    expect(request.paths).toEqual([tmpPath("fine")])
    expect(request.errors).toHaveLength(1)
    expect(request.errors[0]!.url).toBe("file://[broken")
    expect(request.errors[0]!.error).toBeInstanceOf(Error)
  })

  it("returns an empty request for no input", () => {
    expect(parseOpenRequest([])).toEqual({ paths: [], urls: [], errors: [] })
  })
})

describe("onOpenUrls bookkeeping", () => {
  it("throws when the renderer cannot receive open requests", () => {
    expect(() => onOpenUrls({} as NativeRenderer, vi.fn())).toThrow("does not implement onOpenUrls")
  })

  it("delivers urls to the armed handler and rethrows native errors", () => {
    const { renderer, armed } = rendererWithOpenUrls()
    const handler = vi.fn()
    onOpenUrls(renderer, handler)

    armed[0]!(null, ["myapp://a", "file:///tmp/x"])
    expect(handler).toHaveBeenCalledWith(["myapp://a", "file:///tmp/x"])
    expect(() => armed[0]!(new Error("native boom"), [])).toThrow("native boom")
  })

  it("routes queued deliveries to the replacement and ignores a stale dispose", () => {
    const { renderer, armed } = rendererWithOpenUrls()
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = onOpenUrls(renderer, first)
    onOpenUrls(renderer, second)

    armed[0]!(null, ["myapp://late"])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(["myapp://late"])

    disposeFirst()
    armed[0]!(null, ["myapp://still-routed"])
    expect(second).toHaveBeenCalledTimes(2)
  })

  it("unregisters the native callback on dispose and drops later deliveries", () => {
    const { renderer, armed } = rendererWithOpenUrls()
    const handler = vi.fn()
    const dispose = onOpenUrls(renderer, handler)
    dispose()

    expect(armed.at(-1)).toBeNull()
    expect(() => armed[0]!(null, ["myapp://gone"])).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it("restores the previous handler when re-arming fails", () => {
    let arms = 0
    const { renderer, armed } = rendererWithOpenUrls(() => {
      arms += 1
      if (arms > 1) throw new Error("renderer rejects re-arm")
    })
    const first = vi.fn()
    const second = vi.fn()
    onOpenUrls(renderer, first)
    expect(() => onOpenUrls(renderer, second)).toThrow("renderer rejects re-arm")

    armed[0]!(null, ["myapp://recovered"])
    expect(first).toHaveBeenCalledWith(["myapp://recovered"])
    expect(second).not.toHaveBeenCalled()
  })

  it("drops the subscription when the very first arm fails", () => {
    let arms = 0
    let handler: NativeCallback = null
    const renderer = {
      onOpenUrls: (callback: NativeCallback) => {
        arms += 1
        if (arms === 1) throw new Error("renderer cannot arm")
        handler = callback
      },
    } as unknown as NativeRenderer
    expect(() => onOpenUrls(renderer, vi.fn())).toThrow("renderer cannot arm")

    const delivered = vi.fn()
    onOpenUrls(renderer, delivered)
    handler!(null, ["myapp://fresh"])
    expect(delivered).toHaveBeenCalledWith(["myapp://fresh"])
  })
})

describe("onOpenRequests", () => {
  it("parses native urls into an OpenRequest before delivery", () => {
    const { renderer, armed } = rendererWithOpenUrls()
    const requests: unknown[] = []
    onOpenRequests(renderer, (request) => requests.push(request))

    armed[0]!(null, [tmpFileUrl("%E4%B8%AD.md"), "myapp://thread/42", "file:///bad?x=1"])
    expect(requests).toEqual([
      {
        paths: [tmpPath("中.md")],
        urls: ["myapp://thread/42"],
        errors: [{ url: "file:///bad?x=1", error: expect.any(Error) }],
      },
    ])
  })
})

describe("registerUrlScheme", () => {
  it("rejects when the renderer lacks the method", async () => {
    await expect(registerUrlScheme({} as NativeRenderer, "myapp")).rejects.toThrow("does not implement registerUrlScheme")
  })

  it("resolves on success and rejects with the platform's reason", async () => {
    const calls: Array<{ scheme: string; callback: (error: Error | null) => void }> = []
    const renderer = {
      registerUrlScheme: (scheme: string, callback: (error: Error | null) => void) => {
        calls.push({ scheme, callback })
      },
    } as unknown as NativeRenderer

    const success = registerUrlScheme(renderer, "myapp")
    const failure = registerUrlScheme(renderer, "other")
    calls[0]!.callback(null)
    calls[1]!.callback(new Error("not installed"))
    await expect(success).resolves.toBeUndefined()
    await expect(failure).rejects.toThrow("not installed")
    expect(calls.map((call) => call.scheme)).toEqual(["myapp", "other"])
  })
})
