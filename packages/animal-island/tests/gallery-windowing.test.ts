/** The comparison gallery mounts one family while preserving external models. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HostNode } from "@gpuiv/vue"
import { App } from "../../../examples/animal-island.js"
import { mountHost } from "./harness.js"

const pageIds = [
  "button", "card", "tag", "title", "divider", "icon", "input", "select", "switch", "checkbox", "radio", "rate",
  "date-picker", "time-picker", "form", "upload", "avatar", "badge", "table", "tabs", "carousel", "image", "progress",
  "code-block", "collapse", "tooltip", "modal", "drawer", "notification", "loading", "skeleton", "pagination", "back-top",
  "typewriter", "countdown", "count-up", "time", "background", "cursor", "footer",
]
let app: ReturnType<typeof mountHost> | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => { app?.unmount(); app = undefined; vi.useRealTimers() })
const content = (node: HostNode): string => (node.text ?? "") + node.children.map(content).join("")
const descendants = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(descendants)]
const exists = (testId: string) => app!.all().some(node => node.props.testId === testId)
function mount(overrides: Parameters<typeof mountHost>[1] = {}) { app = mountHost(App, overrides); return app }

describe("Animal Island comparison gallery", () => {
  it("starts on Button with a cream sidebar and a large white example card", () => {
    const host = mount()
    expect(host.find("gallery-showcase").props).toMatchObject({ "aria-label": "Button 按钮展示" })
    expect(host.find("gallery-showcase").props.style).toMatchObject({ backgroundColor: "#ffffff", minHeight: 520, padding: 24, borderRadius: 12 })
    expect(host.find("gallery-sidebar").props.style).toMatchObject({ width: 220 })
    expect(content(host.find("gallery-page-title"))).toBe("Button 按钮")
    expect(exists("btn-default")).toBe(true)
    expect(exists("animal-table")).toBe(false)
    expect(exists("password-input")).toBe(false)
  })

  it("navigates all 40 component families and marks exactly one active entry", async () => {
    const host = mount()
    const entries = host.all().filter(node => String(node.props.testId).startsWith("nav-"))
    expect(entries.map(node => String(node.props.testId).slice(4)).sort()).toEqual([...pageIds].sort())
    for (const id of pageIds) {
      await host.fire(`nav-${id}`, "click")
      expect(host.find("gallery-showcase").props["aria-label"]).toBe(`${content(host.find(`nav-${id}`))}展示`)
      const active = host.all().filter(node => String(node.props.testId).startsWith("nav-") && node.props["aria-pressed"] === true)
      expect(active.map(node => node.props.testId)).toEqual([`nav-${id}`])
      expect(content(host.find("gallery-page-title"))).toBe(content(host.find(`nav-${id}`)))
    }
  })

  it("activates navigation using native Enter and Space keys", async () => {
    const host = mount()
    expect(host.find("nav-select").props).toMatchObject({ role: "button", tabIndex: 0 })
    await host.fire("nav-select", "keyDown", { key: "enter" })
    expect(host.find("gallery-showcase").props["aria-label"]).toBe("Select 选择器展示")
    await host.fire("nav-input", "keyDown", { key: "space" })
    expect(host.find("gallery-showcase").props["aria-label"]).toBe("Input 输入框展示")
    await host.fire("nav-card", "keyDown", { key: "arrowdown" })
    expect(host.find("gallery-showcase").props["aria-label"]).toBe("Input 输入框展示")
  })

  it("unmounts the inactive page instead of placing the entire gallery offscreen", async () => {
    const host = mount()
    await host.fire("nav-table", "click")
    expect(exists("animal-table")).toBe(true)
    expect(exists("btn-default")).toBe(false)
    await host.fire("nav-icon", "click")
    expect(exists("animal-table")).toBe(false)
    expect(descendants(host.find("gallery-showcase")).filter(node => node.type === "img")).toHaveLength(104)
    await host.fire("nav-button", "click")
    expect(exists("btn-default")).toBe(true)
    expect(content(host.find("gallery-showcase"))).not.toContain("Airplane")
  })

  it("retains the controlled Input model after leaving and revisiting its page", async () => {
    const host = mount()
    await host.fire("nav-input", "click")
    const input = host.find(node => node.type === "input" && node.props.placeholder === "说点什么…")
    await host.fire(input, "change", { value: "小岛🌴 revisited" })
    await host.fire("nav-button", "click")
    await host.fire("nav-input", "click")
    expect(host.find(node => node.type === "input" && node.props.placeholder === "说点什么…").props.value).toBe("小岛🌴 revisited")
  })

  it("retains the Form store and submitted result when its page remounts", async () => {
    const host = mount()
    await host.fire("nav-form", "click")
    const input = descendants(host.find("form-name")).find(node => node.type === "input")!
    await host.fire(input, "change", { value: "水獭访客" })
    await host.fire("form-submit", "click")
    await host.settle()
    await host.fire("nav-button", "click")
    await host.fire("nav-form", "click")
    const returned = descendants(host.find("form-name")).find(node => node.type === "input")!
    expect(returned.props.value).toBe("水獭访客")
    expect(content(host.find("gallery-showcase"))).toContain("欢迎，水獭访客")
  })

  it("resets only the right content scroller when the selected family changes", async () => {
    const scrollTo = vi.fn()
    const host = mount({ scrollTo })
    scrollTo.mockClear()
    await host.fire("nav-back-top", "click")
    const rightId = host.find("gallery-scroll").id
    expect(scrollTo).toHaveBeenLastCalledWith(rightId, 0, 0)
    await host.fire("nav-icon", "click")
    expect(scrollTo).toHaveBeenLastCalledWith(rightId, 0, 0)
    expect(scrollTo.mock.calls.every(([id]) => id === rightId)).toBe(true)
    const owners = host.all().filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === "scroll")
    expect(owners.map(node => node.props.testId).sort()).toEqual(["gallery-nav-scroll", "gallery-scroll"])
    for (const owner of owners) expect(descendants(owner).slice(1).filter(node => (node.props.style as { overflow?: string } | undefined)?.overflow === "scroll")).toHaveLength(0)
  })

  it("cleans up timers when a timed page or the whole gallery is unmounted", async () => {
    const host = mount()
    const baseTimers = vi.getTimerCount()
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    await host.fire("nav-time", "click")
    const before = content(host.find("gallery-showcase"))
    await vi.advanceTimersByTimeAsync(60_000)
    await host.settle()
    expect(content(host.find("gallery-showcase"))).not.toBe(before)
    await host.fire("nav-button", "click")
    expect(vi.getTimerCount()).toBe(baseTimers)
    host.unmount()
    expect(vi.getTimerCount()).toBe(0)
    app = undefined
  })
})
