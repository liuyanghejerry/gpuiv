import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/vue"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { Input } from "../src/components/Input.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative("Input maxLength through native IME", () => {
  it("keeps marking intact until commit and corrects the committed editor value", async () => {
    const value = ref("")
    const composition: Array<[string, string]> = []
    const app = createTestApp(defineComponent(() => () => h(Input, { modelValue: value.value, maxLength: 1,
      "onUpdate:modelValue": (next: string) => { value.value = next },
      onCompositionStart: (event: EventPayload) => composition.push(["start", event.value ?? ""]),
      onCompositionUpdate: (event: EventPayload) => composition.push(["update", event.value ?? ""]),
      onCompositionEnd: (event: EventPayload) => composition.push(["end", event.value ?? ""]),
    })))
    try {
      const id = app.renderer.findByType("input")[0]!.id
      app.renderer.simulateMarkedText(id, "nihao")
      // Direct IME helpers queue native events without dispatching them to
      // Vue. The first settle delivers them after painting; the second
      // commits the resulting model/valueRevision back to the native editor.
      await app.settle()
      await app.settle()
      expect(value.value).toBe("nihao")
      expect(app.renderer.getPaintedInputRuns(id).filter(run => run.underline).map(run => run.text).join("")).toBe("nihao")
      app.renderer.simulateImeCommit(id, "你好")
      await app.settle()
      await app.settle()
      expect(value.value).toBe("你")
      const committedRuns = app.renderer.getPaintedInputRuns(id)
      expect(committedRuns.map(run => run.text).join("")).toBe("你")
      expect(committedRuns.some(run => run.underline)).toBe(false)
      expect(composition).toEqual([["start", ""], ["update", "nihao"], ["end", "你好"]])
      app.renderer.nativeSimulateKeystrokes(id, "backspace")
      await app.settle()
      expect(value.value).toBe("")
      expect(app.renderer.getPaintedInputRuns(id).map(run => run.text).join("")).toBe("")
    } finally { app.unmount() }
  })
})
