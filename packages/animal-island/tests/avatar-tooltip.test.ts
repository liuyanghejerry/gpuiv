import { afterEach, describe, expect, it } from "vitest"
import { Fragment, defineComponent, h, ref } from "vue"
import { Avatar } from "../src/components/Avatar.js"
import { AvatarGroup } from "../src/components/AvatarGroup.js"
import { Tooltip } from "../src/components/Tooltip.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))
describe("AvatarGroup", () => {
  it("overlaps children with cream separators and folds remaining avatars into +N", () => {
    const host = mountHost(defineComponent({ setup: () => () => h(AvatarGroup, { maxCount: 2, size: "large", shape: "square", gap: 10, testId: "group", maxStyle: { backgroundColor: "#ff0000" } }, {
      default: () => Array.from({ length: 4 }, (_, index) => h(Avatar, { testId: `avatar-${index}` }, { default: () => h("text", String(index)) })),
    }) }))
    hosts.push(host)
    expect(host.find("avatar-0").props.style).toMatchObject({ width: 48, height: 48, borderRadius: 8, borderWidth: 2, borderColor: "#f8f8f0" })
    expect(host.find("avatar-1").props.style).toMatchObject({ marginLeft: -10 })
    expect(host.all().some((node) => node.props.testId === "avatar-2")).toBe(false)
    expect(host.find("group-more").props.style).toMatchObject({ width: 48, height: 48, backgroundColor: "#ff0000", borderRadius: 999 })
    expect(host.find("group-more").props["aria-label"]).toBe("还有 2 个头像")
    expect(host.text()).toContain("+2")
  })

  it("updates provided size and shape reactively and preserves explicit child overrides", async () => {
    const size = ref(32), shape = ref<"circle" | "square">("circle")
    const host = mountHost(defineComponent({ setup: () => () => h(AvatarGroup, { size: size.value, shape: shape.value }, { default: () => [
      h(Avatar, { testId: "inherited" }), h(Avatar, { testId: "own", size: 64, shape: "square" }),
    ] }) }))
    hosts.push(host)
    expect(host.find("inherited").props.style).toMatchObject({ width: 32, borderRadius: 999 })
    size.value = 48; shape.value = "square"
    await host.settle()
    expect(host.find("inherited").props.style).toMatchObject({ width: 48, borderRadius: 8 })
    expect(host.find("own").props.style).toMatchObject({ width: 64, borderRadius: 8 })
  })

  it("flattens fragments and treats zero maxCount as unlimited", () => {
    const host = mountHost(defineComponent({ setup: () => () => h(AvatarGroup, { maxCount: 0, testId: "group" }, { default: () => h(Fragment, null, [
      h(Avatar, { testId: "first" }), h(Avatar, { testId: "second" }),
    ]) }) }))
    hosts.push(host)
    expect(host.find("second").props.style).toMatchObject({ marginLeft: -8 })
    expect(host.all().some((node) => node.props.testId === "group-more")).toBe(false)
  })
})

describe("Tooltip click activation", () => {
  it("opens and closes by keyboard and exposes the deferred tooltip role", async () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Tooltip, { trigger: "click", title: "海岛提示", testId: "tip" }, { default: () => h("text", "查看提示") }) }))
    hosts.push(host)
    expect(host.find("tip-trigger").props.role).toBe("button")
    await host.fire("tip-trigger", "keyDown", { key: "enter" })
    expect(host.find("tip-content").props.role).toBe("tooltip")
    expect(host.find((node) => node.type === "anchored").props.deferred).toBe(true)
    expect(host.text()).toContain("海岛提示")
    await host.fire("tip-trigger", "keyDown", { key: "space" })
    expect(host.all().some((node) => node.props.testId === "tip-content")).toBe(false)
  })

  it("keeps mouse toggle and title slot precedence", async () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Tooltip, { trigger: "click", title: "fallback", testId: "tip" }, {
      default: () => h("text", "trigger"), title: () => h("text", "custom title"),
    }) }))
    hosts.push(host)
    await host.fire("tip-trigger", "click")
    expect(host.text()).toContain("custom title")
    expect(host.text()).not.toContain("fallback")
    await host.fire("tip-trigger", "click")
    expect(host.all().some((node) => node.props.testId === "tip-content")).toBe(false)
  })
})
