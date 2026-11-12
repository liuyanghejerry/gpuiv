/** GPU-backed activation test for the headless Button (Vue), ported from
 *  upstream's floating-controls suite (remorses/gpuix `dced20d`, Button half):
 *  a Button acts like `<button>` — click, Enter key-down (not a held repeat),
 *  Space key-up — and disabled leaves the Tab order while
 *  focusableWhenDisabled keeps it. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { HostNode } from "../types.js"
import { Button } from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("button (vue)", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("activates like <button>: click, Enter down, Space up, disabled", async () => {
    const log: string[] = []
    const disabled = ref(false)
    const Demo = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", gap: 8, padding: 12 }}>
          <div autoFocus tabIndex={0} testId="start" style={{ width: 20, height: 20 }} />
          <Button
            testId="save"
            disabled={disabled.value}
            onClick={() => log.push("save")}
            style={{ width: 60, height: 24 }}
          >
            Save
          </Button>
          <Button
            testId="busy"
            disabled
            focusableWhenDisabled
            onClick={() => log.push("busy")}
            style={{ width: 60, height: 24 }}
          >
            Busy
          </Button>
          <div tabIndex={0} testId="end" style={{ width: 20, height: 20 }} />
        </div>
      ),
    })
    app = createTestApp(Demo)
    await app.settle()
    const renderer = app.renderer
    const focused = () => {
      const id = renderer.getFocusedElementId()
      if (id == null) return null
      const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
      return walk(app.container).find((candidate) => candidate.id === id)?.props.testId ?? id
    }

    renderer.simulateKeystrokes("tab")
    await app.settle()
    log.push(`focus ${focused()}`)
    renderer.simulateKeystrokes("enter")
    await app.settle()
    // A held Enter is a repeat, not a fresh press.
    renderer.nativeSimulateKeyDown(renderer.getFocusedElementId(), "enter", true)
    await app.settle()
    // simulateKeystrokes sends no key up, so press and release Space by hand.
    renderer.nativeSimulateKeyDown(renderer.getFocusedElementId(), "space")
    await app.settle()
    log.push("space down")
    renderer.nativeSimulateKeyUp(renderer.getFocusedElementId(), "space")
    await app.settle()
    const box = renderer.getElementBounds(renderer.findByTestId("save").id)
    log.push("click")
    renderer.nativeSimulateClick(box.x + 4, box.y + 4)
    await app.settle()
    renderer.simulateKeystrokes("tab")
    await app.settle()
    log.push(`focus ${focused()}`)
    renderer.simulateKeystrokes("enter")
    await app.settle()

    // With save disabled, Tab skips straight to the still-focusable busy one.
    disabled.value = true
    await app.settle()
    renderer.focusElement(renderer.findByTestId("start").id)
    renderer.simulateKeystrokes("tab")
    await app.settle()
    log.push(`focus ${focused()}`)
    renderer.nativeSimulateClick(box.x + 4, box.y + 4)
    await app.settle()

    expect(log).toEqual([
      "focus save",
      "save",
      "space down",
      "save",
      "click",
      "save",
      "focus busy",
      "focus busy",
    ])
  })
})
