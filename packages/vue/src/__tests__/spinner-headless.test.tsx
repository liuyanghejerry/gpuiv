/// Headless logic tests for the Spinner loading indicators: both render
/// variants with pinned phases, prop plumbing (size/width/color/label), the
/// 3-digit and invalid color paths of the track tint, and the 25fps timer
/// that drives the dots while mounted. Runs against the mock renderer (see
/// headless.ts) so it works on Linux.

import { defineComponent } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Spinner } from "../components/spinner.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"
import type { StyleDesc } from "../types.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

function customProp(renderer: HeadlessRenderer, id: number, key: string): unknown {
  const ops = renderer.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
  return ops.length ? ops[ops.length - 1]![3] : undefined
}

function mountSpinner(props: Record<string, unknown> = {}): HeadlessApp {
  const app = mountHeadless(
    defineComponent({
      setup: () => () => <Spinner {...props} />,
    })
  )
  return app
}

/** Styles of every mounted div, in creation order (append-only ops). */
function divStyles(renderer: HeadlessRenderer): StyleDesc[] {
  return renderer
    .opsOf("createElement")
    .filter((op) => op[2] === "div")
    .map((op) => renderer.lastStyle(op[1] as number))
    .filter((style): style is StyleDesc => style !== undefined)
}

/** The `role="status"` element id. */
function statusId(renderer: HeadlessRenderer): number {
  const op = renderer
    .opsOf("setCustomProp")
    .find((o) => o[2] === "role" && o[3] === "status")
  if (!op) throw new Error("no role=status element")
  return op[1] as number
}

function dotsOf(renderer: HeadlessRenderer): StyleDesc[] {
  return divStyles(renderer).filter(
    (style) => typeof style.width === "number" && style.borderRadius === (style.width as number) / 2
  )
}

const TO_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Spinner dots (headless)", () => {
  it("renders three dots whose tones follow the staggered cycle formula", () => {
    const app = mountSpinner({ phase: 0 })
    const dots = dotsOf(app.renderer)
    expect(dots).toHaveLength(3)
    // cycleTone(0, ix * 180): the first dot sits at the trough; the later
    // dots' negative effective elapsed wraps modulo the period.
    for (const [index, dot] of dots.entries()) {
      const t = ((((0 - index * 180) % 1200) + 1200) % 1200) / 1200
      expect(dot.opacity).toBeCloseTo(0.25 + 0.75 * Math.sin(Math.PI * t), 10)
    }
    app.unmount()
  })

  it("staggers dot opacity through the phase with a descending ramp", () => {
    const app = mountSpinner({ phase: 300 })
    const dots = dotsOf(app.renderer)
    expect(dots).toHaveLength(3)
    const [first, second, third] = dots.map((dot) => dot.opacity as number)
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
    expect(first).toBeLessThanOrEqual(1)
    expect(third).toBeGreaterThanOrEqual(0.25)
    // cycleTone(300, 0) is the first dot's peak formula, checked exactly.
    expect(first).toBeCloseTo(0.25 + 0.75 * Math.sin(Math.PI * 0.25), 10)
    app.unmount()
  })

  it("wraps a phase past one period and treats negative delays modulo", () => {
    // 1500ms is 300ms into the second cycle; the third dot's delay of 360ms
    // pushes its effective elapsed negative before the modulo normalization.
    const app = mountSpinner({ phase: 1500 })
    const [first] = dotsOf(app.renderer).map((dot) => dot.opacity as number)
    expect(first).toBeCloseTo(0.25 + 0.75 * Math.sin(Math.PI * 0.25), 10)
    const third = dotsOf(app.renderer).map((dot) => dot.opacity as number)[2]!
    expect(third).toBeGreaterThanOrEqual(0.25)
    app.unmount()
  })

  it("honours a custom dot size, including the rounded gap", () => {
    const app = mountSpinner({ phase: 0, size: 12 })
    const dots = dotsOf(app.renderer)
    expect(dots).toHaveLength(3)
    for (const dot of dots) {
      expect(dot.width).toBe(12)
      expect(dot.height).toBe(12)
      expect(dot.borderRadius).toBe(6)
    }
    expect(divStyles(app.renderer)[0]).toMatchObject({ gap: 7, display: "flex" })
    app.unmount()
  })

  it("announces itself through role=status and the label", () => {
    const app = mountSpinner({ phase: 0, label: "Thinking" })
    const id = statusId(app.renderer)
    expect(customProp(app.renderer, id, "aria-label")).toBe("Thinking")
    app.unmount()

    const unlabeled = mountSpinner({ phase: 0 })
    expect(customProp(unlabeled.renderer, statusId(unlabeled.renderer), "aria-label")).toBe(
      "Loading"
    )
    unlabeled.unmount()
  })

  it("pinned phases never start the timer", () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const app = mountSpinner({ phase: 0 })
    expect(vi.getTimerCount()).toBe(0)
    app.unmount()
  })

  it("ticks dot opacity from the 25fps timer while mounted and stops on unmount", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const app = mountSpinner()
    expect(vi.getTimerCount()).toBe(1)
    const tone = (elapsed: number, index: number) => {
      const t = ((((elapsed - index * 180) % 1200) + 1200) % 1200) / 1200
      return 0.25 + 0.75 * Math.sin(Math.PI * t)
    }
    const before = dotsOf(app.renderer).map((dot) => dot.opacity as number)
    for (const [index, opacity] of before.entries()) {
      expect(opacity).toBeCloseTo(tone(0, index), 10)
    }

    await vi.advanceTimersByTimeAsync(40)
    await app.settle()
    const after = dotsOf(app.renderer).map((dot) => dot.opacity as number)
    for (const [index, opacity] of after.entries()) {
      expect(opacity).toBeCloseTo(tone(40, index), 10)
    }

    // A full period later the pattern repeats at the same elapsed offset.
    await vi.advanceTimersByTimeAsync(1200)
    await app.settle()
    const wrapped = dotsOf(app.renderer).map((dot) => dot.opacity as number)
    expect(wrapped[0]).toBeCloseTo(after[0]!, 10)

    app.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("Spinner pulse (headless)", () => {
  function pulseStyles(renderer: HeadlessRenderer) {
    const styles = divStyles(renderer)
    const track = styles.find((style) => style.position === "relative")
    const segment = styles.find((style) => style.position === "absolute")
    return { track, segment }
  }

  it("slides the segment to the far end halfway through the cycle", () => {
    const app = mountSpinner({ variant: "pulse", phase: 600, width: 100, size: 4 })
    const { track, segment } = pulseStyles(app.renderer)
    expect(track).toMatchObject({
      width: 100,
      height: 4,
      borderRadius: 2,
      backgroundColor: "rgba(139, 143, 163, 0.25)",
    })
    expect(segment).toMatchObject({
      top: 0,
      left: 65,
      width: 35,
      height: 4,
      backgroundColor: "#8b8fa3",
    })
    app.unmount()
  })

  it("sits centered at the quarter cycle with default width and height", () => {
    const app = mountSpinner({ variant: "pulse", phase: 300 })
    const { track, segment } = pulseStyles(app.renderer)
    expect(track).toMatchObject({ width: 96, height: 4 })
    // slide = 0.5, segment = 33.6 → left = (96 - 33.6) / 2 = 31.2
    expect(segment!.left).toBeCloseTo(31.2, 10)
    expect(segment!.width).toBeCloseTo(33.6, 10)
    app.unmount()
  })

  it("expands 3-digit hex colors for the track tint", () => {
    const app = mountSpinner({ variant: "pulse", phase: 0, color: "#f80" })
    const { track, segment } = pulseStyles(app.renderer)
    expect(track!.backgroundColor).toBe("rgba(255, 136, 0, 0.25)")
    expect(segment!.backgroundColor).toBe("#f80")
    app.unmount()
  })

  it("falls back to the raw string for an unparseable color", () => {
    const app = mountSpinner({ variant: "pulse", phase: 0, color: "not-a-hex" })
    const { track } = pulseStyles(app.renderer)
    expect(track!.backgroundColor).toBe("not-a-hex")
    app.unmount()
  })

  it("keeps the segment at least 12px wide on a narrow track", () => {
    const app = mountSpinner({ variant: "pulse", phase: 0, width: 20 })
    const { segment } = pulseStyles(app.renderer)
    expect(segment!.width).toBe(12)
    expect(segment!.left).toBe(0)
    app.unmount()
  })

  it("keeps the status role and label on the pulse track", () => {
    const app = mountSpinner({ variant: "pulse", phase: 0, label: "Working" })
    const id = statusId(app.renderer)
    expect(customProp(app.renderer, id, "aria-label")).toBe("Working")
    app.unmount()
  })
})
