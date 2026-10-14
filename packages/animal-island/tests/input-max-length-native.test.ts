import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../../vue/src/testing.js"
import { Input } from "../src/components/Input.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative("Input maxLength through native IME", () => {
  it("keeps marking intact until commit and corrects the committed editor value", async () => {
    const value = ref("")
    const app = createTestApp(defineComponent(() => () => h(Input, { modelValue: value.value, maxLength: 1,
      "onUpdate:modelValue": (next: string) => { value.value = next },
    })))
    try {
      const id = app.renderer.findByType("input")[0]!.id
      app.renderer.simulateMarkedText(id, "nihao")
      await app.settle()
      expect(value.value).toBe("nihao")
      expect(app.renderer.getPaintedInputRuns(id).filter(run => run.underline).map(run => run.text).join("")).toBe("nihao")
      app.renderer.simulateImeCommit(id, "你好")
      await app.settle()
      expect(value.value).toBe("你")
      app.renderer.nativeSimulateKeystrokes(id, "backspace")
      await app.settle()
      expect(value.value).toBe("")
    } finally { app.unmount() }
  })
})
