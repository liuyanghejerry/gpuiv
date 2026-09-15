/**
 * Smoke tests for the gap-batch demo apps — each demo mounts through the GPU
 * test renderer and its headline behaviour is driven once, so the examples
 * cannot silently rot after API changes.
 */

import { describe, expect, it } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue/testing"
import { App as ClipboardApp } from "./clipboard"
import { App as MarkdownImagesApp } from "./markdown-images"
import { App as RuntimeMenusApp } from "./runtime-menus"
import { App as WindowCloseApp, store as windowCloseStore } from "./window-close"
import { App as ImeApp } from "./ime-composition"
import { App as StreamingApp, CHUNKS } from "./streaming-code"
import { App as SpinnerApp } from "./spinner"
import { App as CanvasBlendsApp } from "./canvas-blends"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("gap-batch demos", () => {
  it("clipboard: text and image round-trip through the test clipboard", async () => {
    const app = createTestApp(ClipboardApp)
    const automation = await connectTest(app.renderer, app.settle)

    await automation.getByTestId("copy-text").click()
    await app.settle()
    await automation.getByTestId("paste-text").click()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("你好，clipboard！")

    await automation.getByTestId("copy-image").click()
    await app.settle()
    await automation.getByTestId("paste-image").click()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toMatch(/96×96 RGBA/)
    app.unmount()
  })

  it("markdown images: blocks render, mixed stays text, broken falls back", async () => {
    const app = createTestApp(MarkdownImagesApp, { width: 1100 })
    await app.settle()
    // `<markdown>` paints inside gpui — getAllText only sees `<text>` nodes.
    const painted = app.renderer.getPaintedText().join("\n")
    expect(painted).toContain("one block each")
    // The mixed-in image's alt is link text; the broken URL's alt is the
    // fallback card.
    expect(painted).toContain("the icon")
    expect(painted).toContain("this source does not decode")
    app.unmount()
  })

  it("runtime menus: installs on mount and fires ids through the bridge", async () => {
    const app = createTestApp(RuntimeMenusApp)
    await app.settle()
    const menus = app.renderer.getLastMenus()
    expect(menus).not.toBeNull()
    expect(menus![0]!.name).toBe("Demo")
    const settings = menus![0]!.items.find((item: any) => item.id === "settings")
    expect(settings.keystroke).toBe("cmd-,")

    app.renderer.fireMenuAction("toggle-theme")
    // The click crosses the threadsafe callback — poll for the reinstall.
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const view = app.renderer
        .getLastMenus()
        ?.find((menu) => menu.name === "View")
      const theme = view?.items.find((item: any) => item.id === "toggle-theme")
      if (theme && theme.checked === false) break
    }
    const view = app.renderer.getLastMenus()!.find((menu) => menu.name === "View")!
    const theme = view.items.find((item: any) => item.id === "toggle-theme")
    expect(theme.checked).toBe(false)
    app.unmount()
  })

  it("window close: veto reports, confirm closes", async () => {
    // The observers are render-level options — the test wires the same
    // handlers the demo's entry file installs.
    const app = createTestApp(WindowCloseApp, {
      onWindowShouldClose: () => {
        windowCloseStore.attempts.value++
        windowCloseStore.dismissed.value = false
      },
      onReopen: () => windowCloseStore.reopens.value++,
    })
    expect(app.renderer.attemptWindowClose()).toBe(false)
    await app.settle()
    expect(windowCloseStore.attempts.value).toBe(1)
    expect(app.renderer.getWindowCloseCount()).toBe(0)
    app.renderer.closeWindow()
    expect(app.renderer.getWindowCloseCount()).toBe(1)
    app.unmount()
  })

  it("ime composition: marking flips the badge and updates the marked text", async () => {
    const app = createTestApp(ImeApp)
    const composer = app.renderer.findByTestId("ime-composer")
    expect(composer).toBeTruthy()

    app.renderer.simulateMarkedText(composer!.id, "ni")
    // Composition events dispatch after the first flush; the re-render they
    // trigger needs a second settle round.
    await app.settle()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("composing")
    expect(app.renderer.getAllText().join("\n")).toContain("ni")

    app.renderer.simulateImeCommit(composer!.id, "你")
    await app.settle()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("idle")
    app.unmount()
  })

  it("streaming code: step appends chunks deterministically", async () => {
    const app = createTestApp(StreamingApp, { width: 1100 })
    const automation = await connectTest(app.renderer, app.settle)
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("0 / " + CHUNKS.length)

    await automation.getByTestId("stream-step").click()
    await app.settle()
    await automation.getByTestId("stream-step").click()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("2 / " + CHUNKS.length)
    // `<code>` paints inside gpui — the streamed source is painted text.
    expect(app.renderer.getPaintedText().join("\n")).toContain("//! A")
    app.unmount()
  })

  it("spinner: variants render and the thinking toggle flips the copy", async () => {
    const app = createTestApp(SpinnerApp, { width: 1100 })
    const automation = await connectTest(app.renderer, app.settle)
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("Thinking…")

    await automation.getByTestId("spinner-toggle-thinking").click()
    await app.settle()
    expect(app.renderer.getAllText().join("\n")).toContain("Done.")
    app.unmount()
  })

  it("canvas blends: the non-separable labels paint", async () => {
    const app = createTestApp(CanvasBlendsApp, { width: 1100 })
    await app.settle()
    const painted = app.renderer.getAllText().join("\n")
    for (const mode of ["hue", "saturation", "color", "luminosity", "multiply", "difference"]) {
      expect(painted).toContain(mode)
    }
    app.unmount()
  })
})
