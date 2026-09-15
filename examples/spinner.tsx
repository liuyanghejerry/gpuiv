/**
 * Spinner demo — the `Spinner` loading primitive in both variants, at a few
 * sizes, and in a mock "thinking…" chat bubble. The pinned row passes a
 * `phase`, freezing the animation exactly like a deterministic test or
 * screenshot would.
 */

import { defineComponent, ref, type PropType, type VNode } from "vue"
import { Spinner, createApp } from "@gpuiv/vue"

const Row = defineComponent({
  props: {
    label: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
        <text style={{ color: "#a6adc8", fontSize: 13, width: 120 }}>{props.label}</text>
        {slots.default?.()}
      </div>
    )
  },
})

const Card = defineComponent({
  props: {
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 20,
          backgroundColor: "#1e1e2e",
          borderRadius: 12,
        }}
      >
        <text style={{ color: "#cdd6f4", fontSize: 15, fontWeight: "bold" }}>{props.title}</text>
        {slots.default?.()}
      </div>
    )
  },
})

const SpinnerDemo = defineComponent({
  setup() {
    const thinking = ref(true)

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 20,
          padding: 28,
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <Card title="Dots — animated">
          <Row label="size 8">
            <Spinner />
          </Row>
          <Row label="size 12">
            <Spinner size={12} />
          </Row>
          <Row label="size 16, tinted">
            <Spinner size={16} color="#f38ba8" />
          </Row>
        </Card>

        <Card title="Pulse — animated">
          <Row label="default">
            <Spinner variant="pulse" />
          </Row>
          <Row label="thin + wide">
            <Spinner variant="pulse" size={3} width={140} />
          </Row>
          <Row label="tinted">
            <Spinner variant="pulse" color="#94e2d5" />
          </Row>
        </Card>

        <Card title="Pinned (phase prop)">
          <Row label="phase 0">
            <Spinner phase={0} />
          </Row>
          <Row label="phase 300">
            <Spinner phase={300} />
          </Row>
          <Row label="phase 600">
            <Spinner phase={600} />
          </Row>
          <text style={{ color: "#6c7086", fontSize: 12, width: 220 }}>
            A fixed phase freezes the cycle — the deterministic hook tests and
            screenshot diffs use.
          </text>
        </Card>

        <Card title="In context">
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 14,
              backgroundColor: "#313244",
              borderRadius: 10,
            }}
          >
            {thinking.value ? <Spinner label="Thinking" /> : null}
            <text testId="spinner-context" style={{ color: "#cdd6f4", fontSize: 14 }}>
              {thinking.value ? "Thinking…" : "Done."}
            </text>
          </div>
          <div
            testId="spinner-toggle-thinking"
            style={{
              padding: 8,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundColor: thinking.value ? "#a6e3a1" : "#89b4fa",
              borderRadius: 8,
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
            onClick={() => (thinking.value = !thinking.value)}
          >
            <text style={{ color: "#1e1e2e", fontSize: 13, fontWeight: "bold" }}>
              {thinking.value ? "Answer" : "Ask again"}
            </text>
          </div>
        </Card>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <SpinnerDemo />
      </div>
    )
  },
})

export { App, SpinnerDemo }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("spinner.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Spinner",
    width: 940,
    height: 560,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
