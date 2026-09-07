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

  it("delivers primary clicks with a DOM-like payload", async () => {
    let click: EventPayload | undefined
    const TextInput = defineComponent({
      setup() {
        return () => (
          <input
            value=""
            style={{ width: 300, height: 40 }}
            onClick={(event: EventPayload) => {
              click = event
            }}
          />
        )
      },
    })
    app = createTestApp(TextInput)

    const input = app.renderer.findByType("input")[0]
    const bounds = app.renderer.getElementBounds(input.id)!
    app.renderer.nativeSimulateMouseDown(bounds[0] + 10, bounds[1] + 10, 0)
    app.renderer.nativeSimulateMouseUp(bounds[0] + 10, bounds[1] + 10, 0)
    await app.settle()
    expect(click).toMatchObject({ button: 0, isRightClick: false })
    app.unmount()
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

  it("inserts a newline on enter in a textarea", async () => {
    const Textarea = defineComponent({
      setup() {
        const text = ref("")
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
              placeholder="Write a message..."
              minRows={1}
              maxRows={4}
              style={{ width: 300 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
            />
            <text>{`Value: ${JSON.stringify(text.value)}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(Textarea)
    const textarea = app.renderer.findByType("textarea")[0]

    app.renderer.nativeSimulateKeystrokes(textarea.id, "h i enter t h e r e")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(['Value: "hi\\nthere"'])
  })

  it("inserts a newline in the middle of a textarea buffer", async () => {
    const Textarea = defineComponent({
      setup() {
        const text = ref("ab")
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
              style={{ width: 300 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
            />
            <text>{`Value: ${JSON.stringify(text.value)}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(Textarea)
    const textarea = app.renderer.findByType("textarea")[0]

    app.renderer.nativeSimulateKeystrokes(textarea.id, "left enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "a\\nb"')
  })

  it("replaces a textarea selection with a newline and undoes the edit", async () => {
    const Textarea = defineComponent({
      setup() {
        const text = ref("abc")
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
              style={{ width: 300 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
            />
            <text>{`Value: ${JSON.stringify(text.value)}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(Textarea)
    const textarea = app.renderer.findByType("textarea")[0]

    app.renderer.nativeSimulateKeystrokes(textarea.id, "shift-left enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "ab\\n"')

    app.renderer.nativeSimulateKeystrokes(textarea.id, "cmd-z")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "abc"')
  })

  it("submits a textarea when onSubmit is set", async () => {
    const Textarea = defineComponent({
      setup() {
        const text = ref("")
        const submits = ref(0)
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
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

  it("switches enter between newline and submit when onSubmit is added", async () => {
    const submit = ref(false)
    const Textarea = defineComponent({
      setup() {
        const text = ref("ab")
        const submits = ref(0)
        return () => (
          <div style={{ width: 400, height: 160 }}>
            <textarea
              value={text.value}
              style={{ width: 300 }}
              onChange={(event: EventPayload) => (text.value = event.value ?? "")}
              onSubmit={submit.value ? () => (submits.value += 1) : undefined}
            />
            <text>{`Value: ${JSON.stringify(text.value)}`}</text>
            <text>{`Submits: ${submits.value}`}</text>
          </div>
        )
      },
    })
    app = createTestApp(Textarea)
    const textarea = app.renderer.findByType("textarea")[0]

    app.renderer.nativeSimulateKeystrokes(textarea.id, "left enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "a\\nb"')
    expect(app.renderer.getAllText()).toContain("Submits: 0")

    submit.value = true
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(textarea.id, "enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "a\\nb"')
    expect(app.renderer.getAllText()).toContain("Submits: 1")

    submit.value = false
    await app.settle()
    app.renderer.nativeSimulateKeystrokes(textarea.id, "enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain('Value: "a\\n\\nb"')
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

  it("undoes a contiguous typing run as one edit", async () => {
    const TextInput = defineComponent({
      setup() {
        const text = ref("")
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <input
              value={text.value}
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
    app.renderer.nativeSimulateKeystrokes(input.id, "a b c cmd-z")
    await app.settle()

    expect(app.renderer.getAllText()).toContain("Value: ")
    expect(app.renderer.getAllText()).not.toContain("Value: ab")
  })

  it("does not coalesce typing after 700ms", async () => {
    const TextInput = defineComponent({
      setup() {
        const text = ref("")
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <input
              value={text.value}
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
    app.renderer.nativeSimulateKeystrokes(input.id, "a")
    app.renderer.advanceTime(800)
    app.renderer.nativeSimulateKeystrokes(input.id, "b cmd-z")
    await app.settle()

    expect(app.renderer.getAllText()).toContain("Value: a")
  })

  it("undoes contiguous backward deletion as one edit", async () => {
    const TextInput = defineComponent({
      setup() {
        const text = ref("abcd")
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <input
              value={text.value}
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
    app.renderer.nativeSimulateKeystrokes(input.id, "backspace backspace cmd-z")
    await app.settle()

    expect(app.renderer.getAllText()).toContain("Value: abcd")
  })

  it("undoes contiguous forward deletion as one edit", async () => {
    const TextInput = defineComponent({
      setup() {
        const text = ref("abcd")
        return () => (
          <div style={{ width: 400, height: 100 }}>
            <input
              value={text.value}
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
    app.renderer.nativeSimulateKeystrokes(input.id, "cmd-left delete delete cmd-z")
    await app.settle()

    expect(app.renderer.getAllText()).toContain("Value: abcd")
  })
})
