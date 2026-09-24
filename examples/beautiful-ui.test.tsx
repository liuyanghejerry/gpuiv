/**
 * Tests for the beautiful-ui gallery example (Phase 1 primitives).
 *
 * Mounts the real gallery through the GPU test renderer and drives it with
 * the in-process automation backend, same as counter.test.tsx.
 */

import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { darkTokens, lightTokens } from "@gpuiv/beautiful-ui"
import { App } from "./beautiful-ui"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("beautiful-ui gallery", () => {
  it("renders every Phase 1 section", () => {
    const app = createTestApp(App)

    const text = app.renderer.getAllText()
    for (const section of [
      "Atoms",
      "ContextCards",
      "SearchList",
      "FilterTable",
      "RecommendationCard",
      "ChatComposer",
      "CodeBlock — code",
      "CodeBlock — diff",
      "LoadingState",
      "ThinkingState (Phase 2: AnimateHeight)",
      "GlideMenu (Phase 2: bounds-driven highlight)",
      "TaskRows (Phase 3)",
      "ToolChips (Phase 3)",
      "StreamingText (Phase 3)",
      "DiffTable (Phase 3)",
      "FineTuneCard (Phase 3)",
      "ApprovalCard (Phase 3)",
      "SidebarNav (Phase 3)",
      "SelectionActions (Phase 3)",
    ]) {
      expect(text).toContain(section)
    }
    // Demo content from the primitives themselves.
    expect(text).toContain("All chunks")
    expect(text).toContain("Vendor onboarding rule")

    app.unmount()
  })

  it("switches the token map between light and dark", async () => {
    const app = createTestApp(App)

    const appBackground = () =>
      app.renderer.findByType("div").find((el) => el.style.backgroundColor === lightTokens.canvas || el.style.backgroundColor === darkTokens.canvas)
        ?.style.backgroundColor
    expect(appBackground()).toBe(lightTokens.canvas)

    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId("theme-toggle").click()

    expect(appBackground()).toBe(darkTokens.canvas)

    app.unmount()
  })
})
