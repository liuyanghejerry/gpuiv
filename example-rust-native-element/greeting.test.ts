import { defineComponent, h, ref } from "vue"
import { expect, test } from "vitest"
import { connectTest } from "@gpuiv/vue/automation"
import { createTestApp, hasNativeTestRenderer } from "@gpuiv/vue"
import type { EventPayload } from "@gpuiv/native"

// The addon is loaded through NAPI_RS_NATIVE_LIBRARY_PATH (vitest.config.ts),
// so this file only passes when the Rust crate registered <rust-greeting>.
// The crate still builds everywhere; only the render-and-click half needs the
// GPU test renderer.
const test_ = hasNativeTestRenderer ? test : test.skip

test_("a crate adds <rust-greeting>: it paints, takes props, and emits events", async () => {
  const name = ref("world")
  const greeted: unknown[] = []
  const App = defineComponent({
    setup() {
      return () =>
        h("div", { style: { width: 300, height: 100, flexDirection: "column" } }, [
          h("text", null, "built-in"),
          h("rust-greeting", {
            testId: "greeting",
            name: name.value,
            style: { width: 200, height: 40 },
            onGreet: (event: EventPayload) => greeted.push(event.detail),
          }),
        ])
    },
  })

  const app = createTestApp(App)
  await app.settle()
  try {
    expect(app.renderer.getPaintedText()).toEqual(["built-in", "Hello, world"])

    const automation = await connectTest(app.renderer, app.settle)
    await automation.getByTestId("greeting").click()
    expect(greeted).toEqual([{ name: "world" }])

    name.value = "gpuiv"
    await app.settle()
    expect(app.renderer.getPaintedText()).toEqual(["built-in", "Hello, gpuiv"])
  } finally {
    app.unmount()
  }
})
