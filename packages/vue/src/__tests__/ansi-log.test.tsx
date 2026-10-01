import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { AnsiLog, AnsiText } from "../components/ansi-log.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { VirtualListInstance } from "../components/virtual-list.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("ANSI output", () => {
  it("copies across coloured log rows on its painted surface", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <AnsiLog
      source={"\x1b[32mgreen\x1b[0m\n\x1b[31mred\x1b[0m"} followTail={false} style={{ height: 100 }} /> }))
    try {
      await app.settle()
      expect(app.renderer.dragSelect(0, 10, 200, 30)).toBe("green\nred")
    } finally { app.unmount() }
  })

  it("paints selectable styled text without copying its escape sequences", async () => {
    const app = createTestApp(defineComponent({ setup: () => () => <div style={{ padding: 20 }}>
      <AnsiText source={"\x1b[1;31mError\x1b[0m: 你好"} style={{ fontSize: 16 }} />
    </div> }))
    try {
      await app.settle()
      expect(app.renderer.getPaintedText()).toContain("Error: 你好")
      expect(app.renderer.dragSelect(20, 28, 400, 28)).toBe("Error: 你好")
    } finally { app.unmount() }
  })

  it("decodes appended escape fragments and resets replaced sources", async () => {
    const source = ref("first\n\x1b[3")
    const app = createTestApp(defineComponent({ setup: () => () => <AnsiLog source={source.value} followTail={false} style={{ height: 100 }} /> }))
    try {
      source.value += "1mred\x1b[0m\nlast"
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).toEqual(["first", "red", "last"])
      source.value = "replacement"
      await app.settle()
      expect(app.renderer.getPaintedText()).toEqual(["replacement"])
    } finally { app.unmount() }
  })

  it("mounts a bounded row window and can scroll to distant output", async () => {
    const list = ref<VirtualListInstance | null>(null)
    const source = Array.from({ length: 2000 }, (_, index) => `\x1b[32mrow ${index}\x1b[0m`).join("\n")
    const app = createTestApp(defineComponent({ setup: () => () => <AnsiLog ref={list} source={source} followTail={false} style={{ height: 120 }} /> }))
    try {
      await app.settle()
      expect(app.renderer.getPaintedText()).toContain("row 0")
      expect(app.renderer.findByType("text").length).toBeLessThan(200)
      list.value!.scrollToItem(1900)
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("row 1900")
      expect(list.value!.getListScrollTop()!.itemIndex).toBeGreaterThan(1800)
    } finally { app.unmount() }
  })

  it("follows appended output at the tail and preserves a scrolled reading position", async () => {
    const list = ref<VirtualListInstance | null>(null)
    const source = ref(Array.from({ length: 200 }, (_, i) => `row ${i}`).join("\n"))
    const app = createTestApp(defineComponent({ setup: () => () => <AnsiLog ref={list} source={source.value} style={{ height: 120 }} /> }))
    try {
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("row 199")
      source.value += "\nnew tail"
      await app.settle(); await app.settle()
      expect(app.renderer.getPaintedText()).toContain("new tail")
      list.value!.scrollToItem(40)
      await app.settle(); await app.settle()
      const anchor = list.value!.getListScrollTop()!.itemIndex
      source.value += "\nnext tail"
      await app.settle(); await app.settle()
      expect(list.value!.getListScrollTop()!.itemIndex).toBe(anchor)
      expect(app.renderer.getPaintedText()).toContain("row 40")
      expect(app.renderer.getPaintedText()).not.toContain("next tail")
    } finally { app.unmount() }
  })
})
