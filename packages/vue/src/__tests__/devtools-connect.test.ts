/** connectVueDevtools() success contract, with @vue/devtools mocked: the
 *  client's connect() runs with the shims in place, a true result marks the
 *  process connected, and a second call short-circuits without touching the
 *  globals again. The real socket handshake and app registration run in the
 *  GPU-gated devtools-e2e suite. */

import { describe, expect, it, vi } from "vitest"

const connect = vi.fn<(host?: string, port?: number) => unknown>()

vi.mock("@vue/devtools", () => ({ devtools: { connect } }))

import { connectVueDevtools } from "../devtools.js"

describe("connectVueDevtools success", () => {
  it("connects with the shims in place, then a second call is a no-op", async () => {
    const g = globalThis as Record<string, unknown>
    delete g.__gpuivDevtoolsConnected
    connect.mockReset()
    // The devtools client reads window/document while connect() runs; capture
    // what it observed.
    connect.mockImplementation(() => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("shims missing during connect")
      }
      return undefined
    })

    const first = await connectVueDevtools({ host: "http://localhost", port: 8907 })
    expect(first).toBe(true)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith("http://localhost", 8907)
    // Shims survive a successful connect — the devtools client needs them for
    // the lifetime of the process.
    expect(typeof window).toBe("object")
    expect((globalThis as unknown as { __gpuivDevtoolsConnected?: boolean }).__gpuivDevtoolsConnected)
      .toBe(true)

    connect.mockClear()
    const second = await connectVueDevtools({ port: 8907 })
    expect(second).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    delete g.__gpuivDevtoolsConnected
  })

  it("rolls the shims back when the client fails to start", async () => {
    const g = globalThis as Record<string, unknown>
    delete g.__gpuivDevtoolsConnected
    const hadWindow = "window" in g
    const previousWindow = g.window
    const previousDocument = g.document
    connect.mockReset()
    connect.mockImplementation(() => {
      throw new Error("simulated client failure")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await expect(connectVueDevtools({ port: 8907 })).resolves.toBe(false)
      expect(warn).toHaveBeenCalledWith(
        "[gpuiv] connectVueDevtools: could not start the devtools client.",
        expect.any(Error),
      )
      // Whatever this call installed is gone again.
      if (!hadWindow) expect("window" in g).toBe(false)
      else expect(g.window).toBe(previousWindow)
      expect(g.document).toBe(previousDocument)
      expect(g.__gpuivDevtoolsConnected).toBeUndefined()
    } finally {
      warn.mockRestore()
      delete g.__gpuivDevtoolsConnected
    }
  })
})

describe("devtools document stub", () => {
  it("answers every call the devtools overlays make without a DOM", async () => {
    const g = globalThis as Record<string, unknown>
    const previousWindow = g.window
    const previousDocument = g.document
    const { installDevtoolsShims } = await import("../devtools.js")
    const installed = installDevtoolsShims()
    try {
      const doc = (globalThis as unknown as { document: Record<string, () => unknown> }).document
      const node = doc.createElement() as Record<string, () => unknown>
      node.appendChild()
      node.removeChild()
      node.scrollIntoView()
      const range = doc.createRange() as Record<string, () => unknown>
      range.selectNode()
      expect(range.getBoundingClientRect()).toEqual({
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
      })
      expect(doc.getElementById()).toBeNull()
      expect(doc.querySelectorAll()).toEqual([])
      ;(doc.body as unknown as { appendChild(): void }).appendChild()
      ;(globalThis as unknown as { addEventListener(): void }).addEventListener()
      ;(globalThis as unknown as { removeEventListener(): void }).removeEventListener()
    } finally {
      for (const key of installed) delete g[key]
      if (previousWindow !== undefined) g.window = previousWindow
      if (previousDocument !== undefined) g.document = previousDocument
    }
  })
})
