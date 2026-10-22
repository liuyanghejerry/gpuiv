/// Headless logic tests for the Collapsible primitives: uncontrolled and
/// controlled open state, trigger keyboard activation, disabled handling,
/// panel presence transitions with the animated close, focus restore, and
/// asChild cloning. Runs against the mock renderer (see headless.ts) so it
/// works on Linux without a GPU test renderer.

import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../components/collapsible.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

interface MotionDesc {
  generation: number
  initial: unknown
  animate: { height?: number }
}

function customProp(
  renderer: HeadlessRenderer,
  id: number,
  key: string
): unknown {
  const ops = renderer
    .opsOf("setCustomProp")
    .filter((op) => op[1] === id && op[2] === key)
  return ops.length ? ops[ops.length - 1]![3] : undefined
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

function triggerId(app: HeadlessApp): number {
  return app.renderer.closestWithListener(
    app.renderer.idsWithText("Details")[0]!,
    "click"
  )!
}

async function clickTrigger(app: HeadlessApp) {
  dispatchOnText(app, "Details", "click")
  await app.settle()
}

/** The host div that wraps the panel body (ref: content in CollapsiblePanel). */
function panelContentId(app: HeadlessApp, body = "Panel body"): number {
  return app.renderer.parentOf(app.renderer.idsWithText(body)[0]!)!
}

function panelRootId(app: HeadlessApp, body = "Panel body"): number {
  return app.renderer.parentOf(panelContentId(app, body))!
}

/** With an animated panel the body sits two wrappers deep:
 *  AnimateHeight root → measure wrapper → body. */
function animateRootId(app: HeadlessApp, body = "Panel body"): number {
  return app.renderer.parentOf(panelRootId(app, body))!
}

function measureWrapperId(app: HeadlessApp, body = "Panel body"): number {
  return panelRootId(app, body)
}

interface PlaygroundOptions {
  open?: boolean
  defaultOpen?: boolean
  disabled?: boolean
  triggerDisabled?: boolean
  keepMounted?: boolean
  duration?: number
  onOpenChange?: (open: boolean) => void
  body?: string
}

function CollapsiblePlayground(options: PlaygroundOptions = {}) {
  return defineComponent({
    setup: () => () => (
      <Collapsible
        open={options.open}
        defaultOpen={options.defaultOpen}
        disabled={options.disabled}
        onOpenChange={options.onOpenChange}
        style={(state) => ({ backgroundColor: state.open ? "#ffffff" : "#000000" })}
      >
        <CollapsibleTrigger disabled={options.triggerDisabled}>
          Details
        </CollapsibleTrigger>
        <CollapsiblePanel
          keepMounted={options.keepMounted}
          duration={options.duration ?? 0}
        >
          {options.body ?? "Panel body"}
        </CollapsiblePanel>
      </Collapsible>
    ),
  })
}

/** Fake only what the components use — microtasks (nextTick, the batch
 *  flush) must keep running for settle() to work. */
const TO_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Collapsible (headless)", () => {
  it("toggles open on trigger clicks, reporting aria-expanded and onOpenChange", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(CollapsiblePlayground({ onOpenChange }))

    expect(app.renderer.allTexts()).not.toContain("Panel body")
    expect(customProp(app.renderer, triggerId(app), "aria-expanded")).toBe(false)

    await clickTrigger(app)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(app.renderer.allTexts()).toContain("Panel body")
    expect(customProp(app.renderer, triggerId(app), "aria-expanded")).toBe(true)

    await clickTrigger(app)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(app.renderer.allTexts()).not.toContain("Panel body")
    app.unmount()
  })

  it("composes an array onClick on the trigger before toggling", async () => {
    const first = vi.fn()
    const second = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Collapsible>
            <CollapsibleTrigger onClick={[first, second]}>Details</CollapsibleTrigger>
            <CollapsiblePanel duration={0}>Panel body</CollapsiblePanel>
          </Collapsible>
        ),
      })
    )
    await clickTrigger(app)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(app.renderer.allTexts()).toContain("Panel body")
    app.unmount()
  })

  it("toggles on enter and space, but not with modifiers or a held key", async () => {
    const app = mountHeadless(CollapsiblePlayground())
    const key = (k: string, extra: Record<string, unknown> = {}) =>
      dispatchOnText(app, "Details", "keyDown", { key: k, ...extra })

    key("enter")
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Panel body")

    key("space", { modifiers: { ctrl: true } })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Panel body")

    key("space", { modifiers: { alt: true } })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Panel body")

    key("space", { isHeld: true })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Panel body")

    key("space")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Panel body")

    key("escape")
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Panel body")
    app.unmount()
  })

  it("ignores every interaction while the root is disabled and leaves tab order", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(CollapsiblePlayground({ disabled: true, onOpenChange }))

    expect(customProp(app.renderer, triggerId(app), "tabIndex")).toBe(-1)
    await clickTrigger(app)
    dispatchOnText(app, "Details", "keyDown", { key: "enter" })
    await app.settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(app.renderer.allTexts()).not.toContain("Panel body")
    app.unmount()
  })

  it("a trigger-level disabled prop blocks activation the same way", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      CollapsiblePlayground({ triggerDisabled: true, onOpenChange })
    )

    expect(customProp(app.renderer, triggerId(app), "tabIndex")).toBe(-1)
    await clickTrigger(app)
    dispatchOnText(app, "Details", "keyDown", { key: "enter" })
    await app.settle()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(app.renderer.allTexts()).not.toContain("Panel body")
    app.unmount()
  })

  it("keeps a controlled open prop authoritative while still reporting changes", async () => {
    const open = ref(false)
    const changes: boolean[] = []
    const Controlled = defineComponent({
      setup: () => () => (
        <Collapsible open={open.value} onOpenChange={(value) => changes.push(value)}>
          <CollapsibleTrigger>Details</CollapsibleTrigger>
          <CollapsiblePanel duration={0}>Controlled body</CollapsiblePanel>
        </Collapsible>
      ),
    })
    const controlled = mountHeadless(Controlled)

    await clickTrigger(controlled)
    expect(changes).toEqual([true])
    // The parent did not follow the change: the controlled prop wins.
    expect(controlled.renderer.allTexts()).not.toContain("Controlled body")

    open.value = true
    await controlled.settle()
    expect(controlled.renderer.allTexts()).toContain("Controlled body")

    open.value = false
    await controlled.settle()
    expect(controlled.renderer.allTexts()).not.toContain("Controlled body")
    controlled.unmount()
  })

  it("emits update:open so a bound ref follows the toggle", async () => {
    const open = ref(false)
    const app = mountHeadless(
      defineComponent({
        setup: () => () =>
          h(
            Collapsible,
            {
              open: open.value,
              "onUpdate:open": (value: boolean) => {
                open.value = value
              },
            },
            {
              default: () => [
                h(CollapsibleTrigger, null, { default: () => "Details" }),
                h(CollapsiblePanel, { duration: 0 }, { default: () => "Bound panel" }),
              ],
            }
          ),
      })
    )
    await clickTrigger(app)
    expect(open.value).toBe(true)
    expect(app.renderer.allTexts()).toContain("Bound panel")

    await clickTrigger(app)
    expect(open.value).toBe(false)
    expect(app.renderer.allTexts()).not.toContain("Bound panel")
    app.unmount()
  })

  it("renders open at mount with defaultOpen", () => {
    const app = mountHeadless(CollapsiblePlayground({ defaultOpen: true }))
    expect(app.renderer.allTexts()).toContain("Panel body")
    expect(customProp(app.renderer, triggerId(app), "aria-expanded")).toBe(true)
    app.unmount()
  })

  it("throws when a part is used outside Collapsible", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() =>
      mountHeadless(
        defineComponent({
          setup: () => () => <CollapsibleTrigger>lonely</CollapsibleTrigger>,
        })
      )
    ).toThrow(/must be used inside Collapsible/)
    expect(() =>
      mountHeadless(
        defineComponent({
          setup: () => () => <CollapsiblePanel>lonely</CollapsiblePanel>,
        })
      )
    ).toThrow(/must be used inside Collapsible/)
    consoleWarn.mockRestore()
  })

  it("rejects a negative or non-finite panel duration", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => mountHeadless(CollapsiblePlayground({ duration: -1 }))).toThrow(
      /finite and non-negative/
    )
    expect(() => mountHeadless(CollapsiblePlayground({ duration: Number.NaN }))).toThrow(
      /finite and non-negative/
    )
    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it("keeps closed content mounted but hidden when keepMounted is set", async () => {
    const app = mountHeadless(CollapsiblePlayground({ keepMounted: true }))
    await clickTrigger(app)
    const contentId = panelContentId(app)
    const rootId = panelRootId(app)
    expect(app.renderer.lastStyle(contentId)).toMatchObject({ visibility: "visible" })

    await clickTrigger(app)
    expect(app.renderer.allTexts()).toContain("Panel body")
    expect(app.renderer.lastStyle(contentId)).toMatchObject({ visibility: "hidden" })
    expect(app.renderer.lastStyle(rootId)).toMatchObject({ height: 0, overflow: "hidden" })
    app.unmount()
  })

  it("restores focus to the trigger when the panel holding it closes", async () => {
    const app = mountHeadless(CollapsiblePlayground({ keepMounted: true }))
    await clickTrigger(app)
    const trigger = triggerId(app)
    // Simulate focus landing inside the closing panel.
    app.renderer.focusedElementId = panelContentId(app)

    await clickTrigger(app)
    expect(app.renderer.focusedElementId).toBe(trigger)
    app.unmount()
  })

  it("leaves focus alone when it sits outside the closing panel", async () => {
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <div>
            <Collapsible defaultOpen>
              <CollapsibleTrigger>Details</CollapsibleTrigger>
              <CollapsiblePanel duration={0}>Panel body</CollapsiblePanel>
            </Collapsible>
            <div testId="outside">Outside</div>
          </div>
        ),
      })
    )
    const outsideText = app.renderer.idsWithText("Outside")[0]!
    const outside = app.renderer.parentOf(outsideText)!
    app.renderer.focusedElementId = outside

    await clickTrigger(app)
    expect(app.renderer.focusedElementId).toBe(outside)
    app.unmount()
  })

  it("animated panel: measures the body, tweens shut, and unmounts on the matching completion", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const app = mountHeadless(CollapsiblePlayground({ duration: 0.2 }))
    expect(app.renderer.allTexts()).not.toContain("Panel body")

    await clickTrigger(app)
    const rootId = animateRootId(app)
    const measureId = measureWrapperId(app)
    // Present but unmeasured: painted from zero, no motion track yet.
    expect(app.renderer.allTexts()).toContain("Panel body")
    expect(customProp(app.renderer, rootId, "motion")).toBeUndefined()

    // The bounds poll answers one interval later, like a painted frame.
    app.renderer.elementBounds.set(measureId, { x: 0, y: 0, width: 200, height: 80 })
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    let motion = customProp(app.renderer, rootId, "motion") as MotionDesc
    expect(motion.animate).toEqual({ height: 80 })
    expect(motion.initial).toEqual({ height: 0 })

    // Close: the track retargets to zero on a new generation.
    await clickTrigger(app)
    motion = customProp(app.renderer, rootId, "motion") as MotionDesc
    expect(motion.animate).toEqual({ height: 0 })
    const closing = motion.generation

    // A stale generation completion must not finish the close.
    app.dispatch({ elementId: rootId, eventType: "motionComplete", motionGeneration: closing - 1 })
    await app.settle()
    expect(app.renderer.allTexts()).toContain("Panel body")

    app.dispatch({ elementId: rootId, eventType: "motionComplete", motionGeneration: closing })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Panel body")
    app.unmount()
  })

  it("animated panel: reopening after a completed close mounts from zero height again", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const app = mountHeadless(CollapsiblePlayground({ duration: 0.2 }))
    await clickTrigger(app)
    const rootId = animateRootId(app)
    const measureId = measureWrapperId(app)
    app.renderer.elementBounds.set(measureId, { x: 0, y: 0, width: 200, height: 80 })
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    const opened = (customProp(app.renderer, rootId, "motion") as MotionDesc).generation

    // Close and complete.
    await clickTrigger(app)
    const closing = (customProp(app.renderer, rootId, "motion") as MotionDesc).generation
    app.dispatch({ elementId: rootId, eventType: "motionComplete", motionGeneration: closing })
    await app.settle()
    expect(app.renderer.allTexts()).not.toContain("Panel body")

    // Reopen: a fresh AnimateHeight with initialHeight 0 from the watch.
    await clickTrigger(app)
    expect(app.renderer.allTexts()).toContain("Panel body")
    app.renderer.elementBounds.set(measureWrapperId(app), { x: 0, y: 0, width: 200, height: 80 })
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    const motion = customProp(app.renderer, animateRootId(app), "motion") as MotionDesc
    expect(motion.generation).toBeGreaterThan(opened)
    expect(motion.initial).toEqual({ height: 0 })
    expect(motion.animate).toEqual({ height: 80 })
    app.unmount()
  })

  it("merges an asChild trigger onto its single child element", async () => {
    const childClick = vi.fn()
    const outerClick = vi.fn()
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Collapsible>
            <CollapsibleTrigger asChild onClick={outerClick}>
              <div onClick={childClick} style={{ width: 120 }}>
                Details
              </div>
            </CollapsibleTrigger>
            <CollapsiblePanel duration={0}>Opened</CollapsiblePanel>
          </Collapsible>
        ),
      })
    )
    await clickTrigger(app)
    expect(childClick).toHaveBeenCalledTimes(1)
    expect(outerClick).toHaveBeenCalledTimes(1)
    expect(app.renderer.allTexts()).toContain("Opened")
    app.unmount()
  })

  it("asChild requires exactly one element child", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const withTrigger = (children: unknown) =>
      defineComponent({
        setup: () => () => (
          <Collapsible>
            <CollapsibleTrigger asChild>{children}</CollapsibleTrigger>
            <CollapsiblePanel duration={0}>Opened</CollapsiblePanel>
          </Collapsible>
        ),
      })
    expect(() => mountHeadless(withTrigger(undefined))).toThrow(
      /requires exactly one child element/
    )
    expect(() => mountHeadless(withTrigger("just text"))).toThrow(
      /requires exactly one child element/
    )
    expect(() =>
      mountHeadless(
        withTrigger([<div key="a">one</div>, <div key="b">two</div>])
      )
    ).toThrow(/requires exactly one child element/)
    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it("restores focus through an asChild component trigger's root element", async () => {
    const Button = defineComponent({
      setup: () => () => <div style={{ width: 120 }}>Details</div>,
    })
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Collapsible defaultOpen>
            <CollapsibleTrigger asChild>
              <Button />
            </CollapsibleTrigger>
            <CollapsiblePanel keepMounted duration={0}>
              Panel body
            </CollapsiblePanel>
          </Collapsible>
        ),
      })
    )
    const painted = app.renderer.idsWithText("Details")[0]!
    // A string child paints as the div's own text, so the painted id IS the
    // component's host root — what the asChild ref captured as $el.
    app.renderer.focusedElementId = panelContentId(app)

    await clickTrigger(app)
    expect(app.renderer.focusedElementId).toBe(painted)
    app.unmount()
  })

  it("resolves state styles for the root, trigger, and panel", async () => {
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Collapsible
            defaultOpen
            style={(state) => ({ backgroundColor: state.open ? "#ffffff" : "#000000" })}
          >
            <CollapsibleTrigger style={(state) => ({ color: state.open ? "#111111" : "#222222" })}>
              Details
            </CollapsibleTrigger>
            <CollapsiblePanel duration={0} style={{ paddingBottom: 4 }}>
              Panel body
            </CollapsiblePanel>
          </Collapsible>
        ),
      })
    )
    const root = app.renderer.parentOf(triggerId(app))!
    expect(app.renderer.lastStyle(root)).toMatchObject({
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#ffffff",
    })
    expect(app.renderer.lastStyle(triggerId(app))).toMatchObject({ color: "#111111" })
    expect(app.renderer.lastStyle(panelRootId(app))).toMatchObject({ paddingBottom: 4 })

    await clickTrigger(app)
    expect(app.renderer.lastStyle(root)).toMatchObject({ backgroundColor: "#000000" })
    expect(app.renderer.lastStyle(triggerId(app))).toMatchObject({ color: "#222222" })
    app.unmount()
  })

  it("forwards trigger chrome: role button and default tabIndex 0", () => {
    const app = mountHeadless(CollapsiblePlayground())
    const id = triggerId(app)
    expect(customProp(app.renderer, id, "role")).toBe("button")
    expect(customProp(app.renderer, id, "tabIndex")).toBe(0)
    app.unmount()
  })
})
