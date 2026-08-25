/**
 * GPUIX Vue Counter Example
 *
 * Shows how to use Vue 3 with GPUI via GPUIX.
 * Vue's custom renderer emits the same mutation protocol as the React one —
 * host ops are queued during patch and flushed with one applyBatch() call.
 */

import { defineComponent, ref } from "vue"
import { createApp } from "@gpuiv/vue"

const Counter = defineComponent({
  setup() {
    const count = ref(0)
    const hovered = ref(false)

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          width: 400,
          height: 300,
          backgroundColor: "#1e1e2e",
          borderRadius: 12,
        }}
      >
        <div
          testId="counter-value"
          style={{
            fontSize: 48,
            fontWeight: "bold",
            color: "#cdd6f4",
            cursor: "pointer",
          }}
          onClick={() => {
            count.value++
          }}
        >
          {count.value}
        </div>

        <div
          style={{
            color: "#a6adc8",
            fontSize: 14,
          }}
        >
          Click the number or + to increment
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
          }}
        >
          <div
            style={{
              padding: 12,
              paddingLeft: 24,
              paddingRight: 24,
              backgroundColor: count.value > 0 ? "#f38ba8" : "#6c7086",
              borderRadius: 8,
              cursor: count.value > 0 ? "pointer" : "default",
              opacity: count.value > 0 ? 1 : 0.5,
            }}
            onClick={() => {
              if (count.value > 0) count.value--
            }}
          >
            <div style={{ color: "#1e1e2e", fontWeight: "bold" }}>-</div>
          </div>

          <div
            testId="increment"
            style={{
              padding: 12,
              paddingLeft: 24,
              paddingRight: 24,
              backgroundColor: hovered.value ? "#94e2d5" : "#a6e3a1",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onClick={() => {
              count.value++
            }}
            onMouseEnter={() => {
              hovered.value = true
            }}
            onMouseLeave={() => {
              hovered.value = false
            }}
          >
            <div style={{ color: "#1e1e2e", fontWeight: "bold" }}>+</div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            padding: 16,
            backgroundColor: "#313244",
            borderRadius: 8,
            cursor: "pointer",
          }}
          onClick={() => {
            count.value = 0
          }}
        >
          <div style={{ color: "#bac2de", fontSize: 14 }}>Reset</div>
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <Counter />
      </div>
    )
  },
})

export { App, Counter }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("counter.tsx")

if (isEntryPoint) {
  createApp(App, { title: "GPUIX Vue Counter", width: 800, height: 600 })
}
