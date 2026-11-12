/** GPU-backed focus styles tests, ported from upstream's styles suite
 *  (remorses/gpuix focus topic: `dced20d` style half through `5187660`):
 *  keyboard focus dims every other focusable element to 40% (paint only —
 *  bounds never move), `focusVisible` styles only the keyboard-focused
 *  element, `keyboardFocusDim: false` opts one element out and the root
 *  option turns the dim off for the whole window, and a focused text field
 *  dims nothing. Pixel-level assertions run only off CI (Metal on macOS VMs
 *  does not repaint between captures); the equality checks still run there
 *  and the focus/bounds checks run everywhere. */

// @ts-nocheck

import { readFileSync } from "fs"
import { join } from "path"
import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { HostNode } from "../types.js"
import { readPng } from "./png-readback.js"
import { isCI, SHOTS_DIR } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const targetStyle = (focusVisible) => ({
  width: 80,
  height: 40,
  borderRadius: 8,
  backgroundColor: "#303030",
  focusVisible,
})

describeNative("focus styles (vue)", () => {
  const apps: Array<ReturnType<typeof createTestApp>> = []

  beforeEach(() => {
    while (apps.length) apps.pop().unmount()
  })

  // One renderer per scene, so each capture is the frame after the input
  // that decided focus-visible (a keyboard Tab or a mouse press).
  function scene({ focusVisible, otherStyle, field, keyboardFocusDim } = {}) {
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{
            display: "flex",
            gap: 24,
            padding: 32,
            width: "100%",
            height: "100%",
            backgroundColor: "#101010",
          }}
        >
          <div autoFocus tabIndex={0} testId="start" style={{ width: 1, height: 1 }} />
          {field ? (
            <input testId="target" style={targetStyle(focusVisible)} />
          ) : (
            <div tabIndex={0} testId="target" style={targetStyle(focusVisible)} />
          )}
          <div
            tabIndex={0}
            testId="other"
            style={{ width: 40, height: 40, backgroundColor: "#505050", ...otherStyle }}
          />
        </div>
      ),
    })
    const app = createTestApp(App, { width: 240, height: 120, keyboardFocusDim })
    apps.push(app)
    return app
  }

  function run(name: string, input: "none" | "tab" | "click", options = {}) {
    const app = scene(options)
    const renderer = app.renderer
    const otherBox = () => renderer.getElementBounds(renderer.findByTestId("other").id)
    if (input === "tab") renderer.simulateKeystrokes("tab")
    if (input === "click") {
      const box = renderer.getElementBounds(renderer.findByTestId("target").id)
      renderer.nativeSimulateClick(box.x + 4, box.y + 4)
      // Make the last input definitively a mouse one.
      renderer.nativeSimulateMouseMove(200, 110)
    }
    const focused = renderer.getFocusedElementId()
    const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
    const focusedTest =
      focused == null
        ? null
        : walk(app.container).find((candidate) => candidate.id === focused)?.props.testId ?? focused

    const file = join(SHOTS_DIR, `focus-${name}.png`)
    renderer.captureScreenshot(file)
    const image = readPng(readFileSync(file))
    const viewport = renderer.getWindowSize()
    const scaleX = image.width / viewport.width
    const scaleY = image.height / viewport.height
    const atOtherCenter = () => {
      const box = otherBox()
      return image.pixel(
        Math.floor((box.x + box.width / 2) * scaleX),
        Math.floor((box.y + box.height / 2) * scaleY),
      )
    }
    return { image, atOtherCenter, bounds: otherBox(), focused: focusedTest }
  }

  const framesEqual = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) return false
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const left = a.pixel(x, y)
        const right = b.pixel(x, y)
        if (left.some((channel, index) => Math.abs(channel - right[index]) > 2)) return false
      }
    }
    return true
  }

  it("dims every other focusable element while a control has keyboard focus", () => {
    const idle = run("idle", "none")
    const keyboard = run("keyboard", "tab")
    const mouse = run("mouse", "click")
    // `keyboardFocusDim: false` on an element opts it out of the dim.
    const optedOut = run("opted-out", "tab", { otherStyle: { keyboardFocusDim: false } })
    // A focusVisible ring does not: the element still dims (and the ring is
    // not painted — the refinement only runs on the focused element itself).
    const ringed = run("ringed", "tab", {
      otherStyle: { focusVisible: { outline: { width: 2, color: "#89b4fa" } } },
    })
    // The root option turns the dim off for the whole window.
    const dimOff = run("dim-off", "tab", { keyboardFocusDim: false })
    // Typing is keyboard input too, so a focused text field dims nothing.
    const fieldMouse = run("field-mouse", "click", { field: true })
    const fieldKeyboard = run("field-keyboard", "tab", { field: true })

    expect([keyboard.focused, mouse.focused, fieldKeyboard.focused, dimOff.focused]).toEqual([
      "target",
      "target",
      "target",
      "target",
    ])
    // Paint only: the dim never moves layout.
    expect(keyboard.bounds).toEqual(idle.bounds)

    // Frames that must match idle pixel for pixel.
    if (!isCI) {
      expect(framesEqual(mouse.image, idle.image)).toBe(true)
      expect(framesEqual(optedOut.image, idle.image)).toBe(true)
      expect(framesEqual(dimOff.image, idle.image)).toBe(true)
      expect(framesEqual(fieldKeyboard.image, fieldMouse.image)).toBe(true)
      expect(framesEqual(ringed.image, keyboard.image)).toBe(true)
      // …and the keyboard frame itself differs: the other element dimmed.
      expect(framesEqual(keyboard.image, idle.image)).toBe(false)
    }
  })
})
