/** GPU-backed tests for the headless Dialog (Vue), ported from upstream's
 *  floating-controls suite (remorses/gpuix `cff4907` / `148c9e8` /
 *  `6382a80` / `ef1c12e`, the Dialog halves). */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { HostNode } from "../types.js"
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../index.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const popupStyle = {
  width: 300,
  padding: 16,
  gap: 8,
  display: "flex",
  flexDirection: "column",
  backgroundColor: "#1e293b",
}

describeNative("dialog (vue)", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  function testIdOf(name: string): number {
    return app!.renderer.findByTestId(name).id
  }

  function focusedTestId(): string | number | null {
    const focused = app!.renderer.getFocusedElementId()
    if (focused == null) return null
    const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
    const node = walk(app!.container).find((candidate) => candidate.id === focused)
    return node?.props.testId ?? focused
  }

  it("runs a modal Dialog by keyboard: trap Tab, Escape closes the top layer first", async () => {
    const value = ref("a")
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "column", width: 600, height: 400, padding: 12, gap: 8 }}>
          <div autoFocus testId="before" tabIndex={0} style={{ width: 80, height: 24 }} />
          <Dialog onOpenChange={() => {}}>
            <DialogTrigger testId="open" style={{ width: 80, height: 24 }}>Open</DialogTrigger>
            <DialogPortal>
              <DialogBackdrop testId="backdrop" style={{ backgroundColor: "#00000080" }} />
              <DialogPopup testId="popup" style={popupStyle}>
                <DialogTitle>Settings</DialogTitle>
                <Select items={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} value={value.value} onValueChange={(next) => (value.value = next)}>
                  <SelectTrigger testId="select" style={{ width: 180, height: 36 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ width: 180, padding: 4 }}>
                    <SelectItem value="a">Alpha</SelectItem>
                    <SelectItem value="b">Beta</SelectItem>
                  </SelectContent>
                </Select>
                <DialogClose testId="close" style={{ width: 60, height: 24 }}>Close</DialogClose>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    expect(focusedTestId()).toBe("before")

    // Tab reaches the trigger; Enter opens; focus moves into the popup.
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(focusedTestId()).toBe("open")
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(focusedTestId()).toBe("popup")

    // The modal trap cycles inside the popup: select, close, wrap to select.
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(focusedTestId()).toBe("select")
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(focusedTestId()).toBe("close")
    app.renderer.simulateKeystrokes("tab")
    await app.settle()
    expect(focusedTestId()).toBe("select")
    app.renderer.simulateKeystrokes("shift-tab")
    await app.settle()
    expect(focusedTestId()).toBe("close")
    app.renderer.simulateKeystrokes("shift-tab")
    await app.settle()
    expect(focusedTestId()).toBe("select")

    // The nested Select popup opens above the dialog. Our retained tree keeps
    // the deferred layer at its component position (inside the popup, before
    // Close), so the item texts join mid-list — the paint order above the
    // dialog is what the layer's deferred priority buys.
    app.renderer.simulateKeystrokes("down")
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "").join("|")).toBe("Open|Settings|Alpha|Alpha|Beta|Close")

    // One Escape closes only the Select; the second closes the dialog and
    // restores focus to the trigger.
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "").join("|")).toBe("Open|Settings|Alpha|Close")
    expect(focusedTestId()).toBe("select")
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "").join("|")).toBe("Open")
    expect(focusedTestId()).toBe("open")

    // Backdrop and popup press semantics: a press on the popup keeps it open,
    // a press on the backdrop closes and restores the trigger.
    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(focusedTestId()).toBe("popup")
    const popup = app.renderer.getElementBounds(testIdOf("popup"))
    app.renderer.nativeSimulateClick(popup.x + popup.width - 4, popup.y + 4)
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "").join("|")).toBe("Open|Settings|Alpha|Close")
    app.renderer.nativeSimulateClick(4, 390)
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "").join("|")).toBe("Open")
    expect(focusedTestId()).toBe("open")
  })

  it("sizes the Dialog portal to the window natively", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal testId="portal">
            <DialogBackdrop testId="backdrop" style={{ backgroundColor: "#00000080" }} />
            <DialogPopup testId="popup" style={{ width: 200, height: 100, backgroundColor: "#1e293b" }} />
          </DialogPortal>
        </Dialog>
      ),
    })
    // Not the 1280x800 default, and no JS sizes the layer: native must track
    // the real viewport. Windows clamps the offscreen test window to 1024
    // wide, so the pins read the actual window size instead of the request.
    app = createTestApp(App, { width: 900, height: 500 })
    await app.settle()
    const size = app.renderer.getWindowSize()
    expect(size).not.toEqual({ width: 1280, height: 800 })
    const bounds = (testId: string) => app!.renderer.getElementBounds(testIdOf(testId))
    expect(bounds("portal")).toEqual({ x: 0, y: 0, width: size.width, height: size.height })
    expect(bounds("backdrop")).toEqual({ x: 0, y: 0, width: size.width, height: size.height })
    expect(bounds("popup")).toEqual({
      x: (size.width - 200) / 2,
      y: (size.height - 100) / 2,
      width: 200,
      height: 100,
    })
  })

  it("keeps a Dialog open when a handler prevents Escape", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogPopup
              style={{ width: 200, height: 100, backgroundColor: "#1e293b" }}
              onKeyDown={(event) => {
                if (event.key === "escape") event.preventDefault()
              }}
            >
              <text>Unsaved</text>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(app.renderer.getAllText().filter((text) => text !== "")).toEqual(["Unsaved"])
  })

  it("puts a nested layer above its parent even when both open in one commit", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogPopup style={popupStyle}>
              <text>Dialog</text>
              <Select defaultOpen items={[{ value: "a", label: "Alpha" }]} defaultValue="a">
                <SelectTrigger style={{ width: 180, height: 36 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ width: 180, padding: 4 }}>
                  <SelectItem value="a">Menu item</SelectItem>
                </SelectContent>
              </Select>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    // Vue brackets slot fragments with empty text anchors; they are layout-free
    // (collapsed to zero size natively) and filtered from these assertions.
    const texts = () => app!.renderer.getAllText().filter((text) => text !== "").join("|")
    expect(texts()).toBe("Dialog|Alpha|Menu item")

    // Vue mounts the Select's layer before the Dialog's; nesting must still
    // put the Select on top, so one Escape closes only the menu.
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(texts()).toBe("Dialog|Alpha")
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(texts()).toBe("")
  })

  it("focuses initialFocus on open and returns focus without a Trigger", async () => {
    const open = ref(false)
    const fieldRef = ref(null)
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "column", width: 600, height: 400, padding: 12, gap: 8 }}>
          <div
            autoFocus
            testId="launcher"
            tabIndex={0}
            style={{ width: 80, height: 24 }}
            onKeyDown={(event) => {
              if (event.key === "enter") open.value = true
            }}
          />
          <Dialog open={open.value} onOpenChange={(next) => (open.value = next)}>
            <DialogPortal>
              <DialogPopup initialFocus={fieldRef} style={popupStyle}>
                <div testId="first" tabIndex={0} style={{ width: 60, height: 24 }} />
                <input ref={fieldRef} testId="field" style={{ width: 160, height: 28 }} />
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    expect(focusedTestId()).toBe("launcher")

    app.renderer.simulateKeystrokes("enter")
    await app.settle()
    expect(focusedTestId()).toBe("field")

    // Without a Trigger, closing returns to the element focused before open.
    app.renderer.simulateKeystrokes("escape")
    await app.settle()
    expect(focusedTestId()).toBe("launcher")
  })

  it("moves focus in stack order when nested dialogs open and close together", async () => {
    const outer = ref(false)
    const inner = ref(false)
    const App = defineComponent({
      setup: () => () => (
        <div style={{ display: "flex", flexDirection: "column", width: 600, height: 400, padding: 12, gap: 8 }}>
          <div autoFocus testId="launcher" tabIndex={0} style={{ width: 80, height: 24 }} />
          <Dialog open={outer.value} onOpenChange={(next) => (outer.value = next)}>
            <DialogPortal>
              <DialogPopup testId="outer" style={{ width: 400, padding: 16, display: "flex", flexDirection: "column", gap: 8, backgroundColor: "#1e293b" }}>
                <Dialog open={inner.value} onOpenChange={(next) => (inner.value = next)}>
                  <DialogPortal>
                    <DialogPopup testId="inner" style={{ width: 200, height: 80, backgroundColor: "#334155" }} />
                  </DialogPortal>
                </Dialog>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = createTestApp(App)
    await app.settle()
    const steps: string[] = [`mount: ${focusedTestId()}`]

    const step = (label: string) => steps.push(`${label}: ${focusedTestId()}`)
    const render = async (label: string, outerOpen: boolean, innerOpen: boolean) => {
      outer.value = outerOpen
      inner.value = innerOpen
      await app!.settle()
      step(label)
    }

    await render("open both", true, true)
    await render("close inner", true, false)
    await render("close outer", false, false)
    await render("open both", true, true)
    await render("close both", false, false)

    expect(steps).toEqual([
      "mount: launcher",
      "open both: inner",
      "close inner: outer",
      "close outer: launcher",
      "open both: inner",
      "close both: launcher",
    ])
  })
})
