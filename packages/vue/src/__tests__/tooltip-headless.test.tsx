/// Headless logic tests for the Tooltip primitives: hover open with provider
/// and per-tooltip delays, skip-delay after a recent close, hoverable content,
/// focus/blur, dismissal, controlled open, and timer cleanup on unmount.
/// Runs against the mock renderer (see headless.ts) with faked timers, so it
/// works without a GPU test renderer.

import { defineComponent, ref } from "vue"
import type { Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/tooltip.js"
import { mountHeadless } from "./headless.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

interface PlaygroundOptions {
  providerDelay?: number
  tooltipDelay?: number
  skipDelay?: number
  disableHover?: boolean
  providerless?: boolean
  defaultOpen?: boolean
  openRef?: Ref<boolean>
  onOpenChange?: (open: boolean) => void
  onTriggerClick?: (event: unknown) => void
  side?: "top" | "right" | "bottom" | "left"
}

function TooltipPlayground(options: PlaygroundOptions = {}) {
  return defineComponent({
    setup: () => () => {
      const tooltip = (
        <Tooltip
          delayDuration={options.tooltipDelay}
          disableHoverableContent={options.providerless ? options.disableHover : undefined}
          defaultOpen={options.defaultOpen}
          open={options.openRef ? options.openRef.value : undefined}
          onOpenChange={options.onOpenChange}
        >
          <TooltipTrigger onClick={options.onTriggerClick}>
            <div>Hover me</div>
          </TooltipTrigger>
          <TooltipContent side={options.side} sideOffset={4}>
            Tip text
          </TooltipContent>
        </Tooltip>
      )
      if (options.providerless) return tooltip
      return (
        <TooltipProvider
          delayDuration={options.providerDelay}
          skipDelayDuration={options.skipDelay}
          disableHoverableContent={options.disableHover}
        >
          {tooltip}
        </TooltipProvider>
      )
    },
  })
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

async function hoverOpen(app: HeadlessApp) {
  dispatchOnText(app, "Hover me", "mouseEnter")
  await app.settle()
}

async function hoverLeave(app: HeadlessApp) {
  dispatchOnText(app, "Hover me", "mouseLeave")
  await app.settle()
}

function isOpen(app: HeadlessApp): boolean {
  return app.renderer.allTexts().includes("Tip text")
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Tooltip (headless)", () => {
  it("opens immediately on hover with no delay and reports onOpenChange", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(TooltipPlayground({ onOpenChange }))
    await hoverOpen(app)
    expect(isOpen(app)).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    app.unmount()
  })

  it("opens immediately without any provider, using the built-in defaults", async () => {
    const app = mountHeadless(TooltipPlayground({ providerless: true }))
    await hoverOpen(app)
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("waits out the provider delayDuration, then opens", async () => {
    const app = mountHeadless(TooltipPlayground({ providerDelay: 200 }))
    await hoverOpen(app)
    expect(isOpen(app)).toBe(false)

    await vi.advanceTimersByTimeAsync(199)
    await app.settle()
    expect(isOpen(app)).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await app.settle()
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("leaving before the delay fires cancels the open", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(TooltipPlayground({ providerDelay: 200 }))
    await hoverOpen(app)
    await hoverLeave(app)
    await vi.advanceTimersByTimeAsync(500)
    await app.settle()
    expect(isOpen(app)).toBe(false)
    expect(onOpenChange).not.toHaveBeenCalled()
    app.unmount()
  })

  it("a zero tooltip delayDuration overrides a slower provider", async () => {
    const app = mountHeadless(
      TooltipPlayground({ providerDelay: 200, tooltipDelay: 0 })
    )
    await hoverOpen(app)
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("re-entering within skipDelayDuration skips the delay", async () => {
    const app = mountHeadless(
      TooltipPlayground({ providerDelay: 200, skipDelay: 300 })
    )
    await hoverOpen(app)
    await vi.advanceTimersByTimeAsync(200)
    await app.settle()
    expect(isOpen(app)).toBe(true)

    await hoverLeave(app)
    await vi.advanceTimersByTimeAsync(80)
    await app.settle()
    expect(isOpen(app)).toBe(false)

    // Recently closed: the 200ms delay is skipped.
    await hoverOpen(app)
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("mouseLeave schedules an 80ms close and hovering the content cancels it", async () => {
    const app = mountHeadless(TooltipPlayground())
    await hoverOpen(app)

    await hoverLeave(app)
    expect(isOpen(app)).toBe(true)

    dispatchOnText(app, "Tip text", "mouseEnter")
    await app.settle()
    await vi.advanceTimersByTimeAsync(500)
    await app.settle()
    expect(isOpen(app)).toBe(true)

    // Leaving the content itself schedules the close again.
    dispatchOnText(app, "Tip text", "mouseLeave")
    await app.settle()
    await vi.advanceTimersByTimeAsync(79)
    await app.settle()
    expect(isOpen(app)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    await app.settle()
    expect(isOpen(app)).toBe(false)
    app.unmount()
  })

  it("disableHoverableContent closes immediately on leave", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      TooltipPlayground({ disableHover: true, onOpenChange })
    )
    await hoverOpen(app)
    expect(isOpen(app)).toBe(true)

    await hoverLeave(app)
    expect(isOpen(app)).toBe(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    app.unmount()
  })

  it("focus opens immediately and blur closes", async () => {
    const app = mountHeadless(TooltipPlayground())
    dispatchOnText(app, "Hover me", "focus")
    await app.settle()
    expect(isOpen(app)).toBe(true)

    dispatchOnText(app, "Hover me", "blur")
    await app.settle()
    expect(isOpen(app)).toBe(false)
    app.unmount()
  })

  it("mouseDown on the trigger closes an open tooltip", async () => {
    const app = mountHeadless(TooltipPlayground())
    await hoverOpen(app)
    dispatchOnText(app, "Hover me", "mouseDown")
    await app.settle()
    expect(isOpen(app)).toBe(false)
    app.unmount()
  })

  it("clicking the trigger closes and chains the user click handler", async () => {
    const onTriggerClick = vi.fn()
    const app = mountHeadless(TooltipPlayground({ onTriggerClick }))
    await hoverOpen(app)
    dispatchOnText(app, "Hover me", "click")
    await app.settle()
    expect(isOpen(app)).toBe(false)
    expect(onTriggerClick).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it("escape on the trigger closes", async () => {
    const app = mountHeadless(TooltipPlayground())
    await hoverOpen(app)
    dispatchOnText(app, "Hover me", "keyDown", { key: "escape" })
    await app.settle()
    expect(isOpen(app)).toBe(false)
    app.unmount()
  })

  it("defaultOpen renders the content at mount", () => {
    const app = mountHeadless(TooltipPlayground({ defaultOpen: true }))
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("a controlled open stays driven by the prop", async () => {
    const onOpenChange = vi.fn()
    const open = ref(true)
    const app = mountHeadless(TooltipPlayground({ openRef: open, onOpenChange }))
    expect(isOpen(app)).toBe(true)

    dispatchOnText(app, "Hover me", "mouseDown")
    await app.settle()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(isOpen(app)).toBe(true)

    open.value = false
    await app.settle()
    expect(isOpen(app)).toBe(false)
    app.unmount()
  })

  it("unmounting cancels pending timers", async () => {
    const onOpenChange = vi.fn()
    const app = mountHeadless(
      TooltipPlayground({ providerDelay: 200, onOpenChange })
    )
    await hoverOpen(app)
    app.unmount()
    await vi.advanceTimersByTimeAsync(500)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("the content anchors on the requested side", async () => {
    const app = mountHeadless(TooltipPlayground({ side: "right" }))
    await hoverOpen(app)
    const anchored = app.renderer
      .opsOf("createElement")
      .find((op) => op[2] === "anchored")
    expect(anchored).toBeDefined()
    const side = app.renderer
      .opsOf("setCustomProp")
      .filter((op) => op[1] === (anchored![1] as number) && op[2] === "side")
    expect(side.length).toBeGreaterThan(0)
    expect(side[side.length - 1][3]).toBe("right")
    app.unmount()
  })

  it("content without side attrs anchors on top, centered, no offset", async () => {
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Tooltip defaultOpen>
            <TooltipTrigger>
              <div>Hover me</div>
            </TooltipTrigger>
            <TooltipContent>Tip text</TooltipContent>
          </Tooltip>
        ),
      })
    )
    expect(isOpen(app)).toBe(true)
    const anchored = app.renderer
      .opsOf("createElement")
      .find((op) => op[2] === "anchored")
    expect(anchored).toBeDefined()
    const props = new Map(
      app.renderer
        .opsOf("setCustomProp")
        .filter((op) => op[1] === (anchored![1] as number))
        .map((op) => [op[2] as string, op[3]])
    )
    expect(props.get("side")).toBe("top")
    expect(props.get("align")).toBe("center")
    expect(props.get("gap")).toBe(0)
    app.unmount()
  })

  it("non-escape keys on the trigger leave the tooltip open", async () => {
    const app = mountHeadless(TooltipPlayground())
    await hoverOpen(app)
    dispatchOnText(app, "Hover me", "keyDown", { key: "a" })
    await app.settle()
    expect(isOpen(app)).toBe(true)
    app.unmount()
  })

  it("throws when parts are used outside Tooltip", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() =>
      mountHeadless(
        defineComponent({ setup: () => () => <TooltipTrigger>lonely</TooltipTrigger> })
      )
    ).toThrow(/must be used inside Tooltip/)
    expect(() =>
      mountHeadless(
        defineComponent({ setup: () => () => <TooltipContent>lonely</TooltipContent> })
      )
    ).toThrow(/must be used inside Tooltip/)
    consoleWarn.mockRestore()
  })
})
