/// Tray API contract through the offscreen test bridge: install records the
/// descriptor, clicks reach the JS handler, clear removes.

import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { clearTray, setTray } from "../tray.js"

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
})
