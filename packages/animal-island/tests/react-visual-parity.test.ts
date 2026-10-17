import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { Background } from "../src/components/Background.js"
import { BackTop } from "../src/components/BackTop.js"
import { Button } from "../src/components/Button.js"
import { Card } from "../src/components/Card.js"
import { Collapse } from "../src/components/Collapse.js"
import { Divider } from "../src/components/Divider.js"
import { Drawer } from "../src/components/Drawer.js"
import { Image } from "../src/components/Image.js"
import { Loading } from "../src/components/Loading.js"
import { Modal } from "../src/components/Modal.js"
import { Notification, NotificationContainer } from "../src/components/Notification.js"
import { Tabs } from "../src/components/Tabs.js"
import { Tag } from "../src/components/Tag.js"
import { Tooltip } from "../src/components/Tooltip.js"
import type { TooltipPlacement } from "../src/components/Tooltip.js"
import { dashedBorderDataUrl } from "../src/components/border-decoration.js"
import { stampPaperDataUrl } from "../src/components/image-stamp-decoration.js"
import { organicSurfaceDataUrl } from "../src/components/organic-surface.js"
import { patternDataUrl } from "../src/patterns.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
const mount = (render: () => ReturnType<typeof h>) => {
  const app = mountHost(defineComponent({ setup: () => render }))
  hosts.push(app)
  return app
}
const decode = (src: string) => Buffer.from(src.split(",")[1], "base64").toString()
afterEach(() => { hosts.splice(0).forEach(app => app.unmount()); Notification.destroy(); vi.useRealTimers() })

describe("React visual component contracts", () => {
  it.each([
    ["top", "top", 4], ["top-start", "top", 4], ["top-end", "top", 4],
    ["bottom", "top", -4], ["bottom-start", "top", -4], ["bottom-end", "top", -4],
    ["left", "left", 4], ["left-start", "left", 4], ["left-end", "left", 4],
    ["right", "left", -4], ["right-start", "left", -4], ["right-end", "left", -4],
  ] as const)("animates the complete %s Tooltip surface from the original 4px offset", async (placement, axis, offset) => {
    const app = mount(() => h(Tooltip, { placement: placement as TooltipPlacement, trigger: "click", title: "动画提示", testId: "tip" }, { default: () => h("text", "打开") }))
    await app.fire("tip-trigger", "click")
    const surface = app.find(node => node.type === "anchored")
    expect(surface.props.motion).toEqual({ initial: { opacity: 0, [axis]: offset }, animate: { opacity: 1, [axis]: 0 }, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } })
    expect(surface.props.style).toMatchObject({ position: "relative" })
    expect(surface.props).toMatchObject({ deferred: true, occlude: true, gap: 6 })
    expect(app.find("tip-content").props.motion).toBeUndefined()
    expect(app.find("tip-content").props.role).toBe("tooltip")
  })

  it("replays Tooltip entrance after closing without adding an exit-retention timer", async () => {
    vi.useFakeTimers()
    const app = mount(() => h(Tooltip, { trigger: "click", variant: "island", title: "岛屿动画", testId: "tip" }, { default: () => h("text", "开关") }))
    await app.fire("tip-trigger", "click")
    const first = app.find(node => node.type === "anchored")
    await app.fire("tip-trigger", "click")
    expect(app.all().some(node => node.type === "anchored")).toBe(false)
    await app.fire("tip-trigger", "click")
    const reopened = app.find(node => node.type === "anchored")
    expect(reopened.id).not.toBe(first.id)
    expect(reopened.props.motion).toMatchObject({ initial: { opacity: 0, top: 4 } })
    expect(app.find("tip-content").props.style).toMatchObject({ borderWidth: 0 })
    app.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("adds white gray-dot wallpaper and preserves the separate Card dot palette", () => {
    const app = mount(() => h(Background, { type: "dots-gray", testId: "gray" }))
    expect(app.find("gray").props.style).toMatchObject({ backgroundColor: "#ffffff" })
    expect(decode(patternDataUrl("dots-gray", 400, 120))).toContain("rgba(140, 140, 140, 0.18)")
    const wallpaper = decode(patternDataUrl("dots-pink", 400, 120))
    expect(wallpaper).toContain("rgba(248, 166, 178, 0.26)")
    expect(wallpaper).toContain("rgba(255, 200, 210, 0.18)")
    expect(wallpaper).toContain('r="1.4"')
    const card = decode(patternDataUrl("card-dots-pink", 400, 120))
    expect(card).toContain("rgba(248, 166, 178, 0.18)")
    expect(card).toContain("rgba(255, 200, 210, 0.12)")
  })

  it("supports rich Tabs labels, text/array panels and native panel entrance motion", async () => {
    const changed = vi.fn()
    const app = mount(() => h(Tabs, { items: [
      { key: "one", label: h("text", { testId: "rich-label" }, "一号岛"), children: [h("text", "富文本"), "内容"] },
      { key: "two", label: "二号岛", children: "第二页" },
    ], onChange: changed }))
    expect(app.find("rich-label").children.map(node => node.text).join("")).toBe("一号岛")
    expect(app.text()).toContain("富文本 内容")
    const panel = app.find(node => node.props.role === "tabpanel")
    expect(panel.props.motion).toMatchObject({ initial: { opacity: 0, top: 4 }, animate: { opacity: 1, top: 0 } })
    await app.fire(app.find(node => node.props.role === "tab"), "keyDown", { key: "right" })
    expect(app.text()).toContain("第二页")
    expect(app.text()).not.toContain("富文本")
    expect(changed).toHaveBeenLastCalledWith("two")
  })

  it("opens focus Tooltips only from actual child focus and composes its callbacks", async () => {
    vi.useFakeTimers()
    const focused = vi.fn()
    const app = mount(() => h(Tooltip, { trigger: "focus", title: h("text", "聚焦提示"), testId: "tip" }, {
      default: () => h(Button, { testId: "child", onFocus: focused }, { default: () => h("text", "焦点") }),
    }))
    await app.fire("child", "mouseEnter")
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(false)
    await app.fire("child", "focus")
    expect(app.find("tip-content").props.role).toBe("tooltip")
    expect(app.text()).toContain("聚焦提示")
    expect(focused).toHaveBeenCalledOnce()
    await app.fire("child", "blur")
    await vi.advanceTimersByTimeAsync(99)
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await app.settle()
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(false)
  })

  it("toggles click Tooltips from actual Button mouse and keyboard without duplicate activation", async () => {
    const clicked = vi.fn()
    const app = mount(() => h(Tooltip, { trigger: "click", title: "点击提示", testId: "tip" }, {
      default: () => h(Button, { testId: "child", onClick: clicked }, { default: () => h("text", "点击") }),
    }))
    await app.fire("child", "click")
    expect(app.find("tip-content").props.role).toBe("tooltip")
    expect(clicked).toHaveBeenCalledOnce()
    await app.fire("child", "keyDown", { key: "enter" })
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(false)
    expect(clicked).toHaveBeenCalledTimes(2)
    await app.fire("child", "keyDown", { key: "space" })
    expect(app.find("tip-content").props.role).toBe("tooltip")
    await app.fire("child", "keyDown", { key: "escape" })
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(false)
  })

  it("retains 100ms hover dismissal and cancels it on bubble re-entry", async () => {
    vi.useFakeTimers()
    const app = mount(() => h(Tooltip, { title: "悬停提示", testId: "tip" }, { default: () => h("div", { testId: "child" }, h("text", "悬停")) }))
    await app.fire("child", "focus")
    expect(app.all().some(node => node.props.testId === "tip-content")).toBe(false)
    await app.fire("child", "mouseEnter")
    await app.fire("child", "mouseLeave")
    await vi.advanceTimersByTimeAsync(90)
    await app.fire("tip-content", "mouseEnter")
    await vi.advanceTimersByTimeAsync(20)
    await app.settle()
    expect(app.find("tip-content").props.role).toBe("tooltip")
    app.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("matches Card lift while dashed cards keep their position and use dashed strokes", async () => {
    const app = mount(() => h("div", null, [h(Card, { hoverable: true, testId: "card" }), h(Card, { type: "dashed", hoverable: true, testId: "dashed" })]))
    await app.fire("card", "mouseEnter")
    expect(app.find("card").props.motion).toMatchObject({ animate: { top: -2 } })
    expect((app.find("card").props.style as StyleDesc).hover?.boxShadow).toBeUndefined()
    await app.fire("dashed", "mouseEnter")
    expect((app.find("dashed").props.motion as { animate: { top?: number } }).animate.top).toBeUndefined()
    expect(app.find("dashed").props.motion).toMatchObject({ animate: { backgroundColor: "#faf8f2", borderColor: "transparent" }, transition: { duration: 0.3, ease: "ease" } })
    const outline = app.find(node => node.type === "svg" && node.parent?.parent?.props.testId === "dashed")
    const source = outline.props.src
    expect(decode(String(source))).toContain('stroke="#ffffff"')
    expect(outline.props.motion).toMatchObject({ animate: { color: "#d4c4a8" } })
    await app.fire("dashed", "mouseLeave")
    expect(outline.props.src).toBe(source)
    expect(outline.props.motion).toMatchObject({ animate: { color: "#e8dcc8" } })
    expect(app.find("dashed").props.style).toMatchObject({ borderWidth: 2, borderColor: "transparent" })
    expect(decode(dashedBorderDataUrl(240, 100, "#d4c4a8", 2, 20))).toContain('stroke-dasharray="6 6"')
  })

  it("restores clickable Tag lift and keeps its close callback isolated", async () => {
    const clicked = vi.fn(), closed = vi.fn()
    const app = mount(() => h(Tag, { variant: "dashed", testId: "tag", closable: true, onClick: clicked, onClose: closed }, { default: () => h("text", "标签") }))
    await app.fire("tag", "mouseEnter")
    expect(app.find("tag").props.motion).toMatchObject({ animate: { top: -1 } })
    await app.fire(app.find(node => node.props["aria-label"] === "close"), "keyDown", { key: "enter" })
    expect(closed).toHaveBeenCalledOnce()
    expect(clicked).not.toHaveBeenCalled()
  })

  it("renders rich Collapse questions/answers and repeats a custom Divider icon node", () => {
    const app = mount(() => h("div", null, [
      h(Collapse, { question: h("text", "富标题"), answer: [h("text", "富答案"), "文字"], defaultExpanded: true }),
      h(Divider, { icon: h("text", { testId: "custom-icon" }, "✿"), iconSize: 20 }),
    ]))
    expect(app.text()).toContain("富标题")
    expect(app.text()).toContain("富答案 文字")
    expect(app.find("custom-icon").children.map(node => node.text).join("")).toBe("✿")
  })

  it("extends repeating Divider artwork beyond a single 3200px tile", async () => {
    vi.useFakeTimers()
    const app = mountHost(defineComponent({ setup: () => () => h(Divider, { type: "wave-yellow" }) }), { getElementBounds: () => ({ x: 0, y: 0, width: 6401, height: 14 }) })
    hosts.push(app)
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    expect(app.all().filter(node => node.type === "img")).toHaveLength(3)
  })

  it("accepts rich Modal/Drawer titles, list footers and an explicit numeric modal footer", async () => {
    const app = mount(() => h("div", null, [
      h(Modal, { open: true, variant: "game", typewriter: false, title: h("text", "富弹窗"), footer: 0 }),
      h(Drawer, { open: true, title: h("text", "富抽屉"), footer: [h("text", "底栏"), "内容"] }),
    ]))
    await app.settle()
    expect(app.text()).toContain("富弹窗")
    expect(app.text()).toContain("富抽屉")
    expect(app.text()).toContain("底栏 内容")
    expect(app.text()).toContain("0")
    expect(app.text()).not.toContain("确定")
    expect(app.all().filter(node => node.props.role === "dialog").map(node => node.props["aria-label"]))
      .toEqual(["富弹窗", "富抽屉"])
    expect(app.all().filter(node => node.props.role === "dialog").some(node => (node.props.style as StyleDesc).backgroundColor === "transparent")).toBe(true)
    const outline = decode(organicSurfaceDataUrl(520, 300, "#f7f3df"))
    expect(outline).toContain('fill="#f7f3df"')
    expect(outline).toContain("C366.08,3,413.92,5.1,429,8.1")
  })

  it("draws stamp perforations at fixed 5px radius / 16px pitch at different aspect ratios", async () => {
    for (const [width, height] of [[240, 176], [320, 100]]) {
      const svg = decode(stampPaperDataUrl(width, height))
      expect(svg).toContain(`width="${width}" height="${height}"`)
      expect(svg).toContain('r="5"')
      expect(svg).toContain('mask="url(#paper)"')
      expect(svg).toContain(`cx="${width}"`)
      expect(svg).toContain(`cy="${height}"`)
      expect(svg).not.toContain("scale(")
    }
    const app = mount(() => h(Image, { src: "image.svg", variant: "stamp", stampYear: "2026", testId: "stamp", preview: false, width: 240, height: 176 }))
    expect(app.find("stamp").props.style).toMatchObject({ padding: 14, backgroundColor: "transparent" })
    expect(app.text()).toContain("2026")
  })

  it("supports node lists for notification text and restores clickable hover lift", async () => {
    const app = mount(() => h(NotificationContainer))
    Notification.open({ key: "rich", message: [h("text", "通知"), "标题"], description: ["描述", h("text", "内容")], icon: "★", duration: 0, onClick: () => {} })
    await app.settle()
    expect(app.text()).toContain("通知 标题")
    expect(app.text()).toContain("描述 内容")
    const card = app.find(node => node.props.role === "button" && node.props["aria-label"] !== "close")
    await app.fire(card, "mouseEnter")
    expect(app.find(node => node.props.role === "button" && node.props["aria-label"] !== "close").props.motion).toMatchObject({ animate: { top: -1 } })
  })

  it("uses React's Rocket BackTop artwork, placement, hover scale and press offset", async () => {
    vi.useFakeTimers()
    const app = mountHost(defineComponent({ setup: () => () => h(BackTop, { target: () => 42, testId: "back" }) }), { getScrollOffset: () => [0, -500] })
    hosts.push(app)
    await vi.advanceTimersByTimeAsync(120)
    await app.settle()
    expect(app.find("back").parent?.props.style).toMatchObject({ width: 64, height: 64, bottom: 32, right: 24 })
    const art = decode(String(app.find("back-icon").props.src))
    expect(art).toContain('M24 6 C 16 6 14 18 14 26')
    expect(art).toContain("feDropShadow")
    expect(art).not.toContain("#FFF7DE")
    await app.fire("back", "mouseEnter")
    expect((app.find("back-icon").props.motion as { animate: { width: number } }).animate.width).toBeCloseTo(190.08)
    await app.fire("back", "mouseDown", { button: 0 })
    const pressed = (app.find("back-icon").props.motion as { animate: { width: number; top: number } }).animate
    expect(pressed.width).toBeCloseTo(168.96)
    expect(pressed.top).toBeCloseTo(-46.64)
  })

  it("restores Loading's elliptical vignette and accepts rich tip lists", () => {
    const app = mount(() => h(Loading, { tip: [h("text", "稍等"), "一下"] }))
    const vignette = decode(String(app.find(node => node.type === "img").props.src))
    expect(vignette).toContain('r="70.710678%"')
    expect(vignette).toContain('offset="55%"')
    expect(vignette).toContain('stop-opacity="0.6"')
    expect(app.text()).toContain("稍等 一下")
  })
})
