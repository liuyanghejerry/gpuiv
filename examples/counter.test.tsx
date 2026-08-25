/**
 * Tests for the Vue counter example.
 *
 * Renders the real app through the GPU test renderer and drives it with the
 * in-process automation backend (same protocol as a live app).
 */

import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App } from "./counter"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("vue counter example", () => {
  it("renders the counter and increments on click", async () => {
    const app = createTestApp(App)

    expect(app.renderer.getAllText()).toContain("0")

    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId("increment").click()

    expect(app.renderer.getAllText()).toContain("1")

    app.unmount()
  })

  it("applies styles from the style prop", async () => {
    const app = createTestApp(App)

    const root = app.renderer.getRoot()
    expect(root?.type).toBe("div")
    const counter = app.renderer.findByType("div").find((el) => el.id === root?.children[0])
    expect(counter?.style.backgroundColor).toBe("#11111b")

    app.unmount()
  })
})
