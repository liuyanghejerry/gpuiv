/// Headless logic tests for the Select primitives: open/close toggling,
/// keyboard navigation, selection, disabled items, and the label registry.
/// Runs against the mock renderer (see headless.ts) so it works on Linux.

import { defineComponent, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.js"
import { mountHeadless } from "./headless.js"

function SelectPlayground(props: {
  value?: string
  onValueChange?: (v: string) => void
  disabled?: boolean
  items: { value: string; disabled?: boolean; label: string }[]
  onOpenChange?: (open: boolean) => void
}) {
  return defineComponent({
    setup() {
      return () => (
        <Select
          items={props.items}
          value={props.value}
          onValueChange={props.onValueChange}
          disabled={props.disabled}
          onOpenChange={props.onOpenChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="pick one" />
          </SelectTrigger>
          <SelectContent>
            {props.items.map((item) => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    },
  })
}

type HeadlessApp = ReturnType<typeof mountHeadless>

/** Dispatch an event on the nearest ancestor of the painted text that listens
 *  for it — what native hit-testing would do for a press on that text. */
function dispatchOnText(
  app: HeadlessApp,
  text: string,
  type: string,
  extra: Record<string, unknown> = {}
): boolean {
  const painted = app.renderer.idsWithText(text)[0]
  if (painted === undefined) throw new Error(`no element paints ${JSON.stringify(text)}`)
  const target = app.renderer.closestWithListener(painted, type)
  if (target === null) throw new Error(`no ancestor of ${JSON.stringify(text)} listens for ${type}`)
  return app.dispatch({ elementId: target, eventType: type, ...extra })
}

/** Dispatch a key event on the popup's content layer (focused while open),
 *  found by walking up from a painted item. */
function keyOnContent(app: HeadlessApp, key: string, extra: Record<string, unknown> = {}) {
  const painted = app.renderer.idsWithText("Apple")[0]
  const target = app.renderer.closestWithListener(painted, "keyDown")
  if (target === null) throw new Error("no content layer keyDown listener")
  return app.dispatch({ elementId: target, eventType: "keyDown", key, ...extra })
}

const FRUITS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry", disabled: true },
]

async function openMenu(app: HeadlessApp) {
  dispatchOnText(app, "pick one", "click")
  await app.settle()
}

describe("Select (headless)", () => {
  it("renders the placeholder while no value is selected", () => {
    const app = mountHeadless(SelectPlayground({ items: FRUITS }))
    expect(app.renderer.allTexts()).toContain("pick one")
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("toggles the popup on trigger clicks and reports onOpenChange", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onOpenChange }))

    dispatchOnText(app, "pick one", "click")
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(app.renderer.allTexts()).toContain("Apple")

    dispatchOnText(app, "pick one", "click")
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("a press-and-release while open closes without reopening", async () => {
    const app = mountHeadless(SelectPlayground({ items: FRUITS }))
    await openMenu(app)
    expect(app.renderer.allTexts()).toContain("Apple")

    // Second open cycle: mouseDown marks press-while-open, the click then closes.
    dispatchOnText(app, "pick one", "mouseDown")
    dispatchOnText(app, "pick one", "click")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("selects an item on click, fires onValueChange, closes, and shows the label", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))
    await openMenu(app)

    dispatchOnText(app, "Banana", "click")
    await app.settle()

    expect(onValueChange).toHaveBeenCalledWith("banana")
    expect(app.renderer.allTexts()).toContain("Banana")
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("keyboard: down opens via the trigger, navigation and enter happen on the content", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))

    dispatchOnText(app, "pick one", "keyDown", { key: "down" })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")

    // The open popup owns key handling; enter picks the highlighted item.
    // Opening via the trigger highlights nothing, so down twice reaches banana.
    keyOnContent(app, "down")
    await app.settle()
    keyOnContent(app, "down")
    await app.settle()
    keyOnContent(app, "enter")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("banana")
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("keyboard: home/end jump to the first and last enabled item, skipping disabled", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))
    await openMenu(app)

    keyOnContent(app, "end")
    await app.settle()
    keyOnContent(app, "enter")
    await app.settle()
    // cherry is disabled; the last enabled item is banana.
    expect(onValueChange).toHaveBeenCalledWith("banana")
    app.unmount()
  })

  it("keyboard: ctrl+n / ctrl+p move through enabled items", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))
    await openMenu(app)

    keyOnContent(app, "n", { modifiers: { ctrl: true } })
    keyOnContent(app, "n", { modifiers: { ctrl: true } })
    await app.settle()
    keyOnContent(app, "p", { modifiers: { ctrl: true } })
    await app.settle()
    keyOnContent(app, "enter")
    await app.settle()
    // apple → banana → (back to) apple
    expect(onValueChange).toHaveBeenCalledWith("apple")
    app.unmount()
  })

  it("keyboard: home on a closed trigger does nothing to navigation", async () => {
    const app = mountHeadless(SelectPlayground({ items: FRUITS }))
    dispatchOnText(app, "pick one", "keyDown", { key: "home" })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("escape on the content closes an open menu and reports onEscapeKeyDown", async () => {
    const onEscape = vi.fn()
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Select items={FRUITS} onOpenChange={onOpenChange}>
            <SelectTrigger><SelectValue placeholder="pick one" /></SelectTrigger>
            <SelectContent onEscapeKeyDown={onEscape}>
              {FRUITS.map((item) => (
                <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      })
    )
    await openMenu(app)

    keyOnContent(app, "escape")
    await app.settle()
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    app.unmount()
  })

  it("enter/space on a closed trigger opens the menu", async () => {
    const app = mountHeadless(SelectPlayground({ items: FRUITS }))
    dispatchOnText(app, "pick one", "keyDown", { key: "enter" })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")

    dispatchOnText(app, "pick one", "keyDown", { key: "space" })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("a disabled Select ignores every interaction", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      SelectPlayground({ items: FRUITS, disabled: true, onValueChange })
    )

    dispatchOnText(app, "pick one", "click")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")

    dispatchOnText(app, "pick one", "keyDown", { key: "enter" })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    expect(onValueChange).not.toHaveBeenCalled()
    app.unmount()
  })

  it("mouseEnter highlights, and clicking a disabled item selects nothing", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))
    await openMenu(app)

    dispatchOnText(app, "Cherry", "mouseEnter")
    await app.settle()
    dispatchOnText(app, "Cherry", "click")
    await app.settle()
    expect(onValueChange).not.toHaveBeenCalled()

    dispatchOnText(app, "Apple", "mouseEnter")
    await app.settle()
    dispatchOnText(app, "Apple", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("apple")
    app.unmount()
  })

  it("outside mouseDown closes the menu and marks the dismissal", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onOpenChange }))
    await openMenu(app)

    const contentLayer = app.renderer
      .opsOf("setEventListener")
      .filter((op) => op[2] === "mouseDownOutside")
      .map((op) => op[1] as number)
    expect(contentLayer.length).toBeGreaterThan(0)
    app.dispatch({ elementId: contentLayer[0], eventType: "mouseDownOutside" })
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("SelectValue falls back through items label, value, and placeholder", async () => {
    const Controlled = defineComponent({
      setup() {
        const value = ref<string | undefined>("banana")
        return () => (
          <Select
            items={[{ value: "banana", label: "Banana" }]}
            value={value.value}
            onValueChange={(v) => (value.value = v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="empty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="banana">slot label</SelectItem>
            </SelectContent>
          </Select>
        )
      },
    })
    const app = mountHeadless(Controlled)
    // While closed the label comes from the items registry, not the slot.
    expect(app.renderer.allTexts()).toContain("Banana")

    // Open and pick via the item: the slot label paints while open.
    dispatchOnText(app, "Banana", "click")
    await app.settle()
    dispatchOnText(app, "slot label", "click")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Banana")
    app.unmount()
  })

  it("selecting restores focus to the trigger", async () => {
    const app = mountHeadless(SelectPlayground({ items: FRUITS }))
    await openMenu(app)
    expect(app.renderer.focusedElementId).toBeNull()

    dispatchOnText(app, "Apple", "click")
    await app.settle()
    expect(app.renderer.focusedElementId).not.toBeNull()
    app.unmount()
  })

  it("throws when a part is used outside Select", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() =>
      mountHeadless(
        defineComponent({
          setup: () => () => <SelectTrigger>lonely</SelectTrigger>,
        })
      )
    ).toThrow(/must be used inside Select/)
    consoleWarn.mockRestore()
  })

  it("registerItem keeps mount order across re-renders", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(SelectPlayground({ items: FRUITS, onValueChange }))
    await openMenu(app)
    // One down highlights the first registered item; registration order is
    // mount order, so apple is first even though cherry mounted after banana.
    keyOnContent(app, "down")
    await app.settle()
    keyOnContent(app, "enter")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("apple")
    app.unmount()
  })
})
