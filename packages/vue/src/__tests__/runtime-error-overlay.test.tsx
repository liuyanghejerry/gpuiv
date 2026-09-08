/** Runtime error overlay — a throw must keep the window alive AND paint the
 *  error message + stack, with a Reload button that remounts the last tree.
 *  Every entry path funnels into scheduleRuntimeError: the app errorHandler,
 *  the native event-callback catch, and the process-level handlers. */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { defineComponent, h, onErrorCaptured, ref } from "vue"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer, TestRenderer } from "../testing.js"
import { createApp, resetApp } from "../renderer.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("runtime error overlay (vue)", () => {
  it("shows an overlay when a click-triggered render throws, then reloads", async () => {
    const renderer = new TestRenderer()
    try {
      const Boom = defineComponent({
        setup() {
          const boom = ref(false)
          return () => {
            if (boom.value) throw new Error("kaboom")
            return (
              <div
                testId="go"
                style={{ width: 100, height: 100 }}
                onClick={() => {
                  boom.value = true
                }}
              >
                <text>ok</text>
              </div>
            )
          }
        },
      })
      createApp(Boom, { renderer })
      renderer.flush()
      expect(renderer.getAllText()).toEqual(["ok"])

      renderer.nativeSimulateClick(10, 10)
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()

      const text = renderer.getAllText().join("\n")
      expect(text).toContain("Runtime error")
      expect(text).toContain("kaboom")
      expect(renderer.getPaintedText().join("\n")).toContain("kaboom")
      const reload = renderer.findByTestId("runtime-error-reload")
      expect(reload).toBeDefined()
      const bounds = renderer.getElementBounds(reload!.id)
      expect(bounds).not.toBeNull()
      renderer.nativeSimulateClick(bounds![0] + 8, bounds![1] + 8)
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
      expect(renderer.getAllText()).toEqual(["ok"])
    } finally {
      resetApp()
    }
  })

  it("does not paint a stale overlay over a later remount", async () => {
    const renderer = new TestRenderer()
    try {
      const Boom = defineComponent({
        render() {
          throw new Error("stale boom")
        },
      })
      createApp(Boom, { renderer })
      createApp(defineComponent({ setup: () => () => h("text", null, "fresh") }), {
        renderer,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
      expect(renderer.getAllText()).toEqual(["fresh"])
    } finally {
      resetApp()
    }
  })

  it("removes process error handlers on resetApp", () => {
    const renderer = new TestRenderer()
    const before = process.listenerCount("unhandledRejection")
    createApp(defineComponent({ setup: () => () => h("text", null, "ok") }), {
      renderer,
    })
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(before)
    resetApp()
    expect(process.listenerCount("unhandledRejection")).toBe(before)
  })

  it("routes a throwing native event handler through onErrorCaptured", async () => {
    const renderer = new TestRenderer()
    try {
      const seen: Array<[unknown, string]> = []
      const Boundary = defineComponent({
        setup(_, { slots }) {
          const failed = ref(false)
          onErrorCaptured((err, _instance, info) => {
            failed.value = true
            seen.push([err, info])
            return false
          })
          return () => (failed.value ? h("text", null, "fallback") : slots.default!())
        },
      })
      const Boom = defineComponent({
        setup() {
          return () => (
            <div
              testId="go"
              style={{ width: 100, height: 100 }}
              onClick={() => {
                throw new Error("evt boom")
              }}
            >
              <text>ok</text>
            </div>
          )
        },
      })
      const App = defineComponent({
        setup: () => () =>
          h(Boundary, null, { default: () => h(Boom) }),
      })
      createApp(App, { renderer })
      renderer.flush()
      // Slot fragments carry empty anchor text nodes; only real text matters.
      expect(renderer.getAllText().filter(Boolean)).toEqual(["ok"])
      // The anchors also take a line of layout each, so click inside the div's
      // own bounds rather than at the window origin.
      const go = renderer.findByTestId("go")!
      const goBounds = renderer.getElementBounds(go.id)!
      renderer.nativeSimulateClick(goBounds[0] + 10, goBounds[1] + 10)
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()

      expect(seen).toHaveLength(1)
      expect(String(seen[0][0])).toContain("evt boom")
      expect(seen[0][1]).toContain("native event handler")
      const text = renderer.getAllText().join("\n")
      expect(text).toContain("fallback")
      expect(text).not.toContain("Runtime error")
    } finally {
      resetApp()
    }
  })

  it("observes runtime errors through onRuntimeError", async () => {
    const renderer = new TestRenderer()
    const observed: Array<{ message: string; info: string }> = []
    try {
      const Boom = defineComponent({
        render() {
          throw new Error("observed boom")
        },
      })
      createApp(Boom, {
        renderer,
        onRuntimeError: (error, info) => observed.push({ message: String(error), info }),
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
      expect(observed).toHaveLength(1)
      expect(observed[0].message).toContain("observed boom")
      expect(observed[0].info).toContain("render function")
      // The overlay runs in parallel with the observer.
      expect(renderer.getAllText().join("\n")).toContain("Runtime error")
    } finally {
      resetApp()
    }
  })

  it("hides the overlay when errorOverlay is false", async () => {
    const renderer = new TestRenderer()
    const observed: string[] = []
    try {
      const Boom = defineComponent({
        render() {
          throw new Error("quiet boom")
        },
      })
      createApp(Boom, {
        renderer,
        errorOverlay: false,
        onRuntimeError: (error) => observed.push(String(error)),
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      renderer.flush()
      expect(observed).toHaveLength(1)
      expect(observed[0]).toContain("quiet boom")
      expect(renderer.getAllText().join("\n")).not.toContain("Runtime error")
    } finally {
      resetApp()
    }
  })

  it("shows a process-level unhandled rejection on the overlay", () => {
    const testingPath = fileURLToPath(new URL("../testing.ts", import.meta.url))
    const rendererPath = fileURLToPath(new URL("../renderer.ts", import.meta.url))
    const script = [
      'import { defineComponent, h } from "vue"',
      `import { TestRenderer } from ${JSON.stringify(testingPath)}`,
      `import { createApp } from ${JSON.stringify(rendererPath)}`,
      "const renderer = new TestRenderer()",
      'createApp(defineComponent({ setup: () => () => h("text", null, "ok") }), { renderer })',
      "renderer.flush()",
      'void Promise.reject(new Error("promise boom"))',
      "setTimeout(() => {",
      "  renderer.flush()",
      '  console.log("TEXT", JSON.stringify(renderer.getAllText()))',
      "  process.exit(0)",
      "}, 40)",
    ].join("\n")
    const result = spawnSync("bun", ["-e", script], {
      encoding: "utf8",
      timeout: 5_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    expect(result.stdout).toMatch(/promise boom/)
    expect(result.stdout).toMatch(/Reload/)
  })
})
