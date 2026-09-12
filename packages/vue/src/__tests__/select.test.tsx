/** GPU-backed tests for the headless Select (Vue), ported from upstream's
 *  floating-controls suite (remorses/gpuix `846de94`, the Select half). */

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "../index.js"
import type { SelectItemState } from "../index.js"
import type { StyleDesc } from "../types.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const triggerStyle: StyleDesc = {
  width: 180,
  height: 36,
  padding: 8,
  backgroundColor: "#27324a",
  color: "#ffffff",
}

const contentStyle: StyleDesc = {
  width: 180,
  maxHeight: 150,
  overflowY: "scroll",
  padding: 4,
  backgroundColor: "#111827",
  color: "#ffffff",
}

const itemStyle = ({ highlighted, selected, disabled }: SelectItemState): StyleDesc => ({
  height: 32,
  padding: 6,
  opacity: disabled ? 0.4 : 1,
  backgroundColor: highlighted ? "#334155" : selected ? "#1e3a5f" : "#111827",
})

describeNative("select (vue)", () => {
  it("composes a headless Select and supports keyboard selection", async () => {
    const items = [
      { value: "alpha", label: "Alpha" },
      { value: "disabled", label: "Disabled" },
      { value: "beta", label: "Beta" },
    ]
    const value = ref("alpha")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 300, padding: 12 }}>
            <Select items={items} value={value.value} onValueChange={(next) => (value.value = next)}>
              <SelectTrigger style={triggerStyle}>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent side="bottom" sideOffset={4} style={contentStyle}>
                <SelectGroup>
                  <SelectLabel style={{ height: 24 }}>Models</SelectLabel>
                  <SelectItem value="alpha" style={itemStyle}>Alpha</SelectItem>
                  <SelectItem value="disabled" disabled style={itemStyle}>Disabled</SelectItem>
                  <SelectSeparator style={{ height: 1, backgroundColor: "#475569" }} />
                  <SelectItem value="beta" style={itemStyle}>Beta</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["Alpha", "Value: alpha"])

    app.renderer.nativeSimulateClick(30, 25)
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Beta")

    // down skips the disabled item; enter selects beta.
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["Beta", "Value: beta"])
    app.unmount()
  })

  it("selects from children when Root has no items", async () => {
    const value = ref("one")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 300, padding: 12 }}>
            <Select value={value.value} onValueChange={(next) => (value.value = next)}>
              <SelectTrigger style={triggerStyle}>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                <SelectItem value="one" style={itemStyle}>One</SelectItem>
                <SelectItem value="two" style={itemStyle}>Two</SelectItem>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["one", "Value: one"])

    app.renderer.nativeSimulateClick(30, 25)
    await app.settle()
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["two", "Value: two"])
    app.unmount()
  })

  it("keeps SelectValue working when items are wrapped components", async () => {
    const items = [
      { value: "one", label: "One" },
      { value: "two", label: "Two" },
    ]
    const StyledItem = defineComponent({
      props: { value: { type: String, required: true } },
      setup(props, { slots }) {
        return () => (
          <SelectItem value={props.value} style={itemStyle}>
            {slots.default?.()}
          </SelectItem>
        )
      },
    })
    const value = ref("one")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 300, padding: 12 }}>
            <Select items={items} value={value.value} onValueChange={(next) => (value.value = next)}>
              <SelectTrigger style={triggerStyle}>
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                <StyledItem value="one">One</StyledItem>
                <StyledItem value="two">Two</StyledItem>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["One", "Value: one"])

    app.renderer.nativeSimulateClick(30, 25)
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Two")
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["Two", "Value: two"])
    app.unmount()
  })

  it("does not select a highlighted item after it unmounts", async () => {
    const value = ref("one")
    const showTwo = ref(true)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 320, padding: 12 }}>
            <Select value={value.value} onValueChange={(next) => (value.value = next)} defaultOpen>
              <SelectTrigger style={triggerStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                <SelectItem value="one" style={itemStyle}>One</SelectItem>
                {showTwo.value ? (
                  <SelectItem value="two" style={itemStyle}>Two</SelectItem>
                ) : null}
                <div
                  testId="hide-two"
                  style={{ height: 24, backgroundColor: "#334155" }}
                  onClick={() => (showTwo.value = false)}
                >
                  Hide
                </div>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    const hide = app.renderer.findByTestId("hide-two")
    expect(hide).toBeDefined()
    const bounds = app.renderer.getElementBounds(hide!.id)!
    app.renderer.nativeSimulateClick(bounds.x + 8, bounds.y + 8)
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Value: one")
    app.unmount()
  })

  it("highlights a selected item that mounts after the popup is open", async () => {
    const value = ref("one")
    const showOne = ref(false)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 320, padding: 12 }}>
            <Select value={value.value} onValueChange={(next) => (value.value = next)} defaultOpen>
              <SelectTrigger style={triggerStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                {showOne.value ? (
                  <SelectItem value="one" style={itemStyle}>One</SelectItem>
                ) : null}
                <SelectItem value="two" style={itemStyle}>Two</SelectItem>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    showOne.value = true
    await app.settle()
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Value: two")
    app.unmount()
  })

  it("keeps keyboard order when a middle item re-renders alone", async () => {
    const value = ref("one")
    const tick = ref(0)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 340, padding: 12 }}>
            <Select value={value.value} onValueChange={(next) => (value.value = next)} defaultOpen>
              <SelectTrigger style={triggerStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                <SelectItem value="one" style={itemStyle}>One</SelectItem>
                <SelectItem value="two" style={itemStyle}>{`Two ${tick.value}`}</SelectItem>
                <SelectItem value="three" style={itemStyle}>Three</SelectItem>
                <div
                  testId="nudge"
                  style={{ height: 24, backgroundColor: "#334155" }}
                  onClick={() => (tick.value += 1)}
                >
                  Nudge
                </div>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const nudge = app.renderer.findByTestId("nudge")
    expect(nudge).toBeDefined()
    const bounds = app.renderer.getElementBounds(nudge!.id)!
    app.renderer.nativeSimulateClick(bounds.x + 8, bounds.y + 8)
    await app.settle()
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Value: two")
    app.unmount()
  })

  it("does not select from a disabled open Select", async () => {
    const value = ref("one")
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 300, padding: 12 }}>
            <Select
              disabled
              defaultOpen
              value={value.value}
              onValueChange={(next) => (value.value = next)}
            >
              <SelectTrigger style={triggerStyle}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent sideOffset={4} style={contentStyle}>
                <SelectItem value="one" style={itemStyle}>One</SelectItem>
                <SelectItem value="two" testId="two" style={itemStyle}>Two</SelectItem>
              </SelectContent>
            </Select>
            <text>{`Value: ${value.value}`}</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const two = app.renderer.findByTestId("two")
    expect(two).toBeDefined()
    const twoBounds = app.renderer.getElementBounds(two!.id)!
    app.renderer.nativeSimulateClick(twoBounds.x + 8, twoBounds.y + 8)
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Value: one")
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(app.renderer.getAllText()).toContain("Value: one")
    app.unmount()
  })
})
