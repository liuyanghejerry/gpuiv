/// Headless logic tests for the floating helpers: FloatingLayer anchoring
/// props and surface/content style split, the pure style utilities, the
/// cloneAsChild asChild contract, and useControllableState's controlled and
/// uncontrolled branches. Runs against the mock renderer (see headless.ts)
/// so it works on Linux.

import { defineComponent, h, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import {
  FloatingLayer,
  cloneAsChild,
  floatingRootStyle,
  mergeStyles,
  resolveStyle,
  useControllableState,
} from "../components/floating.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"
import type { MotionProps, StyleDesc } from "../types.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

function customProp(
  renderer: HeadlessRenderer,
  id: number,
  key: string
): unknown {
  const ops = renderer.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
  return ops.length ? ops[ops.length - 1]![3] : undefined
}

function mountLayer(
  props: Record<string, unknown> = {},
  style?: StyleDesc,
  motion?: MotionProps
): { app: HeadlessApp; renderer: HeadlessRenderer; anchored: number; content: number } {
  const app = mountHeadless(
    defineComponent({
      setup: () => () =>
        h(
          FloatingLayer,
          {
            ...props,
            style,
            ...(motion === undefined ? {} : { motion }),
            role: "dialog",
            testId: "content",
          },
          { default: () => h("text", "Surface") }
        ),
    })
  )
  const anchoredOp = app.renderer.opsOf("createElement").find((op) => op[2] === "anchored")
  if (!anchoredOp) throw new Error("no anchored element")
  const anchored = anchoredOp[1] as number
  const content = app.renderer.childrenOf(anchored)[0]!
  return { app, renderer: app.renderer, anchored, content }
}

describe("FloatingLayer (headless)", () => {
  it("anchors with default positioning props and an occluding surface", () => {
    const { renderer, anchored, content } = mountLayer()
    expect(customProp(renderer, anchored, "side")).toBe("bottom")
    expect(customProp(renderer, anchored, "align")).toBe("start")
    expect(customProp(renderer, anchored, "gap")).toBe(0)
    expect(customProp(renderer, anchored, "offset")).toEqual({ x: 0, y: 0 })
    expect(customProp(renderer, anchored, "fit")).toBe("snap")
    expect(customProp(renderer, anchored, "snapMargin")).toBe(8)
    expect(customProp(renderer, anchored, "deferred")).toBe(true)
    expect(customProp(renderer, anchored, "priority")).toBe(1)
    expect(customProp(renderer, anchored, "occlude")).toBe(true)
    // Content owns focus chrome; the anchored root carries the default fill.
    expect(customProp(renderer, content, "role")).toBe("dialog")
    expect(customProp(renderer, content, "testId")).toBe("content")
    expect(customProp(renderer, anchored, "role")).toBeUndefined()
    expect(renderer.lastStyle(anchored)).toMatchObject({ backgroundColor: "#1A1A1A" })
  })

  it.each([
    ["top", { x: 5, y: 0 }],
    ["bottom", { x: 5, y: 0 }],
    ["left", { x: 0, y: 7 }],
    ["right", { x: 0, y: 7 }],
  ] as const)("maps side %s with alignOffset onto the right axis", (side, offset) => {
    const { renderer, anchored } = mountLayer({ side, alignOffset: side === "top" || side === "bottom" ? 5 : 7 })
    expect(customProp(renderer, anchored, "side")).toBe(side)
    expect(customProp(renderer, anchored, "offset")).toEqual(offset)
  })

  it("forwards sideOffset as gap and collisionPadding as snapMargin", () => {
    const { renderer, anchored } = mountLayer({ sideOffset: 12, collisionPadding: 24 })
    expect(customProp(renderer, anchored, "gap")).toBe(12)
    expect(customProp(renderer, anchored, "snapMargin")).toBe(24)
  })

  it("keeps a hidden layer click-through via occlude: false", () => {
    const { renderer, anchored, content } = mountLayer(
      {},
      { pointerEvents: "none", visibility: "hidden" }
    )
    expect(customProp(renderer, anchored, "occlude")).toBe(false)
    expect(renderer.lastStyle(anchored)).toMatchObject({ visibility: "hidden" })
    // pointerEvents is layout/hit-testing, not surface paint: it stays on content.
    expect(renderer.lastStyle(content)).toMatchObject({ pointerEvents: "none" })
  })

  it("passes the motion track to the anchored surface and relativizes it", () => {
    const motion: MotionProps = {
      initial: { top: 4, opacity: 0 },
      animate: { top: 0, opacity: 1 },
      transition: { duration: 0.25 },
    }
    const { renderer, anchored, content } = mountLayer(
      {},
      { backgroundColor: "transparent", borderRadius: 16 },
      motion
    )
    expect(customProp(renderer, anchored, "motion")).toEqual(motion)
    expect(renderer.lastStyle(anchored)).toMatchObject({ position: "relative", borderRadius: 16 })
    expect(customProp(renderer, content, "motion")).toBeUndefined()
  })

  it("omits the motion prop and the relative position without a track", () => {
    const { renderer, anchored } = mountLayer()
    expect(customProp(renderer, anchored, "motion")).toBeUndefined()
    expect(renderer.lastStyle(anchored)!.position).toBeUndefined()
  })

  it("keeps every corner-radius flavour and state paint on the surface", () => {
    const { renderer, anchored, content } = mountLayer(
      {},
      {
        borderRadius: 16,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 8,
        borderBottomRightRadius: 12,
        borderBottomLeftRadius: 20,
        boxShadow: { offsetX: 0, offsetY: 3, blurRadius: 10, spreadRadius: 0, color: "#000" },
        hover: { borderTopLeftRadius: 24, opacity: 0.75 },
        active: { borderBottomRightRadius: 28, backgroundColor: "#222222" },
      }
    )
    const surface = renderer.lastStyle(anchored)!
    expect(surface).toMatchObject({
      borderRadius: 16,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 8,
      borderBottomRightRadius: 12,
      borderBottomLeftRadius: 20,
      hover: { borderTopLeftRadius: 24, opacity: 0.75 },
      active: { borderBottomRightRadius: 28, backgroundColor: "#222222" },
    })
    // The content keeps layout-only style: radii repeat (idempotent) but no
    // fill, shadow, or opacity paint.
    const contentStyle = renderer.lastStyle(content)!
    expect(contentStyle.borderRadius).toBe(16)
    expect(contentStyle.boxShadow).toBeUndefined()
    expect(contentStyle.opacity).toBeUndefined()
    expect(contentStyle.hover).toMatchObject({ borderTopLeftRadius: 24 })
    expect(contentStyle.hover!.opacity).toBeUndefined()
    expect(contentStyle.active).toMatchObject({ borderBottomRightRadius: 28 })
    expect(contentStyle.active!.backgroundColor).toBeUndefined()
  })

  it("drops an all-paint style from the content instead of leaving empties", () => {
    const { renderer, content } = mountLayer(
      {},
      { backgroundColor: "#f7f3df", opacity: 0.9, hover: { opacity: 1 }, active: { opacity: 0.5 } }
    )
    const contentStyle = renderer.lastStyle(content)!
    // Paint is stripped; the empty hover/active shells survive normalization.
    expect(contentStyle).toEqual({ hover: {}, active: {} })
  })

  it("keeps a gradient fill free of the default background color", () => {
    const background = {
      type: "linear-gradient",
      angle: 90,
      stops: [
        { color: "#112233", position: 0 },
        { color: "#445566", position: 1 },
      ],
    } as NonNullable<StyleDesc["background"]>
    const { renderer, anchored, content } = mountLayer({}, { background })
    expect(renderer.lastStyle(anchored)!.background).toEqual(background)
    expect(renderer.lastStyle(anchored)!.backgroundColor).toBeUndefined()
    expect(renderer.lastStyle(content)!.background).toBeUndefined()
  })

  it("treats a layout-only style as no surface paint and defaults the fill", () => {
    const { renderer, anchored, content } = mountLayer({}, { width: 120 })
    expect(renderer.lastStyle(anchored)).toEqual({ backgroundColor: "#1A1A1A" })
    expect(renderer.lastStyle(content)).toMatchObject({ width: 120 })
  })
})

describe("cloneAsChild", () => {
  it("merges the item props onto exactly one element child", () => {
    const child = h("div", { testId: "row" })
    const cloned = cloneAsChild("Owner", child, { testId: "item", tabIndex: 0 })
    expect(cloned.type).toBe("div")
    expect(cloned.props).toMatchObject({ testId: "item", tabIndex: 0 })
  })

  it("filters text and comment children before counting", () => {
    const cloned = cloneAsChild("Owner", [h("div"), "stray text"], { role: "button" })
    expect(cloned.type).toBe("div")
    expect(cloned.props).toMatchObject({ role: "button" })
  })

  it.each([
    ["no children", undefined],
    ["only text", "just text"],
    ["two elements", [h("div"), h("div")]],
    ["two strings", ["one", "two"]],
  ])("throws for %s", (_label, children) => {
    expect(() => cloneAsChild("Owner", children, {})).toThrow(
      /Owner asChild requires exactly one child element/
    )
  })
})

describe("useControllableState", () => {
  it("runs uncontrolled from the default and only reports real changes", () => {
    const onChange = vi.fn()
    const [value, setValue] = useControllableState({ value: undefined, defaultValue: 5, onChange })
    expect(value.value).toBe(5)

    setValue(5)
    expect(onChange).not.toHaveBeenCalled()
    expect(value.value).toBe(5)

    setValue(6)
    expect(onChange).toHaveBeenCalledWith(6)
    expect(value.value).toBe(6)
  })

  it("keeps the controlled prop authoritative while still reporting", () => {
    const onChange = vi.fn()
    const external = ref<number | undefined>(1)
    const [value, setValue] = useControllableState({
      get value() {
        return external.value
      },
      defaultValue: 0,
      onChange,
    })
    expect(value.value).toBe(1)

    setValue(2)
    expect(onChange).toHaveBeenCalledWith(2)
    // The parent never followed: the controlled value still reads through.
    expect(value.value).toBe(1)

    external.value = 3
    expect(value.value).toBe(3)
  })
})

describe("style utilities", () => {
  it("resolveStyle picks the function, object, and empty forms", () => {
    expect(resolveStyle({ width: 10 }, { open: true })).toEqual({ width: 10 })
    expect(resolveStyle((state: { open: boolean }) => ({ height: state.open ? 1 : 0 }), { open: true })).toEqual(
      { height: 1 }
    )
    expect(resolveStyle(undefined, { open: false })).toBeUndefined()
  })

  it("mergeStyles falls through missing sides and merges both", () => {
    const base = { width: 10, color: "#fff" }
    const override = { width: 20 }
    expect(mergeStyles(undefined, override)).toBe(override)
    expect(mergeStyles(base, undefined)).toBe(base)
    expect(mergeStyles(base, override)).toEqual({ width: 20, color: "#fff" })
  })

  it("floatingRootStyle layers a relative column under overrides", () => {
    expect(floatingRootStyle()).toEqual({
      display: "flex",
      position: "relative",
      alignItems: "start",
    })
    expect(floatingRootStyle({ display: "block", top: 4 })).toEqual({
      display: "block",
      position: "relative",
      alignItems: "start",
      top: 4,
    })
  })
})
