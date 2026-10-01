/// Global-shortcut API contract through the offscreen test bridge:
/// registration validates accelerators, triggers reach JS, unregister works,
/// and canned errors surface as rejections.

import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { registerGlobalShortcut, unregisterGlobalShortcut } from "../hotkeys.js"

const describeNative = describe.skipIf(!hasNativeTestRenderer)

describeNative("global shortcuts", () => {
  it("registers, fires, replaces, and unregisters", async () => {
    const app = createTestApp({ render: () => null })
    const renderer = app.renderer

    await registerGlobalShortcut(renderer, "cmd+shift+j")
    expect(renderer.hasGlobalShortcut("cmd+shift+j")).toBe(true)

    const onTrigger = vi.fn()
    await registerGlobalShortcut(renderer, "cmd+shift+j", onTrigger)
    renderer.fireGlobalShortcut("cmd+shift+j")
    // Native callbacks arrive through a ThreadsafeFunction; one timer turn
    // does not guarantee delivery when the CI worker is busy.
    await vi.waitFor(() => expect(onTrigger).toHaveBeenCalledTimes(1))

    await unregisterGlobalShortcut(renderer, "cmd+shift+j")
    expect(renderer.hasGlobalShortcut("cmd+shift+j")).toBe(false)

    app.unmount()
  })

  it("rejects unsupported accelerators and canned registration errors", async () => {
    const app = createTestApp({ render: () => null })
    const renderer = app.renderer

    await expect(registerGlobalShortcut(renderer, "cmd+ß")).rejects.toThrow(/unsupported accelerator/)
    await expect(registerGlobalShortcut(renderer, "hyper+x")).rejects.toThrow(/unsupported accelerator/)

    renderer.setNextHotkeyError("RegisterHotKey failed")
    await expect(registerGlobalShortcut(renderer, "ctrl+alt+t")).rejects.toThrow(/RegisterHotKey/)
    expect(renderer.hasGlobalShortcut("ctrl+alt+t")).toBe(false)

    app.unmount()
  })
})
