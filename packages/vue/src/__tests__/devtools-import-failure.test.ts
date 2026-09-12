/** connectVueDevtools() must leave the process as it found it when the
 *  @vue/devtools import fails: the window/document shims exist only for the
 *  devtools client, and a process that keeps them makes every later
 *  `typeof window !== "undefined"` check believe it runs in a browser that is
 *  not there. The import is forced to fail with a mock — the (optional)
 *  dependency is installed in this repo, so nothing else can simulate its
 *  absence. */

import { describe, expect, it, vi } from "vitest"

vi.mock("@vue/devtools", () => {
  throw new Error("simulated: @vue/devtools is not installed")
})

import { connectVueDevtools } from "../devtools.js"

const SHIM_KEYS = ["window", "document", "location", "addEventListener", "removeEventListener"]

function snapshot(): Map<string, unknown> {
  const g = globalThis as Record<string, unknown>
  return new Map(SHIM_KEYS.map((key) => [key, g[key]]))
}

function restore(previous: Map<string, unknown>): void {
  const g = globalThis as Record<string, unknown>
  for (const [key, value] of previous) {
    if (value === undefined) delete g[key]
    else g[key] = value
  }
}

describe("connectVueDevtools import failure", () => {
  it("returns false, warns, and rolls back every global it shimmed", async () => {
    const g = globalThis as Record<string, unknown>
    const previous = snapshot()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await expect(connectVueDevtools()).resolves.toBe(false)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("@vue/devtools is not installed"))
      for (const [key, value] of previous) {
        if (value === undefined) expect(g[key], `${key} was not rolled back`).toBeUndefined()
        else expect(g[key], `${key} was clobbered`).toBe(value)
      }
    } finally {
      warn.mockRestore()
      restore(previous)
    }
  })

  it("keeps a global that existed before the call", async () => {
    const g = globalThis as Record<string, unknown>
    const previous = snapshot()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const marker = { preexisting: true }
    g.window = marker
    try {
      await expect(connectVueDevtools()).resolves.toBe(false)
      expect(g.window).toBe(marker)
    } finally {
      warn.mockRestore()
      restore(previous)
    }
  })
})
