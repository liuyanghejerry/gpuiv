/// Headless tests for the Vue custom renderer core.
///
/// A mock NativeRenderer records protocol tuples for most cases. The native
/// style case also checks that Rust accepts and renders normalized bindings.

import { beforeEach, describe, expect, it } from "vitest"
import { createRequire } from "node:module"
import { defineComponent, h, onErrorCaptured, ref, nextTick, Suspense } from "vue"
import type { NativeRenderer } from "../types.js"
import { createGpuivRendererHost, toGpuixStyle } from "../reconciler/vue-renderer.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { handleGpuixEvent } from "../reconciler/event-registry.js"

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

/** Reports every destroyElement op back as a destroyed id, like the Rust side. */
class DestroyReportingRenderer extends MockRenderer {
  applyBatch(json: string): number[] {
    const batch = JSON.parse(json) as Op[]
    this.applied.push(...batch)
    return batch.filter((op) => op[0] === "destroyElement").map((op) => op[1] as number)
  }
}

function mountApp(component: unknown, mock: MockRenderer = new MockRenderer()) {
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
      padding: 12,
      color: "red",
    })
    expect(toGpuixStyle([{ width: 1 }, { height: 2 }])).toEqual({ width: 1, height: 2 })
  })

  it("normalizes numeric CSS values without coercing dimensions or colors", () => {
    expect(toGpuixStyle([
      "padding:12px;opacity:.5;flex-grow:1;font-size:14px;width:100%;height:auto;color:rgb(10, 20, 30)",
      { padding: "8px", "font-size": "16px", hover: { "border-width": "2px" } },
    ])).toEqual({
      padding: 8, opacity: 0.5, flexGrow: 1, fontSize: 16,
      width: "100%", height: "auto", color: "rgb(10, 20, 30)", hover: { borderWidth: 2 },
    })
    expect(toGpuixStyle([{ fontSize: 12 }, "font-size:18px"])).toEqual({ fontSize: 18 })
  })

  it.each(["sync", "async"])("routes %s errors in listener arrays to the Vue boundary", async (mode) => {
    const captured: string[] = []
    const called: string[] = []
    const fail = () => { throw new Error(`${mode} listener`) }
    const listener = mode === "async" ? async () => fail() : fail
    const Child = defineComponent({
      render: () => h("div", { onClick: [listener, () => called.push("next")] }),
    })
    const Boundary = defineComponent({
      setup() {
        onErrorCaptured((error) => { captured.push(String(error)); return false })
        return () => h(Child)
      },
    })
    const { mock, host, app } = mountApp(Boundary)
    try {
      handleGpuixEvent({ elementId: host.container.children[0].id!, eventType: "click" } as never, mock)
      await nextTick()
      expect(captured).toEqual([`Error: ${mode} listener`])
      expect(called).toEqual(["next"])
    } finally {
      app.unmount()
      host.detach()
    }
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

describe.skipIf(!hasNativeTestRenderer)("native style bindings", () => {
  it("mounts and updates CSS string/array styles through the Rust batch parser", async () => {
    const style = ref<unknown>("padding:12px;opacity:.5;font-size:14px;width:100px;height:60px")
    const app = createTestApp(defineComponent({
      render: () => h("div", { testId: "styled", style: style.value }, [h("text", "styled content")]),
    }))
    try {
      const node = () => app.renderer.findByTestId("styled")!
      expect(node().style.padding).toBe(12)
      expect(node().style.opacity).toBe(0.5)
      expect(node().style.fontSize).toBe(14)
      expect(app.renderer.getPaintedText()).toContain("styled content")
      style.value = ["padding:8px;font-size:16px", { opacity: "0.75", hover: { borderWidth: "2px" } }]
      await app.settle()
      expect(node().style.padding).toBe(8)
      expect(node().style.fontSize).toBe(16)
      expect(node().style.opacity).toBe(0.75)
      expect(node().style.hover?.borderWidth).toBe(2)
    } finally {
      app.unmount()
    }
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

describe("renderer edge paths", () => {
  it("maps onInput to the native change event", () => {
    const Comp = defineComponent({
      setup: () => () => h("input", { onInput: () => {}, placeholder: "p" }),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setEventListener", 2, "change", true])
  })

  it("drops the listener wiring when an on-prop stops being a handler", async () => {
    const value = ref<unknown>(() => {})
    const Comp = defineComponent({
      setup: () => () => h("input", { onClick: value.value }),
    })
    const { mock, host } = mountApp(Comp)
    expect(mock.applied).toContainEqual(["setEventListener", 2, "click", true])

    value.value = "not a handler"
    await nextTick()
    mock.applied.length = 0
    host.flushMutations()
    // Neither a listener update nor a forwarded custom prop: the prop is an
    // event name holding a non-handler, so nothing crosses the protocol.
    expect(mock.applied).toEqual([])
  })

  it("ignores the reserved children prop", () => {
    const Comp = defineComponent({
      setup: () => () => h("div", { children: undefined, style: { width: 1 } }),
    })
    const { mock } = mountApp(Comp)
    expect(mock.applied.some((o) => o[0] === "setCustomProp")).toBe(false)
    expect(mock.applied).toContainEqual(["setStyle", 2, { width: 1 }])
  })

  it("exposes scrollIntoView and the img bitmap pushers on element refs", () => {
    let divEl: { scrollIntoView: () => void }
    let imgEl: { setImage: (bytes: Uint8Array) => void; setImagePixels: (width: number, height: number, pixels: Uint8Array) => void }
    const Comp = defineComponent({
      setup: () => () =>
        h("div", [
          h("div", { ref: (el: unknown) => { divEl = el as never } }),
          h("img", { ref: (el: unknown) => { imgEl = el as never } }),
        ]),
    })
    const calls: string[] = []
    const mock = new MockRenderer()
    mock.scrollIntoView = (id) => calls.push(`scroll:${id}`)
    mock.setImage = (id, bytes) => calls.push(`image:${id}:${bytes.length}`)
    mock.setImagePixels = (id, w, h, pixels) => calls.push(`pixels:${id}:${w}x${h}:${pixels.length}`)
    mountApp(Comp, mock)

    divEl!.scrollIntoView()
    imgEl!.setImage(new Uint8Array([1, 2]))
    imgEl!.setImagePixels(2, 3, new Uint8Array(4))
    expect(calls).toEqual(["scroll:3", "image:4:2", "pixels:4:2x3:4"])
  })

  it("dispatches a bare render()'s listeners without a Vue instance", () => {
    const clicks: string[] = []
    const mock = new MockRenderer()
    const host = createGpuivRendererHost(mock, { nextElementId: 0 })
    // host.vue.render() mounts with no owning component instance, so the
    // registry handler is the plain loop and a throw escapes synchronously.
    host.vue.render(
      h("div", {
        onClick: () => {
          clicks.push("one")
          throw new Error("boom")
        },
        onMouseDown: [() => clicks.push("arr")],
      }),
      host.container
    )
    host.flushMutations()
    const divId = host.container.children[0].id!
    expect(() =>
      handleGpuixEvent({ elementId: divId, eventType: "click" } as never, mock)
    ).toThrowError("boom")
    handleGpuixEvent({ elementId: divId, eventType: "mouseDown" } as never, mock)
    expect(clicks).toEqual(["one", "arr"])
    host.vue.render(null, host.container)
    host.flushMutations()
    host.detach()
  })

  it("moves a keyed item past a null placeholder through the anchor path", async () => {
    // The falsy child leaves a comment anchor (never sent to Rust); moving
    // item 1 behind it resolves past the comment to an append.
    const slots = ref<Array<number | null>>([1, 2, 3, null])
    const Comp = defineComponent({
      setup: () => () =>
        h("div", slots.value.map((slot) => (slot === null ? null : h("span", { key: slot }, String(slot))))),
    })
    const { mock, host } = mountApp(Comp)
    mock.applied.length = 0

    slots.value = [2, 3, 1, null]
    await nextTick()
    host.flushMutations()
    // Spans were created 3, 4, 5; item 1's span moves to the end.
    expect(mock.applied).toContainEqual(["appendChild", 2, 3])
    const realIds = host.container.children[0].children
      .filter((child) => child.id != null)
      .map((child) => child.id)
    expect(realIds).toEqual([4, 5, 3])
  })

  it("moves multi-root fragment items before their later siblings", async () => {
    const items = ref([1, 2, 3])
    const Item = defineComponent({
      props: { id: Number },
      setup: (props) => () => [h("span", `a${props.id}`), h("span", `b${props.id}`)],
    })
    const Comp = defineComponent({
      setup: () => () => h("div", items.value.map((i) => h(Item, { key: i, id: i }))),
    })
    const { mock, host } = mountApp(Comp)
    mock.applied.length = 0

    items.value = [2, 1, 3]
    await nextTick()
    host.flushMutations()
    // Item 2's nodes (anchors 7-8, spans 9-10) all move before item 1's
    // first anchor (3); a move of an existing child is insertBefore, not
    // destroy + recreate.
    expect(mock.applied.some((op) => op[0] === "destroyElement")).toBe(false)
    const moves = mock.applied.filter((op) => op[0] === "insertBefore" || op[0] === "appendChild")
    expect(moves).toEqual([
      ["insertBefore", 2, 7, 3],
      ["insertBefore", 2, 9, 3],
      ["insertBefore", 2, 10, 3],
      ["insertBefore", 2, 8, 3],
    ])
  })

  it("moves resolved suspense content across parents", async () => {
    let resolveAsync: (() => void) | undefined
    const Async = defineComponent({
      async setup() {
        await new Promise<void>((resolve) => {
          resolveAsync = resolve
        })
        return () => h("span", "loaded")
      },
    })
    const Comp = defineComponent({
      setup: () => () =>
        h("div", { style: { width: 10 } }, [
          h(Suspense, null, {
            default: () => h(Async),
            fallback: () => h("em", "loading"),
          }),
        ]),
    })
    const { mock, host, app } = mountApp(Comp)
    resolveAsync!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    host.flushMutations()

    // The fallback subtree is destroyed and the async span re-parents into
    // the main container from suspense's hidden container.
    const ops = mock.applied.filter((op) => op[0] === "destroyElement" || op[0] === "appendChild")
    expect(ops).toContainEqual(["destroyElement", 4])
    const texts = host.container.children[0].children.map((child) => child.text)
    expect(texts).toContain("loaded")
    expect(texts).not.toContain("loading")
    app.unmount()
    host.detach()
  })

  it("reports false from a second detach once the root is gone", () => {
    const { host, app } = mountApp(defineComponent({ setup: () => () => h("div") }))
    app.unmount()
    expect(host.detach()).toBe(true)
    expect(host.detach()).toBe(false)
  })
})

describe("batch destruction bookkeeping", () => {
  it("unregisters handlers for every id applyBatch reports destroyed", async () => {
    const shown = ref(true)
    const Comp = defineComponent({
      setup: () => () => h("div", shown.value ? [h("span", { onClick: () => {} }, "a")] : []),
    })
    const mock = new DestroyReportingRenderer()
    const host = createGpuivRendererHost(mock, { nextElementId: 0 })
    const app = host.vue.createApp(Comp)
    app.mount(host.container)
    host.flushMutations()
    const spanId = host.container.children[0].children[0].id!
    expect(host.registryContainer.eventHandlers.get(spanId)).toBeTruthy()

    shown.value = false
    mock.applied.length = 0
    await nextTick()
    host.flushMutations()
    expect(mock.applied).toContainEqual(["destroyElement", spanId])
    // The destroy id loops back from applyBatch and clears the event map.
    expect(host.registryContainer.eventHandlers.has(spanId)).toBe(false)

    app.unmount()
    host.flushMutations()
    host.detach()
  })
})
