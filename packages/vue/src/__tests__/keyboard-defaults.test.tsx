/** Keyboard defaults: Tab / Shift+Tab move focus, Escape closes the top
 *  dismiss layer, and any handler can cancel a default with preventDefault().
 *
 *  One keystroke's element events and its trailing window event share the
 *  keystroke id, so `preventDefault` / `stopPropagation` apply across them like
 *  one DOM event bubbling to window. Ported from upstream's render suite
 *  (remorses/gpuix `cff4907`, the keyboard half). */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const label = (event: { key?: string; modifiers?: { shift: boolean } | null }) =>
  `${event.modifiers?.shift ? "shift-" : ""}${event.key}`

describeNative("keyboard defaults (vue)", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("moves focus on Tab unless a key handler prevents it", async () => {
    const log: string[] = []
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{ width: 300, height: 200, display: "flex", flexDirection: "column" }}
          onKeyDown={(event) => log.push(`parent:${label(event)}`)}
        >
          <div
            testId="first"
            autoFocus
            tabIndex={0}
            style={{ width: 100, height: 50 }}
            onKeyDown={(event) => log.push(`first:${label(event)}`)}
          />
          <div
            testId="second"
            tabIndex={0}
            style={{ width: 100, height: 50 }}
            onKeyDown={(event) => {
              log.push(`second:${label(event)}`)
              // An editor takes Tab. Shift+Tab stays the default.
              if (event.key === "tab" && !event.modifiers?.shift) event.preventDefault()
              if (event.key === "x") event.stopPropagation()
            }}
          />
        </div>
      ),
    })
    app = createTestApp(App, {
      onKeyDown: (event) => log.push(`window:${label(event)} prevented=${event.defaultPrevented}`),
    })
    await app.settle()
    const first = app.renderer.findByTestId("first").id
    const second = app.renderer.findByTestId("second").id
    expect(app.renderer.getFocusedElementId()).toBe(first)

    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(second)

    // The second element prevented its Tab: focus stays.
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(second)

    // stopPropagation skips ancestors and the window handler; the default
    // action still runs ("x" has none).
    app.renderer.simulateKeystrokes("x")
    await app.settle()

    // Only the plain Tab was prevented: Shift+Tab still moves.
    app.renderer.simulateKeystrokes("shift-tab")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(first)

    expect(log.join("\n")).toBe(
      [
        "first:tab",
        "parent:tab",
        "window:tab prevented=false",
        "second:tab",
        "parent:tab",
        "window:tab prevented=true",
        "second:x",
        "second:shift-tab",
        "parent:shift-tab",
        "window:shift-tab prevented=false",
      ].join("\n"),
    )
  })

  it("leaves Tab alone when tabNavigation is false", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 300, height: 200, display: "flex", flexDirection: "column" }}>
          <div testId="first" autoFocus tabIndex={0} style={{ width: 100, height: 50 }} />
          <div testId="second" tabIndex={0} style={{ width: 100, height: 50 }} />
        </div>
      ),
    })
    app = createTestApp(App, { tabNavigation: false })
    await app.settle()
    const focused = app.renderer.getFocusedElementId()
    expect(focused).not.toBeNull()

    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(focused)
  })

  it("Escape closes only the top dismiss layer", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <Select defaultOpen>
            <SelectTrigger style={{ width: 180, height: 36 }} autoFocus testId="trigger">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent style={{ width: 180, padding: 4 }}>
              <SelectItem value="alpha">Alpha</SelectItem>
            </SelectContent>
          </Select>
          <Tooltip defaultOpen>
            <TooltipTrigger style={{ width: 100, height: 30 }}>tip source</TooltipTrigger>
            <TooltipContent style={{ padding: 4 }}>the tooltip</TooltipContent>
          </Tooltip>
        </div>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    const texts = app.renderer.getAllText()
    expect(texts).toContain("Alpha")
    expect(texts).toContain("the tooltip")

    // The tooltip opened last: one Escape closes it alone.
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    let after = app.renderer.getAllText()
    expect(after).not.toContain("the tooltip")
    expect(after).toContain("Alpha")

    // A second Escape closes the Select popup.
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    after = app.renderer.getAllText()
    expect(after).not.toContain("Alpha")
  })

  it("the Select popup traps Tab while open", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <Select defaultOpen>
            <SelectTrigger style={{ width: 180, height: 36 }} testId="trigger">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent style={{ width: 180, padding: 4 }} testId="content">
              <SelectItem value="alpha">Alpha</SelectItem>
            </SelectContent>
          </Select>
          <div testId="after" tabIndex={0} style={{ width: 100, height: 30 }} />
        </div>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    const content = app.renderer.findByTestId("content").id
    expect(app.renderer.getFocusedElementId()).toBe(content)

    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    // The popup is modal: focus stays, the menu stays open.
    expect(app.renderer.getFocusedElementId()).toBe(content)
    expect(app.renderer.getAllText()).toContain("Alpha")
  })

  it("a prevented Tab keeps the Combobox open; a moving Tab closes it", async () => {
    const Kept = defineComponent({
      setup: () => () => (
        <div
          style={{ width: 400, height: 300, padding: 12 }}
          onKeyDown={(event) => {
            if (event.key === "tab") event.preventDefault()
          }}
        >
          <Combobox items={["alpha"]}>
            <ComboboxInput placeholder="search" style={{ width: 200, height: 32 }} testId="input" />
            <ComboboxContent style={{ width: 200, padding: 4 }}>
              <ComboboxList renderItem={(item) => <ComboboxItem value={item}>{item}</ComboboxItem>} />
            </ComboboxContent>
          </Combobox>
          <div tabIndex={0} style={{ width: 100, height: 30 }} />
        </div>
      ),
    })
    app = createTestApp(Kept)
    await app.settle()
    const input = app.renderer.findByTestId("input").id
    // Focus opens the popup (the input's own autoFocus waits for open).
    app.renderer.focusElement(input)
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(input)
    expect(app.renderer.getAllText()).toContain("alpha")

    // The ancestor prevented the Tab default: focus never leaves the input,
    // so no blur fires and the popup stays open.
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(app.renderer.getFocusedElementId()).toBe(input)
    expect(app.renderer.getAllText()).toContain("alpha")
    app.unmount()

    const Moving = defineComponent({
      setup: () => () => (
        <div style={{ width: 400, height: 300, padding: 12 }}>
          <Combobox items={["alpha"]}>
            <ComboboxInput placeholder="search" style={{ width: 200, height: 32 }} testId="input" />
            <ComboboxContent style={{ width: 200, padding: 4 }}>
              <ComboboxList renderItem={(item) => <ComboboxItem value={item}>{item}</ComboboxItem>} />
            </ComboboxContent>
          </Combobox>
          <div testId="after" tabIndex={0} style={{ width: 100, height: 30 }} />
        </div>
      ),
    })
    app = createTestApp(Moving)
    await app.settle()
    const movingInput = app.renderer.findByTestId("input").id
    app.renderer.focusElement(movingInput)
    await app.settle()
    expect(app.renderer.getAllText()).toContain("alpha")

    // Unprevented: the Tab default moves focus, the input blurs, the popup
    // closes.
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(app.renderer.getAllText()).not.toContain("alpha")
  })
})
