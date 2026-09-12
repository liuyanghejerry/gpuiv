/** openUrl wiring: the test bridge records the URL, mirroring what the
 *  platform recorder (pub(crate) in gpui) would have seen. */

// @ts-nocheck

import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip


describeNative("openUrl", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("hands the URL to the renderer", async () => {
    const Root = defineComponent({
      setup() {
        return () => <div style={{ width: 100, height: 100 }} />
      },
    })
    app = createTestApp(Root)

    app.renderer.openUrl?.("https://example.com/pay")
    await app.settle()

    expect(app.renderer.getLastOpenedUrl()).toBe("https://example.com/pay")
  })
})
