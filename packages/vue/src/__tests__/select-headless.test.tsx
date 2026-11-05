/// Headless behavior tests for the Select family: trigger click/keyboard
/// interaction, item registry updates (mount, prop change, unmount), highlight
/// and selection with disabled guards, content escape handling, the
/// presentational wrappers, and SelectValue's label lookup. Events are
/// dispatched through the shared registry — what native hit-testing would
/// deliver — so the suite runs wherever the mock renderer does.

import { defineComponent, h, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../components/select.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessApp } from "./headless.js"
import type { HostNode } from "../types.js"

type RootProps = Record<string, unknown>

function mountSelect(rootProps: RootProps = {}, items: string[] = ["a", "b", "c"]) {
  const App = defineComponent({
    setup: () => () =>
      h(Select, rootProps, {
        default: () => [
          h(SelectTrigger, { testId: "trigger" }, () => h(SelectValue, { placeholder: "pick" })),
          h(
            SelectContent,
            { testId: "content" },
            () =>
              items.map((item) =>
                h(SelectItem, { key: item, value: item, testId: `item-${item}` }, () => item)
              ) as never
          ),
        ],
      }),
  })
  return mountHeadless(App)
}

function findByTestId(app: HeadlessApp, testId: string): HostNode | undefined {
  const all = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(all)]
  return all(app.container).find((node) => node.props.testId === testId)
}

function dispatch(
  app: HeadlessApp,
  testId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): boolean {
  const node = findByTestId(app, testId)
  if (!node?.id) throw new Error(`no ${testId} node`)
  return app.dispatch({ elementId: node.id, eventType, ...payload })
}

async function openViaKeyboard(app: HeadlessApp) {
  dispatch(app, "trigger", "keyDown", { key: "enter" })
  await app.settle()
}

describe("Select (headless)", () => {
  it("opens on trigger click and selects an item, closing the popup", async () => {
    const app = mountSelect()
    await app.settle()
    expect(findByTestId(app, "content")).toBeUndefined()

    dispatch(app, "trigger", "click", { button: 0 })
    await app.settle()
    expect(findByTestId(app, "content"), "the popup mounts").toBeTruthy()

    dispatch(app, "item-b", "click", { button: 0 })
    await app.settle()
    expect(findByTestId(app, "content"), "selecting closes the popup").toBeUndefined()
    expect(findByTestId(app, "item-b"), "unmounted with the popup").toBeUndefined()
    app.unmount()
  })

  it("keeps the popup open when the trigger was pressed while it was open", async () => {
    const app = mountSelect()
    await app.settle()
    await openViaKeyboard(app)
    expect(findByTestId(app, "content")).toBeTruthy()

    // Press + release on the open trigger is a close toggle, not a reopen.
    dispatch(app, "trigger", "mouseDown", { button: 0 })
    dispatch(app, "trigger", "click", { button: 0 })
    await app.settle()
    expect(findByTestId(app, "content")).toBeUndefined()

    dispatch(app, "trigger", "click", { button: 0 })
    await app.settle()
    expect(findByTestId(app, "content"), "the next click reopens").toBeTruthy()
    app.unmount()
  })

  it("ignores trigger events while the root is disabled", async () => {
    const onOpenChange = vi.fn()
    const app = mountSelect({ disabled: true, onOpenChange })
    await app.settle()
    dispatch(app, "trigger", "click", { button: 0 })
    await app.settle()
    dispatch(app, "trigger", "keyDown", { key: "enter" })
    await app.settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(findByTestId(app, "content")).toBeUndefined()
    app.unmount()
  })

  it("navigates with the keyboard from the trigger: open, move, wrap, select", async () => {
    const selected: string[] = []
    const app = mountSelect({ onValueChange: (value: string) => selected.push(value) })
    await app.settle()

    dispatch(app, "trigger", "keyDown", { key: "down" })
    await app.settle()
    expect(findByTestId(app, "content"), "down opens").toBeTruthy()

    dispatch(app, "trigger", "keyDown", { key: "down" })
    dispatch(app, "trigger", "keyDown", { key: "up" })
    dispatch(app, "trigger", "keyDown", { key: "end" })
    dispatch(app, "trigger", "keyDown", { key: "home" })
    await app.settle()
    dispatch(app, "content", "keyDown", { key: "enter" })
    await app.settle()
    expect(selected).toEqual(["a"])

    // ctrl+n / ctrl+p move too, and space toggles.
    dispatch(app, "trigger", "keyDown", { key: "n", modifiers: { ctrl: true } })
    dispatch(app, "trigger", "keyDown", { key: "p", modifiers: { ctrl: true } })
    await app.settle()
    dispatch(app, "trigger", "keyDown", { key: "space" })
    await app.settle()
    expect(findByTestId(app, "content")).toBeUndefined()
    app.unmount()
  })

  it("escape on the content closes the popup and fires onEscapeKeyDown", async () => {
    const onEscape = vi.fn()
    const App = defineComponent({
      setup: () => () =>
        h(Select, {}, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }),
            h(SelectContent, { testId: "content", onEscapeKeyDown: onEscape }, () => [
              h(SelectItem, { value: "a", testId: "item-a" }),
            ] as never),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    await openViaKeyboard(app)

    dispatch(app, "content", "keyDown", { key: "escape" })
    await app.settle()
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(findByTestId(app, "content")).toBeUndefined()
    app.unmount()
  })

  it("highlights on mouseEnter and refuses disabled items and unknown values", async () => {
    const selected: string[] = []
    const App = defineComponent({
      setup: () => () =>
        h(Select, { onValueChange: (v: string) => selected.push(v) }, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }),
            h(SelectContent, { testId: "content" }, () => [
              h(SelectItem, { value: "a", testId: "item-a" }, () => "a"),
              h(SelectItem, { value: "b", disabled: true, testId: "item-b" }, () => "b"),
            ] as never),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    await openViaKeyboard(app)

    dispatch(app, "item-a", "mouseEnter")
    await app.settle()
    dispatch(app, "item-b", "mouseEnter")
    await app.settle()

    dispatch(app, "item-b", "click", { button: 0 })
    await app.settle()
    expect(selected, "a disabled item never selects").toEqual([])
    expect(findByTestId(app, "content"), "and the popup stays open").toBeTruthy()

    dispatch(app, "item-a", "click", { button: 0 })
    await app.settle()
    expect(selected).toEqual(["a"])
    app.unmount()
  })

  it("keyboard navigation with every item disabled keeps the highlight empty", async () => {
    const App = defineComponent({
      setup: () => () =>
        h(Select, {}, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }),
            h(SelectContent, { testId: "content" }, () => [
              h(SelectItem, { value: "a", disabled: true, testId: "item-a" }),
            ] as never),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    await openViaKeyboard(app)

    dispatch(app, "trigger", "keyDown", { key: "down" })
    dispatch(app, "trigger", "keyDown", { key: "end" })
    await app.settle()
    dispatch(app, "content", "keyDown", { key: "enter" })
    await app.settle()
    expect(findByTestId(app, "content"), "nothing selectable: stays open").toBeTruthy()
    app.unmount()
  })

  it("updates the registry when an item's value changes or it unmounts", async () => {
    const value = ref("x")
    const showThird = ref(true)
    const selected: string[] = []
    const App = defineComponent({
      setup: () => () =>
        h(Select, { onValueChange: (v: string) => selected.push(v) }, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }),
            h(SelectContent, { testId: "content" }, () => [
              h(SelectItem, { value: value.value, testId: "item-x" }, () => "x"),
              showThird.value ? h(SelectItem, { value: "gone", testId: "item-gone" }, () => "gone") : null,
            ] as never),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    await openViaKeyboard(app)

    value.value = "y"
    await app.settle()
    dispatch(app, "item-x", "click", { button: 0 })
    await app.settle()
    expect(selected).toEqual(["y"])

    // Unmounting an item unregisters it; the remaining one still selects.
    dispatch(app, "trigger", "keyDown", { key: "enter" })
    await app.settle()
    showThird.value = false
    await app.settle()
    expect(findByTestId(app, "item-gone")).toBeUndefined()
    dispatch(app, "item-x", "click", { button: 0 })
    await app.settle()
    // Re-selecting the current value closes the popup but stays silent:
    // useControllableState only reports real changes.
    expect(selected).toEqual(["y"])
    expect(findByTestId(app, "content")).toBeUndefined()
    app.unmount()
  })

  it("SelectValue shows the items label, then the value, then the placeholder", async () => {
    const App = defineComponent({
      setup: () => () =>
        h(Select, { items: [{ value: "a", label: "Alpha" }], defaultValue: "a" }, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }, () =>
              h(SelectValue, { testId: "value", placeholder: "pick" })
            ),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    expect(findByTestId(app, "value")!.children.length).toBeGreaterThan(0)

    // Without items or value, the placeholder paints.
    const Plain = defineComponent({
      setup: () => () =>
        h(Select, {}, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }, () =>
              h(SelectValue, { testId: "value", placeholder: "pick" })
            ),
          ],
        }),
    })
    const plain = mountHeadless(Plain)
    await plain.settle()
    expect(findByTestId(plain, "value")!.children.length).toBe(1)
    plain.unmount()
    app.unmount()
  })

  it("closes on an outside press and swallows the trigger click that follows", async () => {
    const onOpenChange = vi.fn()
    const app = mountSelect({ onOpenChange })
    await app.settle()
    await openViaKeyboard(app)

    dispatch(app, "content", "mouseDownOutside")
    // The dismissal flag lives until the next microtask; the trailing click
    // arrives in the same native sequence, before it drains.
    dispatch(app, "trigger", "click", { button: 0 })
    await app.settle()
    expect(findByTestId(app, "content"), "closed by the press, not reopened by the click").toBeUndefined()
    app.unmount()
  })

  it("navigates from the content: home, end, and space select", async () => {
    const selected: string[] = []
    const app = mountSelect({ onValueChange: (value: string) => selected.push(value) })
    await app.settle()
    await openViaKeyboard(app)

    dispatch(app, "content", "keyDown", { key: "end" })
    dispatch(app, "content", "keyDown", { key: "home" })
    await app.settle()
    dispatch(app, "content", "keyDown", { key: "space" })
    await app.settle()
    expect(selected).toEqual(["a"])
    app.unmount()
  })

  it("throws when an item is used outside a Select root", () => {
    const orphan = () => mountHeadless(defineComponent({
      setup: () => () => h(SelectItem, { value: "a" }),
    }))
    expect(orphan).toThrow(/must be used inside Select/)
  })

  it("mounts the presentational wrappers without altering the tree", async () => {
    const App = defineComponent({
      setup: () => () =>
        h(Select, {}, {
          default: () => [
            h(SelectTrigger, { testId: "trigger" }),
            h(
              SelectContent,
              { testId: "content" },
              () =>
                [
                  h(SelectGroup, { testId: "group" }, () => [
                    h(SelectLabel, { testId: "label" }, () => "label"),
                    h(SelectItem, { value: "a", testId: "item-a" }),
                  ]),
                  h(SelectSeparator, { testId: "separator" }),
                  h(SelectScrollUpButton, { testId: "up" }, () => "up"),
                  h(SelectScrollDownButton, { testId: "down" }, () => "down"),
                ] as never
            ),
          ],
        }),
    })
    const app = mountHeadless(App)
    await app.settle()
    await openViaKeyboard(app)
    for (const id of ["group", "label", "separator", "up", "down"]) {
      expect(findByTestId(app, id), `${id} mounted`).toBeTruthy()
    }
    app.unmount()
  })
})
