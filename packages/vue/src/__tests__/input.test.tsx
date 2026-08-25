/** End-to-end tests for the native GPUI text editor host elements (Vue). */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("native text editors (vue)", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("edits text natively and emits the complete value", async () => {
    const TextInput = defineComponent({
      setup() {
        const text = ref("")
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <input
              value={text.value}
              placeholder="Type here..."
              style={{ width: 300, height: 40 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
            />
            <text>{`Value: ${text.value}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(TextInput)

    const input = app.renderer.findByType("input")[0]
    app.renderer.nativeSimulateKeystrokes(input.id, "h i")
    await app.settle()

    expect(app.renderer.getAllText()).toEqual(["Value: hi"])
    expect(app.renderer.getPaintedText()).toContain("hi")
  })

  it("supports multiline textarea editing and submission", async () => {
    const Textarea = defineComponent({
      setup() {
        const text = ref("")
        const submits = ref(0)
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
              placeholder="Write a message..."
              minRows={1}
              maxRows={4}
              style={{ width: 300 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
              onSubmit={() => (submits.value += 1)}
            />
            <text>{`Value: ${JSON.stringify(text.value)}`}</text>
            <text>{`Submits: ${submits.value}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(Textarea)
    const textarea = app.renderer.findByType("textarea")[0]

    app.renderer.nativeSimulateKeystrokes(textarea.id, "h i shift-enter t h e r e")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual([
      'Value: "hi\\nthere"',
      "Submits: 0",
    ])

    app.renderer.nativeSimulateKeystrokes(textarea.id, "enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Submits: 1")
  })

  it("receives keyDown and KeyUp events in Vue handlers", async () => {
    const keys = ref<string[]>([])
    const KeyCatcher = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <div
              style={{ width: 200, height: 50 }}
              tabIndex={0}
              onKeyDown={(e: EventPayload) => keys.value.push(`down:${e.key}`)}
              onKeyUp={(e: EventPayload) => keys.value.push(`up:${e.key}`)}
            >
              <text>focus me</text>
            </div>
            <text>{keys.value.join(",")}</text>
          </div>
        )
      },
    })
    app = createTestApp(KeyCatcher)
    const keyDiv = app.renderer
      .findByType("div")
      .find((d) => d.events.has("keyDown") && d.events.has("keyUp"))!

    app.renderer.nativeSimulateKeyDown(keyDiv.id, "a")
    app.renderer.nativeSimulateKeyUp(keyDiv.id, "a")
    await app.settle()
    const all = app.renderer.getAllText().join("")
    expect(all).toContain("down:a")
    expect(all).toContain("up:a")
    app.renderer.nativeSimulateKeyDown(keyDiv.id, "b")
    await app.settle()
    expect(app.renderer.getAllText().join("")).toContain("down:b")
  })
})
