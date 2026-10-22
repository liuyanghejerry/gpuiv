/// Headless logic tests for the Combobox primitives: open/close toggling,
/// type-to-filter with prefix-first ranking, keyboard navigation that skips
/// disabled items, single and multiple selection, controlled values, and the
/// group/empty chrome. Runs against the mock renderer (see headless.ts) so it
/// works without a GPU test renderer.

import { defineComponent, ref } from "vue"
import type { Ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "../components/combobox.js"
import { mountHeadless } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

interface PlaygroundOptions {
  items?: readonly string[]
  disabledItem?: string
  value?: string | string[] | null
  valueRef?: Ref<string | string[] | null>
  onValueChange?: (value: string | string[] | null) => void
  multiple?: boolean
  disabled?: boolean
  disabledTrigger?: boolean
  autoHighlight?: boolean | "always"
  filter?: null | ((item: string, query: string, itemToString: (item: string) => string) => boolean)
  itemToStringValue?: (item: string) => string
  defaultOpen?: boolean
  openRef?: Ref<boolean>
  onOpenChange?: (open: boolean) => void
  onInputValueChange?: (value: string) => void
}

const itemStyle = (state: { highlighted: boolean; disabled: boolean }) => ({
  backgroundColor: state.highlighted ? "#ffd700" : undefined,
  opacity: state.disabled ? 0.5 : 1,
})

function ComboboxPlayground(options: PlaygroundOptions = {}) {
  const items = options.items ?? ["Apple", "Apricot", "Banana", "Cherry"]
  const labelOf = options.itemToStringValue ?? ((item: string) => item)
  return defineComponent({
    setup() {
      return () => (
        <Combobox
          items={items}
          value={options.valueRef ? options.valueRef.value : options.value}
          onValueChange={options.onValueChange}
          multiple={options.multiple}
          disabled={options.disabled}
          autoHighlight={options.autoHighlight}
          filter={options.filter}
          itemToStringValue={options.itemToStringValue}
          defaultOpen={options.defaultOpen}
          open={options.openRef ? options.openRef.value : undefined}
          onOpenChange={options.onOpenChange}
          onInputValueChange={options.onInputValueChange}
        >
          <ComboboxInput placeholder="pick one" />
          <ComboboxTrigger disabled={options.disabledTrigger}>
            <div>Toggle</div>
          </ComboboxTrigger>
          <ComboboxValue placeholder="pick one" />
          <ComboboxContent>
            <ComboboxGroup>
              <ComboboxLabel>Fruits</ComboboxLabel>
              <ComboboxSeparator />
              <ComboboxList renderItem={renderItem} />
            </ComboboxGroup>
            <ComboboxEmpty>no results</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      )
    },
  })

  function renderItem(item: string) {
    return (
      <ComboboxItem
        key={item}
        value={item}
        disabled={item === options.disabledItem}
        style={itemStyle}
      >
        {labelOf(item)}
      </ComboboxItem>
    )
  }
}

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

function inputIdOf(app: HeadlessApp): number {
  const created = app.renderer
    .opsOf("createElement")
    .find((op) => op[2] === "input")
  if (created === undefined) throw new Error("no input element was created")
  return created[1] as number
}

function customPropOf(app: HeadlessApp, elementId: number, key: string): unknown {
  const ops = app.renderer
    .opsOf("setCustomProp")
    .filter((op) => op[1] === elementId && op[2] === key)
  return ops.length > 0 ? ops[ops.length - 1][3] : undefined
}

function itemElementIdOf(app: HeadlessApp, label: string): number {
  const painted = app.renderer.idsWithText(label)[0]
  if (painted === undefined) throw new Error(`no element paints ${JSON.stringify(label)}`)
  const parent = app.renderer.parentOf(painted)
  if (parent === undefined) throw new Error(`${JSON.stringify(label)} has no parent element`)
  return parent
}

function itemStyleOf(app: HeadlessApp, label: string) {
  return app.renderer.lastStyle(itemElementIdOf(app, label))
}

async function openByInput(app: HeadlessApp) {
  app.dispatch({ elementId: inputIdOf(app), eventType: "click" })
  await app.settle()
}

function typeInto(app: HeadlessApp, value: string): boolean {
  return app.dispatch({ elementId: inputIdOf(app), eventType: "change", value })
}

function keyOnInput(
  app: HeadlessApp,
  key: string,
  extra: Record<string, unknown> = {}
): boolean {
  return app.dispatch({ elementId: inputIdOf(app), eventType: "keyDown", key, ...extra })
}

function submitOnInput(app: HeadlessApp): boolean {
  return app.dispatch({ elementId: inputIdOf(app), eventType: "submit" })
}

describe("Combobox (headless)", () => {
  it("renders the placeholder and no items while closed", () => {
    const app = mountHeadless(ComboboxPlayground())
    expect(app.renderer.allTexts()).toContain("pick one")
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()

    // items defaults to an empty list.
    const empty = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox>
            <ComboboxValue placeholder="empty" />
          </Combobox>
        ),
      })
    )
    expect(empty.renderer.allTexts()).toContain("empty")
    empty.unmount()
  })

  it("clicking the input opens the list, focuses the input, and reports onOpenChange", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ onOpenChange }))
    await openByInput(app)

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(app.renderer.allTexts()).toContain("Apple")
    expect(app.renderer.allTexts()).toContain("Fruits")
    expect(app.renderer.focusedElementId).toBe(inputIdOf(app))

    // The popup anchors below the input by default.
    const anchored = app.renderer
      .opsOf("createElement")
      .find((op) => op[2] === "anchored")
    expect(anchored).toBeDefined()
    expect(customPropOf(app, anchored![1] as number, "side")).toBe("bottom")
    app.unmount()
  })

  it("focusing the input opens the list", async () => {
    const app = mountHeadless(ComboboxPlayground())
    app.dispatch({ elementId: inputIdOf(app), eventType: "focus" })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")
    app.unmount()
  })

  it("the trigger toggles the list open and closed", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ onOpenChange }))

    dispatchOnText(app, "Toggle", "click")
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(app.renderer.allTexts()).toContain("Apple")

    dispatchOnText(app, "Toggle", "click")
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("trigger keys: down and up open, escape closes", async () => {
    const app = mountHeadless(ComboboxPlayground())
    dispatchOnText(app, "Toggle", "keyDown", { key: "down" })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")

    dispatchOnText(app, "Toggle", "keyDown", { key: "escape" })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")

    dispatchOnText(app, "Toggle", "keyDown", { key: "up" })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")
    app.unmount()
  })

  it("escape on the input closes without selecting the highlighted item", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ onValueChange }))
    await openByInput(app)

    keyOnInput(app, "down")
    await app.settle()
    keyOnInput(app, "escape")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    expect(onValueChange).not.toHaveBeenCalled()
    app.unmount()
  })

  it("typing filters by prefix, shows the empty state, and navigation on an empty list is inert", async () => {
    const onInputValueChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ onInputValueChange }))
    await openByInput(app)

    typeInto(app, "ap")
    await app.settle()
    expect(onInputValueChange).toHaveBeenLastCalledWith("ap")
    expect(app.renderer.allTexts()).toContain("Apple")
    expect(app.renderer.allTexts()).toContain("Apricot")
    expect(app.renderer.allTexts()).not.toContain("Banana")

    typeInto(app, "zzz")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("no results")
    expect(app.renderer.allTexts()).not.toContain("Apple")

    // moveActive returns early when the filtered list is empty.
    keyOnInput(app, "down")
    submitOnInput(app)
    await app.settle()
    expect(onInputValueChange).toHaveBeenLastCalledWith("zzz")
    app.unmount()
  })

  it("prefix matches rank ahead of substring matches regardless of item order", async () => {
    const app = mountHeadless(
      ComboboxPlayground({ items: ["Banana", "Apple", "Apricot"] })
    )
    // Typing while closed mounts the filtered list fresh, so the insertion
    // order in the mock is the filtered order.
    typeInto(app, "a")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Banana")

    const list = app.renderer.parentOf(itemElementIdOf(app, "Apple"))
    const order = ["Apple", "Apricot", "Banana"].map((label) =>
      app.renderer.childrenOf(list as number).indexOf(itemElementIdOf(app, label))
    )
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    app.unmount()
  })

  it("a custom filter receives the item, query, and label fn and decides membership", async () => {
    const filter = vi.fn(
      (item: string, query: string) => item.toLowerCase().startsWith(query.toLowerCase())
    )
    const app = mountHeadless(ComboboxPlayground({ items: ["Apple", "Banana"], filter }))
    await openByInput(app)

    typeInto(app, "ban")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Banana")
    expect(app.renderer.allTexts()).not.toContain("Apple")
    expect(filter).toHaveBeenCalledWith("Banana", "ban", expect.any(Function))
    app.unmount()
  })

  it("a null filter keeps every item for any query", async () => {
    const app = mountHeadless(
      ComboboxPlayground({ items: ["Apple", "Banana"], filter: null })
    )
    await openByInput(app)
    typeInto(app, "zzz")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")
    expect(app.renderer.allTexts()).toContain("Banana")
    expect(app.renderer.allTexts()).not.toContain("no results")
    app.unmount()
  })

  it("down skips disabled items, wraps, and submit picks the highlighted item", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ items: ["Apple", "Banana", "Cherry"], disabledItem: "Banana", onValueChange })
    )
    await openByInput(app)

    keyOnInput(app, "down")
    await app.settle()
    expect(itemStyleOf(app, "Apple")?.backgroundColor).toBe("#ffd700")

    keyOnInput(app, "down")
    await app.settle()
    expect(itemStyleOf(app, "Cherry")?.backgroundColor).toBe("#ffd700")
    expect(itemStyleOf(app, "Apple")?.backgroundColor).toBeUndefined()
    expect(itemStyleOf(app, "Banana")?.opacity).toBe(0.5)

    keyOnInput(app, "down")
    await app.settle()
    expect(itemStyleOf(app, "Apple")?.backgroundColor).toBe("#ffd700")

    submitOnInput(app)
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Apple")
    expect(app.renderer.allTexts()).not.toContain("Cherry")
    expect(customPropOf(app, inputIdOf(app), "value")).toBe("Apple")
    app.unmount()
  })

  it("up from nothing highlights the last enabled item, skipping a disabled tail", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ items: ["Apple", "Banana", "Cherry"], disabledItem: "Cherry", onValueChange })
    )
    await openByInput(app)

    keyOnInput(app, "up")
    await app.settle()
    expect(itemStyleOf(app, "Banana")?.backgroundColor).toBe("#ffd700")

    submitOnInput(app)
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Banana")
    app.unmount()
  })

  it("ctrl+n / ctrl+p move through enabled items", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ items: ["Apple", "Banana", "Cherry"], disabledItem: "Banana", onValueChange })
    )
    await openByInput(app)

    keyOnInput(app, "n", { modifiers: { ctrl: true } })
    keyOnInput(app, "n", { modifiers: { ctrl: true } })
    await app.settle()
    expect(itemStyleOf(app, "Cherry")?.backgroundColor).toBe("#ffd700")

    keyOnInput(app, "p", { modifiers: { ctrl: true } })
    await app.settle()
    expect(itemStyleOf(app, "Apple")?.backgroundColor).toBe("#ffd700")

    submitOnInput(app)
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Apple")
    app.unmount()
  })

  it("mouseEnter highlights and click selects; disabled items ignore both", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ disabledItem: "Banana", onValueChange })
    )
    await openByInput(app)

    dispatchOnText(app, "Banana", "mouseEnter")
    await app.settle()
    expect(itemStyleOf(app, "Banana")?.backgroundColor).toBeUndefined()
    dispatchOnText(app, "Banana", "click")
    await app.settle()
    expect(onValueChange).not.toHaveBeenCalled()

    dispatchOnText(app, "Cherry", "mouseEnter")
    await app.settle()
    expect(itemStyleOf(app, "Cherry")?.backgroundColor).toBe("#ffd700")
    dispatchOnText(app, "Cherry", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Cherry")
    // The list closed and the value echoed into the input and the value slot.
    expect(app.renderer.allTexts()).not.toContain("Apple")
    expect(app.renderer.allTexts()).toContain("Cherry")
    expect(customPropOf(app, inputIdOf(app), "value")).toBe("Cherry")
    app.unmount()
  })

  it("multiple selection toggles items, clears the query, and keeps the list open", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ multiple: true, onValueChange }))
    await openByInput(app)

    dispatchOnText(app, "Apple", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenLastCalledWith(["Apple"])
    expect(app.renderer.allTexts()).toContain("Banana")

    dispatchOnText(app, "Cherry", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenLastCalledWith(["Apple", "Cherry"])
    expect(app.renderer.allTexts()).toContain("Apple, Cherry")
    expect(customPropOf(app, inputIdOf(app), "value")).toBe("")

    dispatchOnText(app, "Apple", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenLastCalledWith(["Cherry"])
    app.unmount()
  })

  it("a controlled value stays driven by the prop", async () => {
    const onValueChange = vi.fn()
    const value = ref<string | string[] | null>("Apple")
    const app = mountHeadless(ComboboxPlayground({ valueRef: value, onValueChange }))
    expect(app.renderer.allTexts()).toContain("Apple")

    await openByInput(app)
    dispatchOnText(app, "Cherry", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Cherry")
    expect(app.renderer.allTexts()).toContain("Apple")

    value.value = "Cherry"
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Cherry")
    app.unmount()
  })

  it("a controlled open stays driven by the prop", async () => {
    const onOpenChange = vi.fn()
    const open = ref(false)
    const app = mountHeadless(ComboboxPlayground({ openRef: open, onOpenChange }))

    app.dispatch({ elementId: inputIdOf(app), eventType: "click" })
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(app.renderer.allTexts()).not.toContain("Apple")

    open.value = true
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Apple")
    app.unmount()
  })

  it("autoHighlight highlights the first enabled match; a lone disabled match highlights nothing", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ autoHighlight: true, disabledItem: "Banana", onValueChange })
    )
    await openByInput(app)

    typeInto(app, "c")
    await app.settle()
    expect(itemStyleOf(app, "Cherry")?.backgroundColor).toBe("#ffd700")
    submitOnInput(app)
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Cherry")

    await openByInput(app)
    // Clear the echoed query so every item mounts and the disabled one
    // registers before the next filter run.
    typeInto(app, "")
    await app.settle()
    typeInto(app, "b")
    await app.settle()
    expect(itemStyleOf(app, "Banana")?.backgroundColor).toBeUndefined()
    submitOnInput(app)
    await app.settle()
    expect(onValueChange).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it("a disabled combobox never opens", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ disabled: true, onOpenChange }))

    app.dispatch({ elementId: inputIdOf(app), eventType: "click" })
    typeInto(app, "a")
    dispatchOnText(app, "Toggle", "click")
    dispatchOnText(app, "Toggle", "keyDown", { key: "down" })
    await app.settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("a disabled combobox renders its input read-only and guards selection", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({ disabled: true, defaultOpen: true, onValueChange })
    )
    expect(app.renderer.allTexts()).toContain("Apple")
    expect(customPropOf(app, inputIdOf(app), "readOnly")).toBe(true)

    dispatchOnText(app, "Banana", "click")
    await app.settle()
    expect(onValueChange).not.toHaveBeenCalled()
    app.unmount()
  })

  it("a trigger with its own disabled prop is inert while the input still opens", async () => {
    const app = mountHeadless(ComboboxPlayground({ disabledTrigger: true }))

    dispatchOnText(app, "Toggle", "click")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Apple")

    await openByInput(app)
    expect(app.renderer.allTexts()).toContain("Apple")
    app.unmount()
  })

  it("ComboboxValue falls back through the value and the placeholder", () => {
    // NOTE: the scoped-slot branch is dead code in Vue — `slot.length` is
    // always 0 because Vue normalizes slot functions to arity-0 wrappers
    // (combobox.tsx:380, a React idiom). Reported; not asserted here.
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox items={["Banana"]} value="Banana">
            <ComboboxValue placeholder="empty">
              {(value: string | string[] | null) => `chosen: ${value}`}
            </ComboboxValue>
          </Combobox>
        ),
      })
    )
    expect(app.renderer.allTexts()).toContain("Banana")
    app.unmount()

    const bare = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox items={["Banana"]}>
            <ComboboxValue placeholder="empty" />
          </Combobox>
        ),
      })
    )
    expect(bare.renderer.allTexts()).toContain("empty")
    bare.unmount()
  })

  it("itemToStringValue labels filtering, the echoed query, and the value", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      ComboboxPlayground({
        items: ["us", "fr"],
        itemToStringValue: (item) => item.toUpperCase(),
        onValueChange,
      })
    )
    await openByInput(app)

    typeInto(app, "US")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("US")
    expect(app.renderer.allTexts()).not.toContain("fr")

    dispatchOnText(app, "US", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("us")
    expect(customPropOf(app, inputIdOf(app), "value")).toBe("US")
    app.unmount()
  })

  it("mouseDownOutside on the content closes the list", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(ComboboxPlayground({ onOpenChange }))
    await openByInput(app)

    const layers = app.renderer
      .opsOf("setEventListener")
      .filter((op) => op[2] === "mouseDownOutside")
      .map((op) => op[1] as number)
    expect(layers.length).toBeGreaterThan(0)
    app.dispatch({ elementId: layers[0], eventType: "mouseDownOutside" })
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(app.renderer.allTexts()).not.toContain("Apple")
    app.unmount()
  })

  it("asChild merges the item onto its single child element", async () => {
    const onValueChange = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox items={["Apple", "Banana"]} defaultOpen onValueChange={onValueChange}>
            <ComboboxInput />
            <ComboboxContent>
              <ComboboxList>
                <ComboboxItem value="Apple" asChild>
                  <div>Apple row</div>
                </ComboboxItem>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        ),
      })
    )
    dispatchOnText(app, "Apple row", "click")
    await app.settle()
    expect(onValueChange).toHaveBeenCalledWith("Apple")
    app.unmount()
  })

  it("asChild without exactly one child element throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() =>
      mountHeadless(
        defineComponent({
          setup: () => () => (
            <Combobox items={["Apple"]} defaultOpen>
              <ComboboxContent>
                <ComboboxList
                  renderItem={(item) => <ComboboxItem key={item} value={item} asChild />}
                />
              </ComboboxContent>
            </Combobox>
          ),
        })
      )
    ).toThrow(/ComboboxItem asChild requires exactly one child element/)
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })

  it("throws when parts are used outside Combobox", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() =>
      mountHeadless(
        defineComponent({ setup: () => () => <ComboboxInput /> })
      )
    ).toThrow(/must be used inside Combobox/)
    expect(() =>
      mountHeadless(
        defineComponent({ setup: () => () => <ComboboxItem value="x" /> })
      )
    ).toThrow(/must be used inside Combobox/)
    consoleWarn.mockRestore()
  })

  it("user handlers on the input chain with the built-in ones", async () => {
    const onInputClick = vi.fn()
    const onInputKeyUp = vi.fn()
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox items={["Apple"]} onOpenChange={onOpenChange}>
            <ComboboxInput onClick={onInputClick} onKeyUp={onInputKeyUp} />
          </Combobox>
        ),
      })
    )
    const input = inputIdOf(app)

    app.dispatch({ elementId: input, eventType: "click" })
    await app.settle()
    expect(onInputClick).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)

    app.dispatch({ elementId: input, eventType: "keyUp", key: "a" })
    await app.settle()
    expect(onInputKeyUp).toHaveBeenCalledWith(expect.objectContaining({ key: "a" }))
    app.unmount()
  })

  it("user key handlers on the trigger chain with the built-in ones", async () => {
    const onKeyDown = vi.fn()
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Combobox items={["Apple"]} onOpenChange={onOpenChange}>
            <ComboboxTrigger onKeyDown={onKeyDown}>
              <div>Toggle</div>
            </ComboboxTrigger>
          </Combobox>
        ),
      })
    )
    dispatchOnText(app, "Toggle", "keyDown", { key: "down" })
    await app.settle()
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "down" }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
    app.unmount()
  })
})
