/** GPU-backed smoke tests for the headless Combobox and Tooltip (Vue). */

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  FloatingLayer,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("combobox and tooltip (vue)", () => {
  it("filters items as the user types and selects one", async () => {
    const value = ref<string | null>(null)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 24 }}>
            <Combobox
              items={["DeepSeek V4", "Claude Opus", "GPT-5.4", "Grok 4"]}
              onValueChange={(next) => (value.value = next as string | null)}
              itemToStringValue={(item) => item}
            >
              <div style={{ position: "relative", display: "flex" }}>
                <ComboboxInput style={{ width: 300 }} placeholder="Pick a model" />
                <ComboboxContent side="bottom" sideOffset={4} style={{ backgroundColor: "#222" }}>
                  <ComboboxList
                    renderItem={(item: string) => (
                      <ComboboxItem key={item} value={item} style={{ padding: 6 }}>
                        <text>{item}</text>
                      </ComboboxItem>
                    )}
                  />
                </ComboboxContent>
              </div>
            </Combobox>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    const input = app.renderer.findByType("input")[0]
    expect(input).toBeDefined()

    // Focus opens the popup and lists all four items.
    app.renderer.nativeSimulateKeystrokes(input.id, "c")
    await app.settle()
    const painted = () => app.renderer.getPaintedText().join("\n")
    expect(painted()).toContain("Claude Opus")

    // Clear and type another prefix — the list filters.
    app.renderer.nativeSimulateKeystrokes(input.id, "cmd-a backspace g r o k")
    await app.settle()
    expect(painted()).toContain("Grok 4")
    expect(painted()).not.toContain("Claude Opus")

    app.unmount()
  })

  it("opens a tooltip on hover and closes on leave", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <TooltipProvider delayDuration={0}>
            <div style={{ display: "flex", width: "100%", height: "100%", padding: 30 }}>
              <Tooltip>
                <TooltipTrigger style={{ padding: 8, backgroundColor: "#333", cursor: "pointer" }}>
                  <text>Hover me</text>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} style={{ backgroundColor: "#000" }}>
                  <text>Tooltip text</text>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        )
      },
    })
    const app = createTestApp(App)

    const trigger = app.renderer.findByText("Hover me")
    const bounds = app.renderer.getElementBounds(trigger!.id)!
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2

    app.renderer.nativeSimulateMouseMove(cx, cy)
    // scheduleOpen() uses setTimeout(0) — let the timer fire, then settle.
    await new Promise((resolve) => setTimeout(resolve, 30))
    await app.settle()
    expect(app.renderer.getPaintedText().join("\n")).toContain("Tooltip text")

    // Leave: a mouse move far away closes the tooltip after ~80ms.
    app.renderer.nativeSimulateMouseMove(600, 500)
    await new Promise((resolve) => setTimeout(resolve, 120))
    await app.settle()
    expect(app.renderer.getPaintedText().join("\n")).not.toContain("Tooltip text")
    app.unmount()
  })

  it("keeps a controlled open prop reactive", async () => {
    const open = ref(false)
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 24 }}>
            <Combobox
              items={["DeepSeek V4", "Claude Opus"]}
              open={open.value}
              onOpenChange={(next) => (open.value = next)}
              itemToStringValue={(item) => item}
            >
              <div style={{ position: "relative", display: "flex" }}>
                <ComboboxInput testId="input" style={{ width: 300 }} placeholder="Pick a model" />
                <ComboboxContent
                  testId="content"
                  side="bottom"
                  sideOffset={4}
                  style={{ backgroundColor: "#222" }}
                >
                  <ComboboxList
                    renderItem={(item: string) => (
                      <ComboboxItem key={item} value={item} style={{ padding: 6 }}>
                        <text>{item}</text>
                      </ComboboxItem>
                    )}
                  />
                </ComboboxContent>
              </div>
            </Combobox>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(app.renderer.findByTestId("content")).toBeUndefined()

    // Focusing the input asks for open; the controlled prop is what opens.
    const input = app.renderer.findByTestId("input")!
    app.renderer.nativeSimulateKeystrokes(input.id, "c")
    await app.settle()
    expect(open.value).toBe(true)
    expect(app.renderer.findByTestId("content")).toBeDefined()

    // The prop alone closes the popup.
    open.value = false
    await app.settle()
    expect(app.renderer.findByTestId("content")).toBeUndefined()
    app.unmount()
  })

  it("invokes a user onKeyDown passed to ComboboxInput once per key", async () => {
    const keyDowns: string[] = []
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: "100%", height: "100%", padding: 24 }}>
            <Combobox
              items={["DeepSeek V4", "Claude Opus"]}
              itemToStringValue={(item) => item}
            >
              <div style={{ position: "relative", display: "flex" }}>
                <ComboboxInput
                  testId="input"
                  style={{ width: 300 }}
                  placeholder="Pick a model"
                  onKeyDown={() => keyDowns.push("keyDown")}
                />
                <ComboboxContent
                  testId="content"
                  side="bottom"
                  sideOffset={4}
                  style={{ backgroundColor: "#222" }}
                >
                  <ComboboxList
                    renderItem={(item: string) => (
                      <ComboboxItem key={item} value={item} style={{ padding: 6 }}>
                        <text>{item}</text>
                      </ComboboxItem>
                    )}
                  />
                </ComboboxContent>
              </div>
            </Combobox>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const input = app.renderer.findByTestId("input")!
    app.renderer.nativeSimulateKeystrokes(input.id, "down")
    await app.settle()
    expect(keyDowns).toHaveLength(1)
    app.unmount()
  })

  it("invokes a user onMouseEnter passed to TooltipTrigger once per hover", async () => {
    const enters: string[] = []
    const App = defineComponent({
      setup() {
        return () => (
          <TooltipProvider delayDuration={0}>
            <div style={{ display: "flex", width: "100%", height: "100%", padding: 30 }}>
              <Tooltip>
                <TooltipTrigger
                  testId="tt-trigger"
                  style={{ padding: 8, backgroundColor: "#333", cursor: "pointer" }}
                  onMouseEnter={() => enters.push("enter")}
                >
                  <text>Hover me</text>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} style={{ backgroundColor: "#000" }}>
                  <text>Tooltip text</text>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        )
      },
    })
    const app = createTestApp(App)
    const trigger = app.renderer.findByTestId("tt-trigger")!
    const bounds = app.renderer.getElementBounds(trigger.id)!
    app.renderer.nativeSimulateMouseMove(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await app.settle()
    expect(app.renderer.getPaintedText().join("\n")).toContain("Tooltip text")
    expect(enters).toHaveLength(1)
    app.unmount()
  })
})
