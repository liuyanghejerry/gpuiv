import { defineComponent, ref } from "vue"
import { AnsiLog, AnsiText, createApp } from "@gpuiv/vue"

export const AnsiLogExample = defineComponent({
  setup() {
    let line = 200
    const source = ref(Array.from({ length: line }, (_, i) => `\x1b[90m[${String(i).padStart(3, "0")}]\x1b[0m \x1b[32mready\x1b[0m worker ${i % 4}`).join("\n"))
    const append = () => { source.value += `\n\x1b[33m[${line++}]\x1b[0m New output: \x1b[38;2;94;165;255m你好\x1b[0m` }
    return () => <div style={{ width: "100%", height: "100%", padding: 24, gap: 16, display: "flex", flexDirection: "column", backgroundColor: "#111827", color: "#e5e7eb" }}>
      <text style={{ fontSize: 24, fontWeight: 700 }}>Build output</text>
      <AnsiText source={"\x1b[32m● Connected\x1b[0m  Select and copy any output"} />
      <div testId="append" role="button" tabIndex={0} aria-label="Append output" onClick={append}
        onKeyDown={(e: { key?: string; isHeld?: boolean }) => { if (!e.isHeld && (e.key === "enter" || e.key === "space")) append() }}
        style={{ padding: 12, backgroundColor: "#2563eb", cursor: "pointer", alignSelf: "flex-start" }}><text>Append output</text></div>
      <AnsiLog testId="log" source={source.value} style={{ height: 320 }} />
    </div>
  },
})

if (import.meta.main) createApp(AnsiLogExample, { width: 720, height: 520, focus: process.env.GPUIX_BACKGROUND !== "1" })
