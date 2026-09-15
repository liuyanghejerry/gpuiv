/**
 * Markdown images demo — standalone `![alt](url)` paragraphs render as image
 * blocks inside `<markdown>`; images among text stay link-styled alt runs.
 *
 * The data URL is produced by `GpuixCanvas.toDataURL()` at startup, so the
 * demo also exercises the PNG export path. A deliberately broken URL shows
 * the alt-text fallback card.
 */

import { defineComponent, onMounted, ref } from "vue"
import { GpuixCanvas, createApp, type GpuixCanvasInstance } from "@gpuiv/vue"

const PATTERN_NOTE = "The pattern below is a canvas snapshot shipped through toDataURL()."

const MarkdownImages = defineComponent({
  setup() {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const source = ref(`# Markdown images

A paragraph holding nothing but images becomes image blocks:

![gradient pattern](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)

Two in a row work the same way — one block each:

![left](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==) ![right](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP2XsYnwwAACxgBAKDn6J0AAAAASUVORK5CYII=)

An image among text stays text — its alt renders as a link: see ![the icon](icon-32.png) inline.

An unloadable image falls back to its alt text:

![this source does not decode](data:image/png;base64,not-base64)

Done.`)

    onMounted(() => {
      const ctx = canvas.value?.getContext("2d")
      if (!ctx) return
      const gradient = ctx.createLinearGradient(0, 0, 0, 120)
      gradient.addColorStop(0, "#cba6f7")
      gradient.addColorStop(1, "#94e2d5")
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 240, 120)
      ctx.fillStyle = "#f38ba8"
      ctx.beginPath()
      ctx.arc(120, 60, 32, 0, Math.PI * 2)
      ctx.fill()
      const url = canvas.value?.toDataURL("image/png")
      if (typeof url === "string") {
        // Swap the 1px placeholder for the real canvas snapshot.
        source.value = source.value.replace(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          url
        )
      }
    })

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 24,
          padding: 32,
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: 640,
            backgroundColor: "#1e1e2e",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <markdown source={source.value} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 260 }}>
          <text style={{ color: "#cdd6f4", fontSize: 15, fontWeight: "bold" }}>How it works</text>
          <text style={{ color: "#a6adc8", fontSize: 13 }}>
            Standalone image paragraphs paint as image blocks reusing the img
            pipeline; mixed-in images keep their alt as link text.
          </text>
          <text style={{ color: "#a6adc8", fontSize: 13 }}>{PATTERN_NOTE}</text>
          <GpuixCanvas ref={canvas} width={240} height={120} style={{ width: 240, height: 120, borderRadius: 8 }} />
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <MarkdownImages />
      </div>
    )
  },
})

export { App, MarkdownImages }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("markdown-images.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Markdown Images",
    width: 1020,
    height: 720,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
