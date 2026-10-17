import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, type Component } from "vue"
import { Icon } from "../src/components/Icon.js"
import { ICON_LIST, ICON_NAMES, ICON_SVG } from "../src/icons/svg-data.js"
import * as named from "../src/icons/named-icons.js"
import { mountHost } from "./harness.js"
const hosts: ReturnType<typeof mountHost>[] = []
afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))
function decode(src: unknown) { return Buffer.from(String(src).split(",")[1], "base64").toString("utf8") }

describe("named icon public API", () => {
  it("provides all 101 named wrappers with the corresponding full-colour SVG geometry", () => {
    const wrappers = Object.keys(named).filter((name) => name.endsWith("Icon"))
    expect(wrappers).toHaveLength(101)
    const host = mountHost(defineComponent({ setup: () => () => h("div", ICON_NAMES.map((name) => h(
      (named as Record<string, unknown>)[`${name}Icon`] as Component, { testId: name },
    ))) }))
    hosts.push(host)
    for (const name of ICON_NAMES) {
      const node = host.find(name)
      expect(node.type).toBe("img")
      expect(node.props.style).toMatchObject({ width: 24, height: 24 })
      expect(decode(node.props.src)).toContain(ICON_SVG[name].inner.replace(/\s+/g, " ").trim())
    }
    // ICON_LIST has the original [{ name, label: name }] semantics.
    expect(ICON_LIST).toEqual(ICON_NAMES.map((name) => ({ name, label: name })))
  })

  it("preserves palette fills while applying root color, stroke width and native attrs", async () => {
    const click = vi.fn()
    const host = mountHost(defineComponent({ setup: () => () => h(named.HeartIcon, { size: 32, color: "#123456", strokeWidth: 6,
      title: "爱心", testId: "heart", onClick: click, style: { width: 40 } }) }))
    hosts.push(host)
    const heart = host.find("heart"), svg = decode(heart.props.src)
    expect(svg).toMatch(/^<svg [^>]*stroke="#123456"/)
    expect(svg).toMatch(/^<svg [^>]*stroke-width="6"/)
    expect(svg).toContain('fill="#E76F51"')
    expect(heart.props.style).toMatchObject({ width: 40, height: 32 })
    expect(heart.props["aria-label"]).toBe("爱心")
    expect(heart.props.role).toBe("img")
    await host.fire("heart", "click")
    expect(click).toHaveBeenCalledOnce()
  })

  it("supports custom Icon components through stroke passthrough and explicit label priority", () => {
    const host = mountHost(defineComponent({ setup: () => () => h(Icon, { icon: named.BearIcon, color: "#ff0000", strokeWidth: 2,
      testId: "bear", "aria-label": "明确标签", title: "title fallback", size: 48 }) }))
    hosts.push(host)
    const node = host.find("bear"), svg = decode(node.props.src)
    expect(svg).toMatch(/^<svg [^>]*stroke="#ff0000"/)
    expect(svg).toMatch(/^<svg [^>]*stroke-width="2"/)
    expect(svg).toContain('fill="#8B5E3C"')
    expect(node.props["aria-label"]).toBe("明确标签")
    expect(node.props.style).toMatchObject({ width: 48, height: 48 })
  })

  it("changes only root fill and escapes its value without altering inner palette colours", () => {
    const host = mountHost(defineComponent({ setup: () => () => h(named.BearIcon, { fill: '#abcdef"&', testId: "bear" }) }))
    hosts.push(host)
    const svg = decode(host.find("bear").props.src)
    expect(svg).toMatch(/^<svg [^>]*fill="#abcdef&quot;&amp;"/)
    expect(svg).toContain('fill="#8B5E3C"')
    expect(svg).toContain('fill="#FAEDCD"')
  })

  it("publishes the original palette and category metadata", () => {
    expect(named.NAIVE_PALETTE).toEqual({ ink: "#2A2A2A", navy: "#264653", orange: "#E76F51", yellow: "#E9C46A", pink: "#F4A6A4", green: "#588157", teal: "#2A9D8F", brown: "#8B5E3C", cream: "#FAEDCD" })
    expect(named.ICON_CATEGORIES).toEqual(["interface", "action", "media", "navigation", "communication", "nature", "animals", "food", "objects", "transport", "emoji"])
  })
})
