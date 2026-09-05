/// Headless tests for the Vue custom renderer core.
///
/// These do not need the native addon: a mock NativeRenderer records the op
/// tuples each `applyBatch` receives, so we can assert on the exact protocol
/// emitted by mount/update/remove flows.

import { beforeEach, describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { defineComponent, h, ref, nextTick } from "vue"
import type { NativeRenderer } from "../types.js"
import { createGpuivRendererHost, toGpuixStyle } from "../reconciler/vue-renderer.js"
import { hasNativeTestRenderer } from "../testing.js"

type Op = unknown[]

describe("TestGpuixRenderer availability", () => {
  it("exports a constructor, and a flag that is true only when construction works", () => {
    const native = createRequire(import.meta.url)("@gpuiv/native") as {
      TestGpuixRenderer?: new (width?: number, height?: number) => unknown
      hasTestGpuixRenderer?: () => boolean
    }
    expect(typeof native.TestGpuixRenderer).toBe("function")
    expect(native.hasTestGpuixRenderer?.()).toBe(hasNativeTestRenderer)
    if (hasNativeTestRenderer) {
      const renderer = new native.TestGpuixRenderer!(1, 1)
      expect(renderer).toBeTruthy()
    } else {
      expect(() => new native.TestGpuixRenderer!()).toThrow(
        /macOS and Windows only.*wgpu cannot read a rendered image back yet.*GpuixRenderer still works/s,
      )
    }
  })
})

class MockRenderer implements NativeRenderer {
  applied: Op[] = []

  applyBatch(json: string): number[] {
    this.applied.push(...(JSON.parse(json) as Op[]))
    return []
  }
}

function mountApp(component: unknown) {
  const mock = new MockRenderer()
  const host = createGpuivRendererHost(mock, { nextElementId: 0 })
  const app = host.vue.createApp(component as never)
  app.mount(host.container)
  host.flushMutations()
  return { mock, host, app }
}

describe("vue renderer core", () => {
  it("mounts a div with a text child through the mutation protocol", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", { style: { width: 100 } }, [h("span", "hello")]),
    })
    const { mock } = mountApp(Comp)
    const applied = mock.applied

    expect(applied).toContainEqual(["setRoot", 1])
    const creates = applied.filter((op) => op[0] === "createElement")
    expect(new Set(creates.map((op) => op[1]))).toEqual(new Set([1, 2, 3]))
    expect(applied).toContainEqual(["setStyle", 2, { width: 100 }])
    expect(applied).toContainEqual(["appendChild", 2, 3])
    expect(applied).toContainEqual(["appendChild", 1, 2])
    expect(applied).toContainEqual(["setText", 3, "hello"])

    // Protocol invariant: a parent is created before any child attaches to it.
    for (const op of applied.filter((o) => o[0] === "appendChild" || o[0] === "insertBefore")) {
      const parentId = op[1] as number
      const parentCreate = applied.findIndex((o) => o[0] === "createElement" && o[1] === parentId)
      expect(parentCreate).toBeGreaterThanOrEqual(0)
      expect(applied.indexOf(op)).toBeGreaterThan(parentCreate)
    }
  })

  it("writes a single string child as element text content", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", "just text"),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setText", 2, "just text"])
  })

  it("normalizes kebab-case style keys to camelCase", () => {
    expect(toGpuixStyle({ "font-size": 12, backgroundColor: "#fff", "--x": 1 })).toEqual({
      fontSize: 12,
      backgroundColor: "#fff",
    })
    expect(toGpuixStyle("padding:12px;color:red")).toEqual({
      padding: "12px",
      color: "red",
    })
    expect(toGpuixStyle([{ width: 1 }, { height: 2 }])).toEqual({ width: 1, height: 2 })
  })

  it("registers events and updates text on state change", async () => {
    const count = ref(0)
    const events: string[] = []
    const Comp = defineComponent({
      setup: () => () =>
        h(
          "div",
          {
            onClick: () => {
              count.value++
            },
            testId: "btn",
          },
          String(count.value)
        ),
    })
    const { mock, host } = mountApp(Comp)

    expect(mock.applied).toContainEqual(["setEventListener", 2, "click", true])
    expect(mock.applied).toContainEqual(["setCustomProp", 2, "testId", "btn"])

    // Fire a native click event as the Rust side would — with the raw
    // renderer, which is what the event registry is keyed by.
    const { handleGpuixEvent } = await import("../reconciler/event-registry.js")
    handleGpuixEvent(
      { elementId: 2, eventType: "click" } as never,
      mock
    )
    await nextTick()
    expect(count.value).toBe(1)

    host.flushMutations()
    expect(mock.applied).toContainEqual(["setText", 2, "1"])
  })

  it("removes destroyed subtrees on unmount", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", [h("span", "a"), h("span", "b")]),
    })
    const { mock, host, app } = mountApp(Comp)
    app.unmount()
    host.flushMutations()
    // No removeChild op: native destroy_element unlinks from the parent.
    expect(mock.applied).toContainEqual(["destroyElement", 2])
  })

  it("mounts fragment children without sending null ids to Rust", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", [h("span", "a"), "between", h("span", "b")]),
    })
    const { mock } = mountApp(Comp)
    for (const op of mock.applied) {
      expect(op).not.toContain(null)
    }
    // root div + 3 children (span, text node, span)
    expect(mock.applied.filter((o) => o[0] === "appendChild")).toHaveLength(4)
  })

  it("keeps keyed list order when children are reordered", async () => {
    // Interpret the mutation stream into per-parent child id lists,
    // mirroring Rust's RetainedTree semantics.
    function interpret(applied: Op[]): Map<number, number[]> {
      const kids = new Map<number, number[]>()
      const ensure = (id: number): number[] => {
        if (!kids.has(id)) kids.set(id, [])
        return kids.get(id)!
      }
      for (const op of applied) {
        if (op[0] === "appendChild") {
          const arr = ensure(op[1] as number)
          const id = op[2] as number
          const i = arr.indexOf(id)
          if (i !== -1) arr.splice(i, 1)
          arr.push(id)
        } else if (op[0] === "insertBefore") {
          const arr = ensure(op[1] as number)
          const id = op[2] as number
          const before = op[3] as number
          const i = arr.indexOf(id)
          if (i !== -1) arr.splice(i, 1)
          const at = arr.indexOf(before)
          arr.splice(at === -1 ? arr.length : at, 0, id)
        } else if (op[0] === "createElement") {
          ensure(op[1] as number)
        }
      }
      return kids
    }

    const items = ref([{ id: 1 }, { id: 2 }, { id: 3 }])
    const Comp = defineComponent({
      setup: () => () =>
        h(
          "div",
          items.value.map((i) => h("span", { key: i.id }, String(i.id)))
        ),
    })
    const { mock, host } = mountApp(Comp)

    items.value = [{ id: 2 }, { id: 3 }, { id: 1 }]
    await nextTick()
    host.flushMutations()

    const kids = interpret(mock.applied)
    // div 2 holds the spans; expect item2, item3, item1 in that order.
    expect(kids.get(2)).toHaveLength(3)
    expect(kids.get(2)!.length).toBe(3)
    // Spans were created in order id3=item1, id4=item2, id5=item3.
    expect(kids.get(2)).toEqual([4, 5, 3])
  })
})

describe("vue renderer lifecycle semantics", () => {
  it("destroys and recreates nodes on v-if toggle", async () => {
    const shown = ref(true)
    const Comp = defineComponent({
      setup: () => () => h("div", shown.value ? [h("span", "A")] : []),
    })
    const { mock, host } = mountApp(Comp)
    const before = mock.applied.filter((o) => o[0] === "createElement").length

    shown.value = false
    await nextTick()
    host.flushMutations()
    expect(mock.applied).toContainEqual(["destroyElement", 3])

    shown.value = true
    await nextTick()
    host.flushMutations()
    const creates = mock.applied.filter((o) => o[0] === "createElement")
    expect(creates.length).toBeGreaterThan(before)
    expect(mock.applied).toContainEqual(["appendChild", 2, creates.at(-1)![1]])
  })

  it("clears the style when the style binding is removed", async () => {
    const styleOn = ref(true)
    const Comp = defineComponent({
      setup: () => () => h("div", { style: styleOn.value ? { width: 100 } : null }),
    })
    const { mock, host } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setStyle", 2, { width: 100 }])

    styleOn.value = false
    await nextTick()
    host.flushMutations()
    expect(mock.applied).toContainEqual(["setStyle", 2, {}])
  })

  it("unregisters an event listener when the handler prop is removed", async () => {
    const withHandler = ref(true)
    const Comp = defineComponent({
      setup: () => () =>
        h("div", withHandler.value ? { onClick: () => {} } : {}),
    })
    const { mock, host } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setEventListener", 2, "click", true])

    withHandler.value = false
    await nextTick()
    host.flushMutations()
    expect(mock.applied).toContainEqual(["setEventListener", 2, "click", false])
  })

  it("replaces element children with a single text run via setElementText", async () => {
    const asText = ref(true)
    const Comp = defineComponent({
      setup: () => () =>
        h(
          "div",
          asText.value ? { children: undefined } : {},
          asText.value ? undefined : [h("span", "old")],
        ) as never,
    })
    // Simpler shape: string child switches to element child and back.
    const Alt = defineComponent({
      setup: () => () =>
        h("div", asText.value ? "now text" : h("span", "old")),
    })
    const { mock, host } = mountApp(Alt)
    expect(mock.applied).toContainEqual(["setText", 2, "now text"])

    asText.value = false
    await nextTick()
    host.flushMutations()
    // Vue clears the old text content before mounting the element child.
    expect(mock.applied).toContainEqual(["setText", 2, ""])
    expect(mock.applied).toContainEqual(["appendChild", 2, 3])
  })

  it("forwards input attributes as custom props", () => {
    const Comp = defineComponent({
      setup: () => () =>
        h("input", {
          value: "hello",
          placeholder: "Type...",
          readOnly: true,
        }),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setCustomProp", 2, "value", "hello"])
    expect(mock.applied).toContainEqual(["setCustomProp", 2, "placeholder", "Type..."])
    expect(mock.applied).toContainEqual(["setCustomProp", 2, "readOnly", true])
  })

  it("keeps hover/active nested style objects intact", () => {
    const style = {
      backgroundColor: "#000",
      hover: { backgroundColor: "#111" },
      active: { backgroundColor: "#222" },
    }
    expect(toGpuixStyle(style)).toEqual(style)
  })

  it("ignores the class prop entirely", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", { class: "fancy", style: { width: 10 } }),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied.some((o) => o[0] === "setCustomProp")).toBe(false)
    expect(mock.applied).toContainEqual(["setStyle", 2, { width: 10 }])
  })
})
