/**
 * Window close interception demo — `onWindowShouldClose` cancels the red
 * button / ⌘W and hands the decision to JS; `closeWindow()` is the confirmed
 * close. `onReopen` counts Dock-icon relaunches.
 *
 * The observers are render-level options (same wiring as onKeyDown), so the
 * entry file installs them on createApp and shares state with the tree
 * through a module-level store.
 */

import { defineComponent, ref } from "vue"
import { createApp, useGpuixRequired } from "@gpuiv/vue"

const store = {
  dirty: ref(true),
  attempts: ref(0),
  reopens: ref(0),
  dismissed: ref(false),
}

const WindowClose = defineComponent({
  setup() {
    const renderer = useGpuixRequired()

    function attemptClose(): void {
      // The same path the OS close takes; armed via the entry options below.
      store.attempts.value++
      store.dismissed.value = false
    }

    function confirmClose(): void {
      renderer.closeWindow?.()
    }

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <text style={{ color: "#cdd6f4", fontSize: 20, fontWeight: "bold" }}>
          Close interception
        </text>
        <text style={{ color: "#a6adc8", fontSize: 14, width: 460 }}>
          Close the window (red button / ⌘W): while there is unsaved work the
          close is vetoed and reported here. Confirming calls closeWindow(),
          which closes for real.
        </text>

        <div
          testId="close-attempt"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 16,
            backgroundColor: "#1e1e2e",
            borderRadius: 12,
            minWidth: 380,
          }}
          onClick={attemptClose}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
            <text style={{ color: "#a6adc8", fontSize: 13 }}>close attempts</text>
            <text testId="close-attempt-count" style={{ color: "#f38ba8", fontSize: 13, fontWeight: "bold" }}>
              {String(store.attempts.value)}
            </text>
            <text style={{ color: "#a6adc8", fontSize: 13 }}>dock relaunches</text>
            <text testId="close-reopen-count" style={{ color: "#94e2d5", fontSize: 13, fontWeight: "bold" }}>
              {String(store.reopens.value)}
            </text>
          </div>
          <text style={{ color: "#6c7086", fontSize: 12 }}>
            (clicking this card simulates an OS close attempt)
          </text>
        </div>

        {store.attempts.value > 0 && !store.dismissed.value ? (
          <div
            testId="close-confirm-bar"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 16,
              backgroundColor: "#f38ba8",
              borderRadius: 12,
            }}
          >
            <text style={{ color: "#1e1e2e", fontSize: 14, fontWeight: "bold" }}>
              Unsaved work — close anyway?
            </text>
            <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
              <div
                testId="close-confirm-yes"
                style={{
                  padding: 8,
                  paddingLeft: 14,
                  paddingRight: 14,
                  backgroundColor: "#1e1e2e",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
                onClick={confirmClose}
              >
                <text style={{ color: "#f38ba8", fontSize: 13, fontWeight: "bold" }}>Close</text>
              </div>
              <div
                testId="close-confirm-no"
                style={{
                  padding: 8,
                  paddingLeft: 14,
                  paddingRight: 14,
                  backgroundColor: "#313244",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
                onClick={() => (store.dismissed.value = true)}
              >
                <text style={{ color: "#cdd6f4", fontSize: 13 }}>Keep editing</text>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <WindowClose />
      </div>
    )
  },
})

export { App, WindowClose, store }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("window-close.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Window Close",
    width: 640,
    height: 520,
    focus: process.env.GPUIX_BACKGROUND !== "1",
    onWindowShouldClose: () => {
      store.attempts.value++
      store.dismissed.value = false
    },
    onReopen: () => {
      store.reopens.value++
    },
  })
}
