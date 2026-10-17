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
      const content = host.find("shape-popup")
      const panel = content.props.style as StyleDesc
      const surface = content.parent!.props.style as StyleDesc
      expect(surface.backgroundColor).toBe("#ffeea0")
      expect(surface.borderRadius).toBe(28)
      expect(panel.backgroundColor).toBeUndefined()
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
      const arrow = host.find(node => node.type === "div" && (node.props.style as StyleDesc | undefined)?.left === -14)
      const arrowStyle = arrow.props.style as StyleDesc
      expect(arrowStyle).toMatchObject({ top: 0, bottom: 0, alignItems: "center", pointerEvents: "none" })
      expect((arrow.children.find(node => node.type === "svg")!.props.style as StyleDesc).pointerEvents).toBe("none")
      await host.fire("shape-option-beach", "click")
      expect(change).toHaveBeenCalledExactlyOnceWith("beach")
      expect(host.all().some(node => node.props.testId === "shape-popup")).toBe(false)
    } finally {
      host.unmount()
    }
  })

  it("sizes the panel to the trigger and flips only when the panel does not fit", async () => {
    const open = async (y: number) => {
      const host = mountHost(defineComponent(() => () => h(Select, {
        testId: "auto",
        options: [{ key: "one", label: "One" }, { key: "two", label: "Two" }, { key: "three", label: "Three" }],
      })), { getElementBounds: () => ({ x: 40, y, width: 220, height: 40 }) })
      try {
        await host.fire("auto", "click")
        const panel = host.find("auto-popup")
        const layer = host.find(node => node.type === "anchored")
        return {
          minWidth: (panel.props.style as StyleDesc).minWidth,
          side: layer.props.side,
        }
      } finally {
        host.unmount()
      }
    }
    expect(await open(100)).toEqual({ minWidth: 220, side: "bottom" })
    expect(await open(700)).toEqual({ minWidth: 220, side: "top" })
  })
})
