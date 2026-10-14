import { afterEach, describe, expect, it } from "vitest"
import { defineComponent, h } from "vue"
import { FloatingLayer } from "../components/floating.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import type { HostNode, MotionProps, StyleDesc } from "../types.js"

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))

function mount(style?: StyleDesc, motion?: MotionProps) {
  const host = createGpuivRendererHost({ applyBatch: () => [] }, { nextElementId: 0 })
  const onKeyDown = () => {}
  const app = host.vue.createApp(defineComponent(() => () => h(FloatingLayer, {
    style, motion, role: "dialog", testId: "content", autoFocus: true, tabIndex: 0, onKeyDown,
  }, { default: () => h("text", "Surface") })))
  app.mount(host.container)
  host.flushMutations()
  cleanups.push(() => { app.unmount(); host.flushMutations(); host.detach() })
  const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
  const surface = all(host.container).find(node => node.type === "anchored")!
  return { surface, content: surface.children[0]!, handlers: host.registryContainer.eventHandlers }
}

describe("floating surface ownership", () => {
  it("provides a default surface while keeping focus and keyboard on content", () => {
    const { surface, content, handlers } = mount()
    expect(surface.props.style).toMatchObject({ backgroundColor: "#1A1A1A" })
    expect(content.props.style).toBeUndefined()
    expect(surface.props.tabIndex).toBeUndefined()
    expect(surface.props.autoFocus).toBeUndefined()
    expect(surface.props.role).toBeUndefined()
    expect(content.props).toMatchObject({ role: "dialog", testId: "content", autoFocus: true, tabIndex: 0 })
    expect(handlers.get(surface.id!)?.has("keyDown") ?? false).toBe(false)
    expect(handlers.get(content.id!)?.has("keyDown")).toBe(true)
  })

  it.each(["transparent", "rgba(17, 34, 51, 0.3)"])("paints %s once on the anchored surface", backgroundColor => {
    const { surface, content } = mount({ width: 120, backgroundColor, opacity: 0.5,
      hover: { backgroundColor: "rgba(51, 34, 17, 0.2)", opacity: 0.75 },
      active: { backgroundColor: "transparent", opacity: 0.25 },
    })
    expect(surface.props.style).toMatchObject({ backgroundColor, opacity: 0.5,
      hover: { backgroundColor: "rgba(51, 34, 17, 0.2)", opacity: 0.75 },
      active: { backgroundColor: "transparent", opacity: 0.25 },
    })
    expect(content.props.style).toMatchObject({ width: 120 })
    for (const state of [content.props.style, content.props.style.hover, content.props.style.active]) {
      expect(state.backgroundColor).toBeUndefined()
      expect(state.opacity).toBeUndefined()
    }
  })

  it("keeps gradient fills free of an overriding default color", () => {
    const background: NonNullable<StyleDesc["background"]> = {
      type: "linear-gradient", angle: 90,
      stops: [{ color: "#112233", position: 0 }, { color: "#445566", position: 1 }],
    }
    const { surface, content } = mount({ background })
    expect(surface.props.style.background).toEqual(background)
    expect(surface.props.style.backgroundColor).toBeUndefined()
    expect(content.props.style.background).toBeUndefined()
  })

  it("animates the complete surface without duplicating the native motion track", () => {
    const motion = { initial: { top: 4, opacity: 0 }, animate: { top: 0, opacity: 1 }, transition: { duration: 0.25 } }
    const { surface, content } = mount({ backgroundColor: "transparent", borderRadius: 16 }, motion)
    expect(surface.props.motion).toEqual(motion)
    expect(surface.props.style).toMatchObject({ position: "relative", borderRadius: 16 })
    expect(content.props.motion).toBeUndefined()
  })

  it("paints drop shadows behind the fill instead of over it on the inner content", () => {
    const shadow = { offsetX: 0, offsetY: 3, blurRadius: 10, spreadRadius: 0, color: "rgba(61, 52, 40, 0.1)" }
    const hovered = { ...shadow, blurRadius: 14 }
    const { surface, content } = mount({ backgroundColor: "#f7f3df", boxShadow: shadow, hover: { boxShadow: hovered } })
    expect(surface.props.style).toMatchObject({ backgroundColor: "#f7f3df", boxShadow: shadow, hover: { boxShadow: hovered } })
    expect(content.props.style.boxShadow).toBeUndefined()
    expect(content.props.style.hover.boxShadow).toBeUndefined()
  })
})
