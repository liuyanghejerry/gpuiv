/// Tray API contract through the offscreen test bridge: install records the
/// descriptor, clicks and menu actions reach JS, clear removes both.

import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { clearTray, setTray, setTrayMenu } from "../tray.js"

const describeNative = describe.skipIf(!hasNativeTestRenderer)

describeNative("tray", () => {
  it("installs, delivers clicks, and clears", async () => {
    const app = createTestApp({ render: () => null })
    const renderer = app.renderer

    try {
      await setTray(renderer, { iconPath: "/icons/tray.png", tooltip: "Chat", template: true })
      expect(renderer.getTrayDesc()).toMatchObject({
        iconPath: "/icons/tray.png",
        tooltip: "Chat",
        template: true,
      })

      const onClick = vi.fn()
      await setTray(renderer, { iconPath: "/icons/tray@2x.png" }, onClick)
      expect(renderer.getTrayDesc()).toMatchObject({ iconPath: "/icons/tray@2x.png" })

      renderer.simulateTrayClick()
      // ThreadsafeFunction delivery can run after the next timer callback.
      await vi.waitFor(() => expect(onClick).toHaveBeenCalledTimes(1))

      await clearTray(renderer)
      expect(renderer.getTrayDesc()).toBeNull()
    } finally {
      app.unmount()
    }
  })

  it("validates, delivers enabled menu actions, replaces, and clears", async () => {
    const app = createTestApp({ render: () => null })
    const renderer = app.renderer

    try {
      await expect(setTrayMenu(renderer, [{ id: "open", label: "Open" }], () => {})).rejects.toThrow(
        "install the tray"
      )
      await setTray(renderer, { iconPath: "/icons/tray.png" })
      const onOpen = vi.fn()
      await setTrayMenu(renderer, [
        { id: "open", label: "Open" },
        { separator: true },
        { id: "disabled", label: "Disabled", disabled: true },
      ], onOpen)
      expect(renderer.getTrayMenu()).toHaveLength(3)

      await expect(setTrayMenu(renderer, [
        { id: "same", label: "First" },
        { id: "same", label: "Second" },
      ], () => {})).rejects.toThrow("duplicate")
      expect(renderer.getTrayMenu()).toHaveLength(3)

      renderer.simulateTrayMenuAction("open")
      renderer.simulateTrayMenuAction("disabled")
      renderer.simulateTrayMenuAction("missing")
      await vi.waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith("open"))

      const onQuit = vi.fn()
      await setTrayMenu(renderer, [{ id: "quit", label: "Quit" }], onQuit)
      renderer.simulateTrayMenuAction("open")
      renderer.simulateTrayMenuAction("quit")
      await vi.waitFor(() => expect(onQuit).toHaveBeenCalledExactlyOnceWith("quit"))
      expect(onOpen).toHaveBeenCalledTimes(1)

      await setTrayMenu(renderer, null)
      expect(renderer.getTrayMenu()).toBeNull()
      renderer.simulateTrayMenuAction("quit")
      expect(onQuit).toHaveBeenCalledTimes(1)

      await clearTray(renderer)
      expect(renderer.getTrayDesc()).toBeNull()
    } finally {
      app.unmount()
    }
  })
})
