/**
 * IME composition demo — a composer that tracks the DOM composition
 * lifecycle (`onCompositionStart` / `onCompositionUpdate` /
 * `onCompositionEnd`) and suppresses its submit shortcut while a candidate
 * is open. Type with a pinyin/kanji IME to see the marked text and events.
 */

import { defineComponent, ref } from "vue"
import { createApp } from "@gpuiv/vue"

const LOG_LIMIT = 8

const ImeComposition = defineComponent({
  setup() {
    const draft = ref("")
    const composing = ref(false)
    const marked = ref("")
    const submitted = ref<string[]>([])
    const log = ref<string[]>([])

    function note(line: string): void {
      log.value = [...log.value.slice(-(LOG_LIMIT - 1)), line]
    }

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <text style={{ color: "#cdd6f4", fontSize: 20, fontWeight: "bold" }}>
          IME composition events
        </text>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 8,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 8,
            backgroundColor: composing.value ? "#f9e2af" : "#313244",
          }}
        >
          <text
            testId="ime-state"
            style={{ color: composing.value ? "#1e1e2e" : "#6c7086", fontSize: 13, fontWeight: "bold" }}
          >
            {composing.value ? "composing" : "idle"}
          </text>
          {composing.value ? (
            <text testId="ime-marked" style={{ color: "#1e1e2e", fontSize: 13 }}>
              {marked.value}
            </text>
          ) : null}
        </div>

        <textarea
          testId="ime-composer"
          value={draft.value}
          placeholder="用中文输入法打字试试 / type with an IME"
          minRows={2}
          maxRows={4}
          style={{
            width: 460,
            padding: 12,
            backgroundColor: "#1e1e2e",
            borderRadius: 10,
            color: "#cdd6f4",
          }}
          onChange={(e) => (draft.value = e.value ?? "")}
          onCompositionStart={() => {
            composing.value = true
            marked.value = ""
            note("start")
          }}
          onCompositionUpdate={(e) => {
            marked.value = e.value ?? ""
            note(`update “${e.value ?? ""}”`)
          }}
          onCompositionEnd={(e) => {
            composing.value = false
            marked.value = ""
            note(`end “${e.value ?? ""}”`)
          }}
          onSubmit={() => {
            // Enter submits — the platform never fires Enter as submit while
            // a composition is open, and the composition observers above are
            // what an app uses to gate its own shortcuts.
            if (composing.value) return
            if (!draft.value.trim()) return
            submitted.value = [...submitted.value.slice(-2), draft.value]
            draft.value = ""
            note("submitted")
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 14,
            backgroundColor: "#1e1e2e",
            borderRadius: 12,
            width: 460,
            minHeight: 120,
          }}
        >
          <text style={{ color: "#89b4fa", fontSize: 13, fontWeight: "bold" }}>
            Events
          </text>
          {log.value.length === 0 ? (
            <text testId="ime-nothing" style={{ color: "#6c7086", fontSize: 13 }}>
              waiting for input…
            </text>
          ) : (
            log.value.map((line, ix) => (
              <text key={ix} style={{ color: "#a6adc8", fontSize: 13 }}>
                {line}
              </text>
            ))
          )}
          {submitted.value.length > 0 ? (
            <text testId="ime-submitted" style={{ color: "#a6e3a1", fontSize: 13 }}>
              submitted: {submitted.value.join(" / ")}
            </text>
          ) : null}
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <ImeComposition />
      </div>
    )
  },
})

export { App, ImeComposition }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("ime-composition.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV IME Composition",
    width: 640,
    height: 560,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
