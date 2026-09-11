/**
 * Tests for the error-handling example — driven through the real createApp()
 * path (injected test renderer), so the overlay, Reload, and the observer
 * options are the production ones.
 */

import { describe, expect, it } from "vitest"
import { createApp, resetApp } from "@gpuiv/vue"
import { hasNativeTestRenderer, TestRenderer } from "@gpuiv/vue/testing"
import { App, reports } from "./error-handling"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function clickCenter(renderer: TestRenderer, testId: string): void {
  const element = renderer.findByTestId(testId)
  if (!element) throw new Error(`missing testId: ${testId}`)
  const bounds = renderer.getElementBounds(element.id)
  if (!bounds) throw new Error(`no bounds for testId: ${testId}`)
  renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

async function settleOverlay(): Promise<void> {
  // Vue's scheduler flush and the overlay's microtask both need to drain.
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describeNative("vue error-handling example", () => {
  it("falls back locally inside the boundary, without the overlay", async () => {
    const renderer = new TestRenderer()
    try {
      createApp(App, { renderer })
      renderer.flush()

      clickCenter(renderer, "throw-in-boundary")
      await settleOverlay()
      renderer.flush()

      const text = renderer.getAllText().join("\n")
      expect(text).toContain("caught locally")
      expect(text).toContain("boundary bomb")
      expect(renderer.findByTestId("runtime-error-overlay")).toBeUndefined()

      clickCenter(renderer, "boundary-retry")
      await settleOverlay()
      renderer.flush()
      expect(renderer.findByTestId("throw-in-boundary")).toBeDefined()
    } finally {
      resetApp()
    }
  })

  it("routes handler and render throws through the overlay, and Reload restores", async () => {
    const renderer = new TestRenderer()
    const seen: Array<{ message: string; info: string }> = []
    reports.value = []
    try {
      createApp(App, {
        renderer,
        onRuntimeError: (error, info) => seen.push({ message: String(error), info }),
      })
      renderer.flush()

      clickCenter(renderer, "throw-handler")
      await settleOverlay()
      renderer.flush()
      let text = renderer.getAllText().join("\n")
      expect(renderer.findByTestId("runtime-error-overlay")).toBeDefined()
      expect(text).toContain("click handler bomb")
      expect(
        seen.some(
          (entry) => entry.info === "native event handler" && entry.message.includes("click handler bomb"),
        ),
      ).toBe(true)

      clickCenter(renderer, "runtime-error-reload")
      await settleOverlay()
      renderer.flush()
      text = renderer.getAllText().join("\n")
      expect(renderer.findByTestId("runtime-error-overlay")).toBeUndefined()
      expect(renderer.findByTestId("throw-render")).toBeDefined()

      clickCenter(renderer, "throw-render")
      await settleOverlay()
      renderer.flush()
      text = renderer.getAllText().join("\n")
      expect(renderer.findByTestId("runtime-error-overlay")).toBeDefined()
      expect(text).toContain("render bomb")
      expect(seen.some((entry) => entry.info === "render function")).toBe(true)
    } finally {
      reports.value = []
      resetApp()
    }
  })
})
