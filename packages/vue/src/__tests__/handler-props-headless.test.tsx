/// Headless tests for the handler-prop rule: any prop named `on` + uppercase
/// with a function value is an event listener of the derived type, on any
/// element — including element types registered from other crates, whose
/// custom events (`onGreet` → `greet`) exist in no fixed table. A non-function
/// value keeps the prop as data.

import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

function listeners(renderer: HeadlessRenderer, id: number) {
  return renderer
    .opsOf("setEventListener")
    .filter((op) => op[1] === id)
    .map((op) => [op[2], op[3]] as const)
}

function prop(renderer: HeadlessRenderer, id: number, key: string) {
  const ops = renderer
    .opsOf("setCustomProp")
    .filter((op) => op[1] === id && op[2] === key)
  return ops.length ? ops[ops.length - 1]![3] : undefined
}

function widgetApp(setup: () => unknown) {
  const App = defineComponent({
    setup,
    render() {
      return h("div", [this.$slots.default?.()])
    },
  })
  return mountHeadless(App)
}

describe("handler props", () => {
  it("registers a listener for any on+A-Z function prop, on any element type", async () => {
    const greeted: unknown[] = []
    const app = widgetApp(() => () =>
      h("my-widget", {
        onGreet: (event: unknown) => greeted.push(event),
      })
    )
    await app.settle()
    const widget = app.renderer.opsOf("createElement").find((op) => op[2] === "my-widget")!
    expect(widget).toBeDefined()
    expect(listeners(app.renderer, widget![1] as number)).toContainEqual(["greet", true])
    expect(prop(app.renderer, widget![1] as number, "onGreet")).toBeUndefined()

    app.dispatch({ elementId: widget![1] as number, eventType: "greet", detail: { name: "x" } })
    expect(greeted).toEqual([{ elementId: widget![1], eventType: "greet", detail: { name: "x" } }])
    app.unmount()
  })

  it("keeps a non-function on* prop as data on a custom element", async () => {
    const app = widgetApp(() => () => h("my-widget", { onTop: true }))
    await app.settle()
    const widget = app.renderer.opsOf("createElement").find((op) => op[2] === "my-widget")!
    const id = widget![1] as number
    expect(prop(app.renderer, id, "onTop")).toBe(true)
    expect(listeners(app.renderer, id)).toEqual([])
    app.unmount()
  })

  it("follows a prop switching between handler and data", async () => {
    const value = ref<unknown>(() => {})
    const app = widgetApp(() => () => h("my-widget", { onGreet: value.value as never }))
    await app.settle()
    const widget = app.renderer.opsOf("createElement").find((op) => op[2] === "my-widget")!
    const id = widget![1] as number
    expect(listeners(app.renderer, id)).toContainEqual(["greet", true])

    value.value = true
    await app.settle()
    expect(listeners(app.renderer, id)).toContainEqual(["greet", false])
    expect(prop(app.renderer, id, "onGreet")).toBe(true)

    value.value = null
    await app.settle()
    // Cleared on the Rust side: the clearing op sends null.
    expect(prop(app.renderer, id, "onGreet")).toBeNull()
    expect(listeners(app.renderer, id)).toContainEqual(["greet", false])
    app.unmount()
  })

  it("keeps unknown on* props out of a div's custom props and maps onInput to change", async () => {
    const app = widgetApp(() => () =>
      h("div", { onWhatever: () => {}, onInput: () => {}, "aria-label": "row" })
    )
    await app.settle()
    const div = app.container.children[0]!
    expect(listeners(app.renderer, div.id!)).toContainEqual(["whatever", true])
    expect(listeners(app.renderer, div.id!)).toContainEqual(["change", true])
    expect(prop(app.renderer, div.id!, "onWhatever")).toBeUndefined()
    expect(prop(app.renderer, div.id!, "aria-label")).toBe("row")
    app.unmount()
  })
})
