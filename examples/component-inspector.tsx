/**
 * Minimal agent-inspectable GPUIX app.
 *
 * Components return their state from `setup()` as an object (not a closure
 * render), so the automation protocol's component inspector can read it live
 * — see README "Component state". Driven by component-inspector.test.tsx
 * through a real window over stdio.
 */

import { defineComponent, h, ref } from "vue"
import { createApp } from "@gpuiv/vue"

const CounterBlock = defineComponent({
  name: "CounterBlock",
  setup() {
    return { count: ref(0) }
  },
  render() {
    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          width: 400,
          height: 300,
          backgroundColor: "#1e1e2e",
          borderRadius: 12,
        },
      },
      [
        h(
          "div",
          {
            testId: "inspector-value",
            style: { fontSize: 48, fontWeight: "bold", color: "#cdd6f4" },
          },
          [h("text", `count=${this.count}`)]
        ),
        h(
          "div",
          {
            testId: "inspector-increment",
            style: {
              padding: 12,
              paddingLeft: 24,
              paddingRight: 24,
              backgroundColor: "#a6e3a1",
              borderRadius: 8,
              cursor: "pointer",
            },
            onClick: () => {
              this.count++
            },
          },
          [h("text", "+1")]
        ),
      ]
    )
  },
})

const App = defineComponent({
  name: "InspectorApp",
  setup() {
    return { title: ref("inspector demo") }
  },
  render() {
    return h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        },
      },
      [h(CounterBlock)]
    )
  },
})

export { App, CounterBlock }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("component-inspector.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIX Component Inspector",
    width: 800,
    height: 600,
    // Agent checks need real GPU paint, not control of the user's keyboard.
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
