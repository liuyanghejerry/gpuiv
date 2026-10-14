import { defineComponent, h } from "vue"
import { describe, expect, it, vi } from "vitest"
import type { StyleDesc } from "@gpuiv/vue"
import { Select } from "../src/components/Select.js"
import { mountHost } from "./harness.js"

describe("Select popup silhouette", () => {
  it("keeps the yellow fill on the rounded panel and leaves interactive rows transparent", async () => {
    const change = vi.fn()
    const host = mountHost(defineComponent(() => () => h(Select, {
      testId: "shape", defaultValue: "island", onChange: change,
      options: [{ key: "island", label: "小岛" }, { key: "forest", label: "森林" }, { key: "beach", label: "海滩" }],
    })))
    try {
      await host.fire("shape", "click")
      const panel = host.find("shape-popup").props.style as StyleDesc
      expect(panel.backgroundColor).toBe("#ffeea0")
      expect(panel.borderRadius).toBe(28)
      expect(panel.paddingTop).toBe(12)
      expect(panel.paddingBottom).toBe(12)
      expect(panel.overflow).toBeUndefined()
      function expectTransparentRows() {
        for (const key of ["island", "forest", "beach"]) {
          const row = host.find(`shape-option-${key}`)
          const style = row.props.style as StyleDesc
          expect(style.backgroundColor).toBeUndefined()
          expect(style.hover?.backgroundColor).toBeUndefined()
          expect(style.active?.backgroundColor).toBeUndefined()
          expect(style.overflow).toBeUndefined()
          expect(style.cursor).toBe("pointer")
          expect(row.props.onClick).toBeTypeOf("function")
          expect(row.props.onMouseEnter).toBeTypeOf("function")
        }
      }
      expectTransparentRows()
      expect((host.find("shape-option-island").props.style as StyleDesc).fontWeight).toBe(700)
      await host.fire("shape-option-forest", "mouseEnter")
      expectTransparentRows()
      expect((host.find("shape-option-forest").props.style as StyleDesc).fontWeight).toBe(700)
      const arrow = host.find(node => node.type === "svg" && (node.props.style as StyleDesc | undefined)?.left === -14)
      expect((arrow.props.style as StyleDesc).pointerEvents).toBe("none")
      await host.fire("shape-option-beach", "click")
      expect(change).toHaveBeenCalledExactlyOnceWith("beach")
      expect(host.all().some(node => node.props.testId === "shape-popup")).toBe(false)
    } finally {
      host.unmount()
    }
  })
})
