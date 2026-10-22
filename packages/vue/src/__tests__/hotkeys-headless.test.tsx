/// Headless contract tests for the global-shortcut helpers: Promise wiring
/// over the errback-style renderer methods, handler replacement, canned
/// errors, and the missing-method guard for stale natives. The GPU test
/// renderer is not needed — the wrappers only talk to the renderer object.

import { describe, expect, it, vi } from "vitest"
import { HeadlessRenderer } from "./headless.js"
import { registerGlobalShortcut, unregisterGlobalShortcut } from "../hotkeys.js"

class ShortcutRenderer extends HeadlessRenderer {
  armed = new Map<string, (() => void) | null>()
  nextRegisterError: Error | null = null
  nextUnregisterError: Error | null = null

  registerGlobalShortcut(
    request: { accelerator: string },
    onTrigger: (() => void) | null,
    callback: (error: Error | null) => void
  ): void {
    if (this.nextRegisterError) {
      const error = this.nextRegisterError
      this.nextRegisterError = null
      callback(error)
      return
    }
    this.armed.set(request.accelerator, onTrigger)
    callback(null)
  }

  unregisterGlobalShortcut(
    accelerator: string,
    callback: (error: Error | null) => void
  ): void {
    if (this.nextUnregisterError) {
      const error = this.nextUnregisterError
      this.nextUnregisterError = null
      callback(error)
      return
    }
    if (!this.armed.has(accelerator)) {
      callback(new Error(`not registered: ${accelerator}`))
      return
    }
    this.armed.delete(accelerator)
    callback(null)
  }
}

describe("global shortcuts (headless)", () => {
  it("resolves registration and arms without a handler when none is given", async () => {
    const renderer = new ShortcutRenderer()
    await registerGlobalShortcut(renderer, "cmd+shift+j")
    expect(renderer.armed.get("cmd+shift+j")).toBeNull()
  })

  it("re-registering the same accelerator replaces the handler", async () => {
    const renderer = new ShortcutRenderer()
    const first = vi.fn()
    const second = vi.fn()
    await registerGlobalShortcut(renderer, "cmd+k", first)
    await registerGlobalShortcut(renderer, "cmd+k", second)

    renderer.armed.get("cmd+k")?.()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("rejects when the renderer reports a registration error", async () => {
    const renderer = new ShortcutRenderer()
    renderer.nextRegisterError = new Error("RegisterHotKey failed")
    await expect(registerGlobalShortcut(renderer, "ctrl+alt+t")).rejects.toThrow(
      "RegisterHotKey failed"
    )
    expect(renderer.armed.has("ctrl+alt+t")).toBe(false)
  })

  it("rejects when the renderer predates registerGlobalShortcut", async () => {
    await expect(
      registerGlobalShortcut(new HeadlessRenderer(), "cmd+k")
    ).rejects.toThrow(/does not implement registerGlobalShortcut/)
  })

  it("unregisters an armed accelerator and stops its handler", async () => {
    const renderer = new ShortcutRenderer()
    const onTrigger = vi.fn()
    await registerGlobalShortcut(renderer, "cmd+k", onTrigger)
    await unregisterGlobalShortcut(renderer, "cmd+k")
    expect(renderer.armed.has("cmd+k")).toBe(false)

    // The old handler object is still callable, but the registry is empty.
    onTrigger()
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it("rejects unregister when the renderer reports an error", async () => {
    const renderer = new ShortcutRenderer()
    renderer.nextUnregisterError = new Error("unregister failed")
    await expect(unregisterGlobalShortcut(renderer, "cmd+k")).rejects.toThrow(
      "unregister failed"
    )
  })

  it("rejects when the renderer predates unregisterGlobalShortcut", async () => {
    await expect(
      unregisterGlobalShortcut(new HeadlessRenderer(), "cmd+k")
    ).rejects.toThrow(/does not implement unregisterGlobalShortcut/)
  })
})
