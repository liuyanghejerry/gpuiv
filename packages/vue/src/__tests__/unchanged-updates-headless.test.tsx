/// Headless tests for skipping unchanged updates on the mutation path: a
/// re-render that produces the same style or custom-prop payload sends no op,
/// and a handler swapped for a fresh inline closure re-sends nothing — Vue
/// re-creates inline objects and functions on every render, so the payload,
/// not the reference, decides.

import { defineComponent, h, reactive, ref } from "vue"
import { describe, expect, it } from "vitest"
import { sameMutationValue } from "../reconciler/batch-renderer.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

const state = reactive({
  label: "row",
  color: "#ff0000",
  width: 100,
  meta: { deep: { value: 1 } },
  withHandler: true,
})

const Row = defineComponent({
  setup() {
    return () =>
      h("my-widget", {
        "test-id": "row",
        // Tracked read, so label changes re-render the row.
        label: state.label,
        // Fresh object identity on every render, like an inline template
        // object.
        style: { color: state.color, width: state.width },
        meta: { deep: { value: state.meta.deep.value } },
        onTick: state.withHandler ? () => state.label : null,
      })
  },
})

function opsFor(renderer: HeadlessRenderer, kind: string, id: number) {
  return renderer.opsOf(kind).filter((op) => op[1] === id)
}

async function mountRow(): Promise<{ app: HeadlessApp; id: number }> {
  const app = mountHeadless(Row)
  await app.settle()
  const widget = app.renderer.opsOf("createElement").find((op) => op[2] === "my-widget")!
  return { app, id: widget![1] as number }
}

describe("sameMutationValue", () => {
  it("treats undefined keys as absent and JSON edge numbers as equal", () => {
    expect(sameMutationValue({ color: undefined }, {})).toBe(true)
    expect(sameMutationValue(NaN, NaN)).toBe(true)
    expect(sameMutationValue(0, -0)).toBe(true)
    expect(sameMutationValue(1, 2)).toBe(false)
    expect(sameMutationValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(sameMutationValue({ a: [1, { b: 3 }] }, { a: [1, { b: 2 }] })).toBe(false)
    expect(sameMutationValue({ a: 1 }, { a: 1, b: undefined })).toBe(true)
  })

  it("compares only plain structures: a class instance equals itself", () => {
    class Box {
      constructor(public value: number) {}
    }
    expect(sameMutationValue(new Box(1), new Box(1))).toBe(false)
    const box = new Box(1)
    expect(sameMutationValue(box, box)).toBe(true)
    expect(sameMutationValue([1], { 0: 1 })).toBe(false)
  })
})

describe("unchanged updates are skipped", () => {
  it("sends no style op when a re-render produces the same style", async () => {
    const { app, id } = await mountRow()
    const before = opsFor(app.renderer, "setStyle", id).length
    expect(before).toBe(1)

    state.label = "other" // re-render; style objects are fresh but equal
    await app.settle()
    expect(opsFor(app.renderer, "setStyle", id).length).toBe(1)

    state.color = "#00ff00"
    await app.settle()
    const styles = opsFor(app.renderer, "setStyle", id)
    expect(styles.length).toBe(2)
    expect((styles[1]![2] as Record<string, unknown>).color).toBe("#00ff00")
    app.unmount()
  })

  it("sends no custom-prop op when the serialized payload is unchanged", async () => {
    const { app, id } = await mountRow()
    const before = opsFor(app.renderer, "setCustomProp", id).filter((op) => op[2] === "meta").length
    expect(before).toBe(1)

    state.label = "another"
    await app.settle()
    expect(opsFor(app.renderer, "setCustomProp", id).filter((op) => op[2] === "meta").length).toBe(1)

    state.meta.deep.value = 2
    await app.settle()
    const metas = opsFor(app.renderer, "setCustomProp", id).filter((op) => op[2] === "meta")
    expect(metas.length).toBe(2)
    app.unmount()
  })

  it("re-registers a swapped handler without re-sending setEventListener", async () => {
    const { app, id } = await mountRow()
    const listeners = () => opsFor(app.renderer, "setEventListener", id).filter((op) => op[2] === "tick")
    expect(listeners()).toEqual([[ "setEventListener", id, "tick", true ]])

    // The inline closure is new on every render, but the element keeps
    // listening: no new op.
    state.label = "re-rendered"
    await app.settle()
    expect(listeners().length).toBe(1)

    // Removing the handler still reports it.
    state.withHandler = false
    await app.settle()
    expect(listeners()).toEqual([
      ["setEventListener", id, "tick", true],
      ["setEventListener", id, "tick", false],
    ])
    app.unmount()
  })

  it("an identical re-render sends no ops at all", async () => {
    const tick = ref(0)
    const List = defineComponent({
      setup() {
        return () =>
          h(
            "div",
            { style: { flexDirection: "column" }, tick: tick.value },
            Array.from({ length: 3 }, (_, i) =>
              h(
                "div",
                { key: i, style: { padding: 8, color: "#111111" }, onClick: () => tick.value, meta: { i } },
                [h("text", { style: { fontSize: 13 } }, `row ${i}`)]
              )
            )
          )
      },
    })
    const app = mountHeadless(List)
    await app.settle()
    const baseline = app.renderer.ops.length
    expect(baseline).toBeGreaterThan(0)

    // Every inline object and closure is fresh; every payload is identical.
    tick.value = 1
    await app.settle()
    tick.value = 2
    await app.settle()
    expect(app.renderer.ops.length).toBe(baseline)
    app.unmount()
  })
})
