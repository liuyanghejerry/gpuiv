/**
 * GPUIV error-handling example
 *
 * A runnable tour of the runtime error story: a render throw and a click
 * handler throw both replace the tree with the overlay (Reload remounts it),
 * an `onErrorCaptured` boundary swallows errors from its own subtree so the
 * overlay never fires, and `onRuntimeError` receives every routed error —
 * here painted as a report log, in a real app the place to forward to Sentry.
 */

import { defineComponent, onErrorCaptured, ref } from "vue"
import { createApp } from "@gpuiv/vue"

type Report = { at: string; info: string; message: string }

/** The onRuntimeError log — module-level so it survives a Reload remount. */
const reports = ref<Report[]>([])

const palette = {
  root: "#11111b",
  card: "#1e1e2e",
  surface: "#313244",
  text: "#cdd6f4",
  muted: "#a6adc8",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
}

const cardStyle = {
  display: "flex",
  flexDirection: "column",
  padding: 20,
  gap: 12,
  backgroundColor: palette.card,
  borderRadius: 12,
}

const buttonStyle = {
  display: "flex",
  alignSelf: "flex-start",
  padding: 10,
  paddingLeft: 20,
  paddingRight: 20,
  borderRadius: 8,
  cursor: "pointer",
}

/** Throws on its next render once armed — the render-error path. */
const RenderBomb = defineComponent({
  props: { armed: { type: Boolean, required: true } },
  setup(props) {
    return () => {
      if (props.armed) throw new Error("render bomb: this component throws while armed")
      return (
        <div
          testId="render-bomb"
          style={{
            padding: 8,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: 6,
            backgroundColor: palette.surface,
          }}
        >
          <text style={{ fontSize: 12, color: palette.muted }}>render bomb — disarmed</text>
        </div>
      )
    }
  },
})

/** The risky child. A boundary only catches errors from DESCENDANT
 *  components — its own subtree's throws sail past it — so the button has to
 *  live in its own component under the guard. */
const BoundaryBomb = defineComponent({
  setup() {
    return () => (
      <div
        testId="throw-in-boundary"
        style={{ ...buttonStyle, backgroundColor: palette.green }}
        onClick={() => {
          throw new Error("boundary bomb: caught by the card, not the overlay")
        }}
      >
        <text style={{ fontSize: 13, fontWeight: 600, color: palette.root }}>
          Throw inside the boundary
        </text>
      </div>
    )
  },
})

/** The boundary pattern: onErrorCaptured returning false keeps this card's
 *  descendant errors local (render throws and event-handler throws alike), so
 *  the global overlay never fires for them. */
const GuardedCard = defineComponent({
  setup() {
    const failure = ref<string | null>(null)
    onErrorCaptured((error) => {
      failure.value = String(error)
      return false
    })
    return () =>
      failure.value == null ? (
        <div style={cardStyle}>
          <text style={{ fontSize: 15, fontWeight: 600, color: palette.text }}>
            2 · Local fallback — onErrorCaptured
          </text>
          <text style={{ fontSize: 12, color: palette.muted }}>
            This card catches errors from its subtree. The overlay stays out of it.
          </text>
          <BoundaryBomb />
        </div>
      ) : (
        <div style={cardStyle}>
          <text style={{ fontSize: 15, fontWeight: 600, color: palette.yellow }}>
            caught locally — the overlay never fired
          </text>
          <text style={{ fontSize: 12, color: palette.muted }}>{failure.value}</text>
          <div
            testId="boundary-retry"
            style={{ ...buttonStyle, backgroundColor: palette.surface }}
            onClick={() => {
              failure.value = null
            }}
          >
            <text style={{ fontSize: 13, fontWeight: 600, color: palette.text }}>Retry</text>
          </div>
        </div>
      )
  },
})

const App = defineComponent({
  setup() {
    const armed = ref(false)
    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 24,
          gap: 16,
          overflowY: "scroll",
          backgroundColor: palette.root,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <text style={{ fontSize: 22, fontWeight: 700, color: palette.text }}>
            Runtime errors
          </text>
          <text style={{ fontSize: 13, color: palette.muted }}>
            Throw something — the process survives, the overlay explains, Reload restores.
          </text>
        </div>

        <div style={cardStyle}>
          <text style={{ fontSize: 15, fontWeight: 600, color: palette.text }}>
            1 · Global overlay
          </text>
          <text style={{ fontSize: 12, color: palette.muted }}>
            Both throws replace the tree with the error overlay; its Reload
            button remounts this app fresh.
          </text>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              testId="throw-render"
              style={{ ...buttonStyle, backgroundColor: palette.red }}
              onClick={() => {
                armed.value = true
              }}
            >
              <text style={{ fontSize: 13, fontWeight: 600, color: palette.root }}>
                Throw in render
              </text>
            </div>
            <div
              testId="throw-handler"
              style={{ ...buttonStyle, backgroundColor: palette.red }}
              onClick={() => {
                throw new Error("click handler bomb: thrown straight from onClick")
              }}
            >
              <text style={{ fontSize: 13, fontWeight: 600, color: palette.root }}>
                Throw in click handler
              </text>
            </div>
          </div>
          <RenderBomb armed={armed.value} />
        </div>

        <GuardedCard />

        <div testId="report-log" style={cardStyle}>
          <text style={{ fontSize: 15, fontWeight: 600, color: palette.text }}>
            3 · onRuntimeError reports
          </text>
          {reports.value.length === 0 ? (
            <text style={{ fontSize: 12, color: palette.muted }}>
              Nothing reported yet — trigger a throw above. In a real app this
              is where a Sentry client would forward (error, info).
            </text>
          ) : (
            reports.value.map((report) => (
              <div
                key={`${report.at}-${report.info}-${report.message}`}
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <text style={{ fontSize: 12, color: palette.green }}>
                  {report.at} · {report.info}
                </text>
                <text style={{ fontSize: 12, color: palette.muted }}>{report.message}</text>
              </div>
            ))
          )}
        </div>
      </div>
    )
  },
})

export { App, reports }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("error-handling.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Error Handling",
    width: 780,
    height: 760,
    // Agent checks need real GPU paint, not control of the user's keyboard.
    focus: process.env.GPUIX_BACKGROUND !== "1",
    onRuntimeError: (error, info) => {
      reports.value.unshift({
        at: new Date().toLocaleTimeString(),
        info,
        message: String(error),
      })
      if (reports.value.length > 6) reports.value.pop()
    },
  })
}
