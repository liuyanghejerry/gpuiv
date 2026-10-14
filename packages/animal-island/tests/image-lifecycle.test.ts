import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import type { EventPayload } from "@gpuiv/vue"
import { Avatar } from "../src/components/Avatar.js"
import { Image } from "../src/components/Image.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach(host => host.unmount()))
function mount(component: Parameters<typeof mountHost>[0]) {
  const host = mountHost(component)
  hosts.push(host)
  return host
}
const imageValue = (src: string, error?: string) => JSON.stringify({ src, generation: 1, ...(error ? { error } : { naturalWidth: 80, naturalHeight: 60 }) })

describe("native image lifecycle", () => {
  it("registers native events and fades the decoded image in once load arrives", async () => {
    const onLoad = vi.fn()
    const host = mount(defineComponent(() => () => h(Image, { src: "island.png", testId: "picture", onLoad })))
    const image = host.find("picture-img")
    expect(host.operations).toContainEqual(["setEventListener", image.id, "load", true])
    expect(host.operations).toContainEqual(["setEventListener", image.id, "error", true])
    expect(image.props.motion).toMatchObject({ animate: { opacity: 0 } })
    const value = imageValue("island.png")
    await host.fire(image, "load", { value })
    expect(host.find("picture-img").props.motion).toMatchObject({ animate: { opacity: 1 }, transition: { duration: 0.25 } })
    expect(onLoad).toHaveBeenCalledOnce()
    expect(onLoad.mock.calls[0][0]).toMatchObject({ eventType: "load", value })
  })

  it("replaces a failed image with the original error artwork and colour, disabling preview", async () => {
    const onError = vi.fn()
    const host = mount(defineComponent(() => () => h(Image, { src: "missing.png", testId: "picture", width: 240, height: 150, variant: "stamp", color: "app-teal", onError })))
    await host.fire("picture-img", "error", { value: imageValue("missing.png", "not found") })
    expect(host.text()).toContain("图片加载失败")
    expect(host.find("picture").props).toMatchObject({ role: "img", "aria-label": "图片加载失败" })
    expect(host.find("picture").props.style).toMatchObject({ width: 240, height: 150, backgroundColor: "#e8faf5", color: "#2a6b5a", flexDirection: "column" })
    expect(host.find("picture").props.tabIndex).toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
    await host.fire("picture", "click")
    await host.fire("picture", "keyDown", { key: "enter" })
    expect(host.all().some(node => node.props.role === "dialog")).toBe(false)
  })

  it("resets failure on a new source and rejects old, malformed and unmounted callbacks", async () => {
    const src = ref("first.png"), onLoad = vi.fn(), onError = vi.fn()
    const host = mount(defineComponent(() => () => h(Image, { src: src.value, testId: "picture", onLoad, onError })))
    const oldImage = host.find("picture-img")
    await host.fire(oldImage, "error", { value: imageValue("first.png", "decode failed") })
    src.value = "second.png"
    await host.settle()
    const replacement = host.find("picture-img")
    expect(replacement.id).not.toBe(oldImage.id)
    expect(replacement.props.motion).toMatchObject({ animate: { opacity: 0 } })
    expect(host.text()).not.toContain("图片加载失败")
    await host.fire(oldImage, "load", { value: imageValue("first.png") })
    await host.fire(replacement, "load", { value: imageValue("first.png") })
    await host.fire(replacement, "load", { value: "not JSON" })
    expect(onLoad).not.toHaveBeenCalled()
    expect(replacement.props.motion).toMatchObject({ animate: { opacity: 0 } })
    await host.fire(replacement, "load", { value: imageValue("second.png") })
    expect(onLoad).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
  })

  it("closes a preview when the primary image fails and restores focus", async () => {
    const host = mount(defineComponent(() => () => h(Image, { src: "island.png", testId: "picture", alt: "海岛" })))
    host.native.focusElement!(host.find("picture").id!)
    await host.fire("picture", "click")
    expect(host.all().some(node => node.props.role === "dialog")).toBe(true)
    expect(host.find(node => node.props.role === "dialog").props.style).toMatchObject({ pointerEvents: "auto" })
    expect(host.find(node => node.props["aria-label"] === "关闭预览").props.tabIndex).toBe(0)
    await host.fire("picture-img", "error", { value: imageValue("island.png", "failed") })
    // AnimatePresence retains the exiting visual until native motion settles.
    const exiting = host.all().filter(node => (node.props.motion as { isExit?: boolean })?.isExit)
    expect(exiting.length).toBeGreaterThan(0)
    expect(host.native.getFocusedElementId!()).toBe(host.find("picture").id)
  })
})

describe("Avatar image fallback", () => {
  it("calls onError and restores the supplied label, then retries a changed src", async () => {
    const src = ref("first.png"), onError = vi.fn()
    const host = mount(defineComponent(() => () => h(Avatar, { src: src.value, testId: "avatar", onError }, { default: () => h("text", "岛") })))
    const original = host.find("avatar-img")
    await host.fire(original, "error", { value: imageValue("first.png", "failed") })
    expect(host.text()).toContain("岛")
    expect(host.find("avatar").props.style).toMatchObject({ borderWidth: 2 })
    expect(onError).toHaveBeenCalledOnce()
    src.value = "second.png"
    await host.settle()
    expect(host.find("avatar-img").props.src).toBe("second.png")
    expect(host.text()).not.toContain("岛")
    await host.fire(original, "error", { value: imageValue("first.png", "failed") })
    expect(onError).toHaveBeenCalledOnce()
  })

  it("honours onError=false by retaining the failed image", async () => {
    const onError = vi.fn(() => false)
    const host = mount(defineComponent(() => () => h(Avatar, { src: "first.png", testId: "avatar", onError })))
    const image = host.find("avatar-img")
    await host.fire(image, "error", { value: imageValue("first.png", "failed") })
    expect(host.find("avatar-img").id).toBe(image.id)
    expect(onError).toHaveBeenCalledOnce()
  })

  it("ignores events for a different source", async () => {
    const onError = vi.fn()
    const host = mount(defineComponent(() => () => h(Avatar, { src: "first.png", testId: "avatar", onError })))
    await host.fire("avatar-img", "error", { value: imageValue("older.png", "failed") } as Partial<EventPayload>)
    expect(host.find("avatar-img").props.src).toBe("first.png")
    expect(onError).not.toHaveBeenCalled()
  })
})
