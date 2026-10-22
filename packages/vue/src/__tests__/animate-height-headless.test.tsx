/// Headless logic tests for AnimateHeight: when the motion track attaches,
/// generation bumps on target/duration/ease changes, the measured auto
/// height arriving one bounds-poll later, and the onMotionComplete
/// generation filter. Runs against the mock renderer (see headless.ts) so
/// it works on Linux.

import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AnimateHeight } from "../components/animate-height.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessRenderer } from "./headless.js"
import type { MotionStyle, MotionTransition } from "../types.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

interface MotionDesc {
  generation: number
  initial: MotionStyle | false
  animate: MotionStyle
  transition: MotionTransition
}

function customProp<T = unknown>(
  renderer: HeadlessRenderer,
  id: number,
  key: string
): T | undefined {
  const ops = renderer.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
  return ops.length ? (ops[ops.length - 1]![3] as T) : undefined
}

interface HarnessOptions {
  height: number | "auto"
  duration?: number
  ease?: MotionTransition["ease"]
  initialHeight?: number
  onMotionComplete?: (event: { motionGeneration: number }) => void
}

/** Mounts one AnimateHeight around a body that paints "Body". Returns
 *  handles to the wrapper ids: root is the animated box, measure the
 *  natural-height probe inside it. */
function mountAnimateHeight(options: HarnessOptions) {
  const height = ref<number | "auto">(options.height)
  const bump = ref(0)
  const complete = options.onMotionComplete
  const component = defineComponent({
    setup: () => () =>
      h(
        "div",
        // A toggled style forces a parent re-render (and thus an
        // AnimateHeight re-render) without remounting the instance.
        { style: { opacity: bump.value % 2 === 0 ? 1 : 0.99 } },
        h(
          AnimateHeight,
          {
            height: height.value,
            ...(options.duration === undefined ? {} : { duration: options.duration }),
            ...(options.ease === undefined ? {} : { ease: options.ease }),
            ...(options.initialHeight === undefined
              ? {}
              : { initialHeight: options.initialHeight }),
            ...(complete === undefined ? {} : { onMotionComplete: complete }),
          },
          { default: () => "Body" }
        )
      ),
  })
  const app = mountHeadless(component)
  const textId = () => app.renderer.idsWithText("Body")[0]!
  // Structure: animated root → natural-height probe (ref: content) → text.
  const measureId = () => app.renderer.parentOf(textId())!
  const rootId = () => app.renderer.parentOf(measureId())!
  return {
    app,
    height,
    bump,
    rootId,
    measureId,
    motion: () => customProp<MotionDesc>(app.renderer, rootId(), "motion"),
    style: () => app.renderer.lastStyle(rootId()),
  }
}

const TO_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("AnimateHeight (headless)", () => {
  it("attaches a motion track for a numeric target on mount", () => {
    const { app, motion, style } = mountAnimateHeight({ height: 0 })
    expect(motion()).toEqual({
      generation: expect.any(Number),
      initial: false,
      animate: { height: 0 },
      transition: { duration: 0.3 },
    })
    expect(style()).toMatchObject({ overflow: "hidden", flexShrink: 0 })
    expect("height" in (style() ?? {})).toBe(false)
    app.unmount()
  })

  it("starts from initialHeight and drops the static height once armed", async () => {
    const { app, height, motion, style } = mountAnimateHeight({ height: 0, initialHeight: 40 })
    expect(style()).toMatchObject({ height: 40 })
    expect(motion()).toMatchObject({ initial: { height: 40 }, animate: { height: 0 } })

    height.value = 50
    await app.settle()
    expect(motion()).toMatchObject({ initial: false, animate: { height: 50 } })
    // Once armed, height lives on the motion track, never on the style.
    expect("height" in (style() ?? {})).toBe(false)
    app.unmount()
  })

  it("bumps the generation on a target change but not on an identical retarget", async () => {
    const { app, height, motion, bump } = mountAnimateHeight({ height: 0 })
    const first = motion()!.generation

    height.value = 50
    await app.settle()
    const second = motion()!.generation
    expect(second).toBeGreaterThan(first)
    expect(motion()!.animate).toEqual({ height: 50 })

    // An unrelated re-render keeps the same track and generation.
    bump.value += 1
    await app.settle()
    expect(motion()!.generation).toBe(second)
    app.unmount()
  })

  it("keys duration and ease into the track and the transition", async () => {
    const { app, height, motion } = mountAnimateHeight({ height: 0, duration: 0.5 })
    expect(motion()!.transition).toEqual({ duration: 0.5 })
    const before = motion()!.generation

    height.value = 40
    await app.settle()
    expect(motion()!.transition).toEqual({ duration: 0.5 })

    // Changing only the ease still retargets on a fresh generation.
    const eased = mountAnimateHeight({ height: 0, ease: "easeOut" })
    expect(eased.motion()!.transition).toEqual({ duration: 0.3, ease: "easeOut" })
    const easedGeneration = eased.motion()!.generation
    expect(easedGeneration).not.toBe(before)
    eased.app.unmount()
    app.unmount()
  })

  it("waits for the measured height before animating an auto target", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const { app, motion, style, measureId } = mountAnimateHeight({ height: "auto" })

    // Unmeasured: render naturally, no motion prop at all.
    expect(motion()).toBeUndefined()
    expect("height" in (style() ?? {})).toBe(false)
    expect(app.renderer.allTexts()).toContain("Body")

    app.renderer.elementBounds.set(measureId(), { x: 0, y: 0, width: 200, height: 80 })
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    expect(motion()).toMatchObject({ initial: false, animate: { height: 80 } })

    // Following the content as it grows retargets on a new generation.
    const grown = motion()!.generation
    app.renderer.elementBounds.set(measureId(), { x: 0, y: 0, width: 200, height: 120 })
    await vi.advanceTimersByTimeAsync(100)
    await app.settle()
    expect(motion()).toMatchObject({ animate: { height: 120 } })
    expect(motion()!.generation).toBeGreaterThan(grown)
    app.unmount()
  })

  it("never un-arms the motion prop when an auto target loses its measurement", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] })
    const { app, height, motion } = mountAnimateHeight({ height: 0 })
    expect(motion()!.animate).toEqual({ height: 0 })
    const armed = motion()!.generation

    // Switch to auto before any bounds exist: target null but already armed,
    // so the wrapper keeps its last track with an empty animate.
    height.value = "auto"
    await app.settle()
    expect(motion()).toEqual({ generation: armed, initial: false, animate: {} })
    app.unmount()
  })

  it("filters onMotionComplete by generation and fans arrays out", async () => {
    const single: number[] = []
    const first: number[] = []
    const second: number[] = []
    const onEvent = (event: { motionGeneration: number }) => single.push(event.motionGeneration)
    const { app, height, motion, rootId } = mountAnimateHeight({
      height: 0,
      onMotionComplete: onEvent,
    })
    expect(app.renderer.hasListener(rootId(), "motionComplete")).toBe(true)

    height.value = 60
    await app.settle()
    const current = motion()!.generation

    app.dispatch({ elementId: rootId(), eventType: "motionComplete", motionGeneration: current - 1 })
    await app.settle()
    expect(single).toEqual([])

    app.dispatch({ elementId: rootId(), eventType: "motionComplete", motionGeneration: current })
    await app.settle()
    expect(single).toEqual([current])
    app.unmount()

    // An array of handlers: every member receives the matching completion.
    const arrayApp = mountAnimateHeight({
      height: 0,
      onMotionComplete: [
        (event: { motionGeneration: number }) => first.push(event.motionGeneration),
        (event: { motionGeneration: number }) => second.push(event.motionGeneration),
      ] as unknown as (event: { motionGeneration: number }) => void,
    })
    const generation = arrayApp.motion()!.generation
    arrayApp.app.dispatch({
      elementId: arrayApp.rootId(),
      eventType: "motionComplete",
      motionGeneration: generation,
    })
    await arrayApp.app.settle()
    expect(first).toEqual([generation])
    expect(second).toEqual([generation])
    arrayApp.app.unmount()
  })

  it("leaves the motion prop unset without an onMotionComplete attr", () => {
    const { app, rootId } = mountAnimateHeight({ height: 0 })
    expect(app.renderer.hasListener(rootId(), "motionComplete")).toBe(false)
    app.unmount()
  })

  it("spreads attrs onto the animated root and keeps the probe layout-only", () => {
    const height = ref<number | "auto">(0)
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <AnimateHeight height={height.value} testId="drawer" style={{ width: 180 }}>
            Body
          </AnimateHeight>
        ),
      })
    )
    const textId = app.renderer.idsWithText("Body")[0]!
    const measure = app.renderer.parentOf(textId)!
    const root = app.renderer.parentOf(measure)!
    expect(customProp(app.renderer, root, "testId")).toBe("drawer")
    expect(app.renderer.lastStyle(root)).toMatchObject({ width: 180, overflow: "hidden" })
    expect(app.renderer.lastStyle(measure)).toEqual({ flexShrink: 0 })
    app.unmount()
  })
})
