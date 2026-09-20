/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work.
 * ───────────────────────────────────────────────────────── */
import { defineComponent, h, ref, onMounted, onBeforeUnmount, computed, type PropType } from "vue"
import { Shimmer } from "../atoms/Shimmer.js"

const chevron = Array.from({ length: 9 }, (_, i) => { const r = Math.floor(i / 3), c = i % 3; return (c + Math.abs(r - 1)) * 90 })
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const orbit = Array.from({ length: 9 }, (_, i) => { const k = ORBIT_ORDER.indexOf(i); return k === -1 ? null : k * 110 })
export interface LoadingPattern { delays: (number | null)[]; dur: number; round: boolean }
const PATTERNS: Record<string, LoadingPattern> = {
  Drive: { delays: chevron, dur: 650, round: false }, Dots: { delays: chevron, dur: 650, round: true }, Orbit: { delays: orbit, dur: 950, round: false },
}

function LoaderGrid({ delays, dur, round }: { delays: (number | null)[]; dur: number; round: boolean }) {
  return h("span", { "aria-hidden": true, style: { display: "inline-grid", gridTemplateColumns: "repeat(3,4px)", gap: 1.5, flexShrink: 0 } }, [
    ...delays.map((delay, index) => h("span", { key: index, style: { width: 4, height: 4, borderRadius: round ? "50%" : "1px", backgroundColor: "var(--ink)", opacity: delay === null ? 0.07 : 0.15, animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite` } as Record<string, unknown> }))
  ])
}

export default defineComponent({
  name: "LoadingState",
  props: { label: { type: String, default: undefined }, variant: { type: String, default: "Drive" }, videoSrc: { type: String, default: undefined } },
  setup(props) {
    const ds = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined
    onMounted(() => { timer = setInterval(() => { ds.value = ds.value + 1 }, 100) })
    onBeforeUnmount(() => clearInterval(timer))
    const total = computed(() => ds.value / 10)
    const surfer = props.variant === "Surfer"
    const resolvedLabel = props.label ?? (surfer ? "Subway surfing" : "Churning")
    const p = PATTERNS[props.variant] ?? PATTERNS.Drive
    const elapsed = computed(() => total.value < 60 ? `${total.value.toFixed(1)}s` : `${Math.floor(total.value / 60)}m ${(total.value % 60).toFixed(1)}s`)
    return () =>
      surfer ? h("div", { role: "status", style: { display: "flex", width: "fit-content", flexDirection: "column", alignItems: "flex-start" } }, [
        h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, [LoaderGrid(PATTERNS.Drive), h(Shimmer, {}, [resolvedLabel]), h("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" } }, [elapsed.value])]),
        h("div", { style: { marginTop: 8, width: 224, overflow: "hidden", borderRadius: 10, boxShadow: "0 0 0 1px var(--line), 0 8px 28px rgba(0,0,0,0.15)", animation: "pop-in 200ms cubic-bezier(0.16,1,0.3,1) both", transformOrigin: "top left" } }, [
          h("div", { style: { position: "relative", aspectRatio: "16/9", width: "100%", backgroundColor: "var(--tooltip-bg)" } }, [
            h("div", { style: { width: "100%", height: "100%", backgroundColor: "var(--inset)" } }),
            h("div", { style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 12 } }, [LoaderGrid(PATTERNS.Drive), h("span", { style: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--tooltip-muted)" } }, "Video unavailable")]),
          ]),
        ]),
      ]) : h("div", { role: "status", style: { display: "flex", width: "fit-content", alignItems: "center", gap: 10 } }, [
        LoaderGrid(p), h(Shimmer, {}, [resolvedLabel]), h("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" } }, [elapsed.value]),
      ])
  },
})
