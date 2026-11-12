/** Headless Dialog tests: open/close plumbing, dismiss-layer stacking by
 *  nesting, focus ownership across opens and closes, and the modal Tab trap —
 *  everything the mock renderer can observe. Pixel behavior (the native
 *  `fill="window"` sizing) lives in the GPU-gated dialog.test.tsx. */

// @ts-nocheck

import { defineComponent, h, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { mountHeadless } from "./headless.js"
import type { HeadlessApp } from "./headless.js"
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
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

const popupStyle = {
  width: 300,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  backgroundColor: "#1e293b",
}

function find(app: HeadlessApp, testId: string) {
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return walk(app.container).find((node) => node.props.testId === testId)
}

function click(app: HeadlessApp, testId: string) {
  const node = find(app, testId)
  expect(node, `missing testId: ${testId}`).toBeDefined()
  return app.dispatch({ elementId: node.id, eventType: "click", clickCount: 1 })
}

/** One synthetic keystroke with a shared id: the element event and the
 *  trailing window event group their flags, like a native dispatch. */
function keystroke(
  app: HeadlessApp,
  target: string | number,
  key: string,
  id: number,
  extra: Record<string, unknown> = {}
) {
  const elementId = typeof target === "number" ? target : find(app, target)?.id
  if (elementId != null) {
    app.dispatch({ elementId, eventType: "keyDown", key, keystrokeId: id, ...extra })
  }
  app.windowKeyDown(key, { keystrokeId: id, ...extra })
}

describe("dialog (headless)", () => {
  let app: HeadlessApp | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("opens from the trigger and closes from Close, the backdrop and Escape", async () => {
    const opened: boolean[] = []
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen={false} onOpenChange={(next) => opened.push(next)}>
          <DialogTrigger testId="open">Open</DialogTrigger>
          <DialogPortal>
            <DialogBackdrop testId="backdrop" />
            <DialogPopup testId="popup" style={popupStyle}>
              <DialogTitle>Settings</DialogTitle>
              <DialogClose testId="close">Close</DialogClose>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()

    click(app, "open")
    await app.settle()
    expect(find(app, "popup")).toBeDefined()
    expect(opened).toEqual([true])

    click(app, "close")
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
    expect(opened).toEqual([true, false])

    click(app, "open")
    await app.settle()
    // A press on the backdrop closes the dialog.
    app.dispatch({ elementId: find(app, "backdrop").id, eventType: "mouseDown", button: 0 })
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()

    click(app, "open")
    await app.settle()
    // Escape closes through the dismiss layer stack.
    app.windowKeyDown("escape")
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
    expect(opened).toEqual([true, false, true, false, true, false])
  })

  it("keeps the dialog open on a backdrop press with disablePointerDismissal", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen disablePointerDismissal>
          <DialogPortal>
            <DialogBackdrop testId="backdrop" />
            <DialogPopup testId="popup" style={popupStyle} />
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    app.dispatch({ elementId: find(app, "backdrop").id, eventType: "mouseDown", button: 0 })
    await app.settle()
    expect(find(app, "popup")).toBeDefined()
  })

  it("Escape closes only the top layer, and nesting decides the order", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" style={popupStyle}>
              <text>Dialog</text>
              <Select defaultOpen items={[{ value: "a", label: "Alpha" }]} defaultValue="a">
                <SelectTrigger testId="select-trigger" style={{ width: 180, height: 36 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ width: 180, padding: 4 }} testId="select-content">
                  <SelectItem value="a">Menu item</SelectItem>
                </SelectContent>
              </Select>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    expect(find(app, "popup")).toBeDefined()
    expect(find(app, "select-content")).toBeDefined()

    // Vue mounts the Select's layer before the Dialog's; nesting must still
    // put the Select on top, so one Escape closes only the menu.
    app.windowKeyDown("escape")
    await app.settle()
    expect(find(app, "select-content")).toBeUndefined()
    expect(find(app, "popup")).toBeDefined()

    app.windowKeyDown("escape")
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
  })

  it("moves focus to the popup on open and back to the previous element on close", async () => {
    const open = ref(false)
    const App = defineComponent({
      setup: () => () => (
        <div>
          <div testId="launcher" tabIndex={0} style={{ width: 80, height: 24 }} />
          <Dialog open={open.value} onOpenChange={(next) => (open.value = next)}>
            <DialogPortal>
              <DialogBackdrop />
              <DialogPopup testId="popup" style={popupStyle} />
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    const launcher = find(app, "launcher").id
    const renderer = app.renderer
    // No trigger: remember whatever held focus before the dialog opened.
    renderer.focusElement(launcher)

    open.value = true
    await app.settle()
    const popup = find(app, "popup").id
    expect(renderer.getFocusedElementId()).toBe(popup)

    app.windowKeyDown("escape")
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(launcher)
  })

  it("initialFocus picks the target; finalFocus returns to the trigger", async () => {
    const fieldRef = { current: null }
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen={false}>
          <DialogTrigger testId="open">Open</DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" initialFocus={fieldRef} style={popupStyle}>
              <input
                testId="field"
                ref={(node) => {
                  fieldRef.current = node && node.id != null ? { id: node.id } : null
                }}
                style={{ width: 160, height: 28 }}
              />
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    const renderer = app.renderer
    const trigger = find(app, "open").id

    click(app, "open")
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(find(app, "field").id)

    app.windowKeyDown("escape")
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(trigger)
  })

  it("nested dialogs that open together focus the inner and return through the stack", async () => {
    const outer = ref(false)
    const inner = ref(false)
    const App = defineComponent({
      setup: () => () => (
        <div>
          <div testId="launcher" tabIndex={0} style={{ width: 80, height: 24 }} />
          <Dialog open={outer.value} onOpenChange={(next) => (outer.value = next)}>
            <DialogPortal>
              <DialogBackdrop />
              <DialogPopup testId="outer" style={popupStyle}>
                <Dialog open={inner.value} onOpenChange={(next) => (inner.value = next)}>
                  <DialogPortal>
                    <DialogBackdrop />
                    <DialogPopup testId="inner" style={{ width: 200, height: 80 }} />
                  </DialogPortal>
                </Dialog>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    const renderer = app.renderer
    const launcher = find(app, "launcher").id
    renderer.focusElement(launcher)

    outer.value = true
    inner.value = true
    await app.settle()
    // Only the layer landing on top takes focus: the inner popup.
    expect(renderer.getFocusedElementId()).toBe(find(app, "inner").id)

    inner.value = false
    await app.settle()
    // Closing the inner alone returns into the outer popup.
    expect(renderer.getFocusedElementId()).toBe(find(app, "outer").id)

    outer.value = false
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(launcher)

    // Both open together again, then close together: the parent restores for
    // its subtree, so one hop back to the launcher.
    outer.value = true
    inner.value = true
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(find(app, "inner").id)
    outer.value = false
    inner.value = false
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(launcher)
  })

  it("the modal popup traps Tab; a non-modal popup lets the window default run", async () => {    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" style={popupStyle} />
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    const renderer = app.renderer
    const popup = find(app, "popup").id
    expect(renderer.getFocusedElementId()).toBe(popup)

    // The popup's trap prevents the default; focus does not move.
    keystroke(app, popup, "tab", 1)
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(popup)

    app.unmount()

    const NonModal = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen modal={false}>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" style={popupStyle} />
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(NonModal)
    await app.settle()
    const nonModalRenderer = app.renderer
    const nonModalPopup = find(app, "popup").id
    nonModalRenderer.focusElement(nonModalPopup)

    // No trap: the window default calls focusNext (the mock clears focus).
    keystroke(app, nonModalPopup, "tab", 2)
    await app.settle()
    expect(nonModalRenderer.getFocusedElementId()).toBeNull()
  })

  it("activates Trigger and Close like a <button>: Enter down, Space up, disabled", async () => {
    const opened: boolean[] = []
    const App = defineComponent({
      setup: () => () => (
        <div>
          <Dialog defaultOpen={false} onOpenChange={(next) => opened.push(next)}>
            <DialogTrigger testId="open">Open</DialogTrigger>
            <DialogTrigger testId="disabled" disabled>Disabled</DialogTrigger>
            <DialogPortal>
              <DialogBackdrop />
              <DialogPopup testId="popup" style={popupStyle}>
                <DialogClose testId="close">Close</DialogClose>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()

    // Enter activates on key-down; a held repeat does not refire.
    app.dispatch({ elementId: find(app, "open").id, eventType: "keyDown", key: "enter" })
    await app.settle()
    expect(find(app, "popup")).toBeDefined()
    expect(opened).toEqual([true])

    // Space cancels its default on key-down and activates on key-up.
    app.dispatch({ elementId: find(app, "close").id, eventType: "keyDown", key: "space" })
    await app.settle()
    expect(find(app, "popup")).toBeDefined()
    app.dispatch({ elementId: find(app, "close").id, eventType: "keyUp", key: "space" })
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
    expect(opened).toEqual([true, false])

    // Enter also closes from the Close button.
    app.dispatch({ elementId: find(app, "open").id, eventType: "keyDown", key: "enter" })
    await app.settle()
    app.dispatch({ elementId: find(app, "close").id, eventType: "keyDown", key: "enter" })
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()

    // A disabled trigger neither joins the tab order nor activates.
    const disabled = find(app, "disabled")
    expect(disabled.props.tabIndex).toBe(-1)
    click(app, "disabled")
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
    app.dispatch({ elementId: disabled.id, eventType: "keyDown", key: "enter" })
    app.dispatch({ elementId: disabled.id, eventType: "keyUp", key: "space" })
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
  })

  it("asChild merges Trigger and Close onto their single child", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogTrigger asChild testId="open">
            <div style={{ width: 80, height: 24 }}>Open</div>
          </DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" style={popupStyle}>
              <text>Body</text>
              <DialogClose asChild testId="close">
                <div style={{ width: 60, height: 24 }}>Done</div>
              </DialogClose>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    // The child itself became the trigger/close: one element, one hit target.
    const trigger = find(app, "open")
    expect(trigger.type).toBe("div")
    expect(app.renderer.textOf(trigger.id)).toBe("Open")
    expect(app.renderer.hasListener(trigger.id, "click")).toBe(true)

    click(app, "close")
    await app.settle()
    expect(find(app, "popup")).toBeUndefined()
  })

  it("renders Title and Description, and traps Shift+Tab inside a modal popup", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Dialog defaultOpen>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup testId="popup" style={popupStyle}>
              <DialogTitle testId="title">Settings</DialogTitle>
              <DialogDescription testId="description">Changes apply immediately</DialogDescription>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Settings")
    expect(app.renderer.allTexts()).toContain("Changes apply immediately")
    expect(find(app, "title").props.role).toBe("heading")

    const renderer = app.renderer
    const popup = find(app, "popup").id
    // Shift+Tab takes the popup's focusPreviousWithin branch and stays
    // prevented, so the window default never moves focus either.
    keystroke(app, popup, "tab", 3, { shift: true })
    await app.settle()
    expect(renderer.getFocusedElementId()).toBe(popup)
  })
})
