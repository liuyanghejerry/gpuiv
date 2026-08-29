/** Identity tests: every host element that JS can style or target must own a
 *  stable GPUI element id and record its painted bounds.
 *
 * The gaps these cover were all invisible from JS: a prop type-checked, the
 * listener was registered, and nothing ever happened. `<text onClick>` was
 * dropped by a separate text builder, `hover` / `active` were parsed for every
 * element but only consumed by `<div>`, and `<img>` / `<svg>` / `<anchored>`
 * appeared in the automation tree with no box to click.
 *
 * Ported from upstream's React `element-identity.test.tsx`. */

import fs from "fs"
import path from "path"
import { defineComponent, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "../testing.js"
import { expectScreenshotsDiffer, SHOTS_DIR } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function shot(name: string): string {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const file = path.join(SHOTS_DIR, `${name}.png`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  return file
}

function bounds(app: TestApp, testId: string) {
  const element = app.renderer.findByTestId(testId)
  expect(element, `missing testId ${testId}`).toBeDefined()
  const rect = app.renderer.getElementBounds(element!.id)
  expect(rect, `no painted bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: rect![0], y: rect![1], width: rect![2], height: rect![3] }
}

describeNative("text element identity", () => {
  let app: TestApp

  it("fires onClick on a <text> node", async () => {
    const count = ref(0)
    const Clickable = defineComponent({
      setup() {
        return () => (
          <text
            style={{ width: 200, height: 60 }}
            onClick={() => {
              count.value++
            }}
          >
            {`clicks: ${count.value}`}
          </text>
        )
      },
    })

    app = createTestApp(Clickable)
    expect(app.renderer.getAllText()).toEqual(["clicks: 0"])

    app.renderer.nativeSimulateClick(10, 10)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["clicks: 1"])
    app.unmount()
  })

  it("fires onMouseEnter and onMouseLeave on a <text> node", async () => {
    const hovered = ref(false)
    const Hoverable = defineComponent({
      setup() {
        return () => (
          <text
            style={{ width: 200, height: 100 }}
            onMouseEnter={() => {
              hovered.value = true
            }}
            onMouseLeave={() => {
              hovered.value = false
            }}
          >
            {hovered.value ? "hovered" : "idle"}
          </text>
        )
      },
    })

    app = createTestApp(Hoverable)
    expect(app.renderer.getAllText()).toEqual(["idle"])

    app.renderer.nativeSimulateMouseMove(50, 50)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["hovered"])

    app.renderer.nativeSimulateMouseMove(600, 600)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["idle"])
    app.unmount()
  })

  // Now that `<text>` runs through the same builder as `<div>`, a filled text
  // node inserts a hitbox and stops clicks behind it, exactly like an HTML
  // element with a background. The old text builder inserted none.
  it("blocks a click behind a filled <text>", async () => {
    const behind = vi.fn()
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 600, height: 400 }} onClick={behind}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 200,
                height: 100,
              }}
            >
              <text style={{ width: 200, height: 100, backgroundColor: "#f38ba8" }}>
                label
              </text>
            </div>
          </div>
        )
      },
    })

    app = createTestApp(App)

    app.renderer.nativeSimulateClick(100, 50)
    await app.settle()
    expect(behind).not.toHaveBeenCalled()

    app.renderer.nativeSimulateClick(400, 300)
    await app.settle()
    expect(behind).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it("paints the hover style declared on a <text> node", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
            <text
              style={{
                width: 400,
                height: 120,
                backgroundColor: "#1e1e2e",
                hover: { backgroundColor: "#f38ba8" },
              }}
            >
              hover target
            </text>
          </div>
        )
      },
    })

    app = createTestApp(App)

    app.renderer.nativeSimulateMouseMove(1200, 700)
    await app.settle()
    const before = shot("identity-text-hover-before")
    app.renderer.captureScreenshot(before)

    app.renderer.nativeSimulateMouseMove(200, 60)
    await app.settle()
    const after = shot("identity-text-hover-after")
    app.renderer.captureScreenshot(after)

    expectScreenshotsDiffer(before, after)
    app.unmount()
  })
})

describeNative("pseudo styles on native surfaces", () => {
  let app: TestApp

  it("paints the hover style declared on a <code> block", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
            <code
              code={"const answer = 42\n"}
              language="ts"
              style={{
                width: 500,
                height: 120,
                backgroundColor: "#1e1e2e",
                hover: { backgroundColor: "#f38ba8" },
              }}
            />
          </div>
        )
      },
    })

    app = createTestApp(App)

    app.renderer.nativeSimulateMouseMove(1200, 700)
    await app.settle()
    const before = shot("identity-code-hover-before")
    app.renderer.captureScreenshot(before)

    app.renderer.nativeSimulateMouseMove(250, 60)
    await app.settle()
    const after = shot("identity-code-hover-after")
    app.renderer.captureScreenshot(after)

    expectScreenshotsDiffer(before, after)
    app.unmount()
  })

  it("paints the active style on a <div> that has no click listener", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
            <div
              style={{
                width: 400,
                height: 160,
                backgroundColor: "#1e1e2e",
                active: { backgroundColor: "#f38ba8" },
              }}
            />
          </div>
        )
      },
    })

    app = createTestApp(App)

    app.renderer.nativeSimulateMouseMove(200, 80)
    await app.settle()
    const before = shot("identity-active-idle")
    app.renderer.captureScreenshot(before)

    app.renderer.nativeSimulateMouseDown(200, 80)
    await app.settle()
    const after = shot("identity-active-pressed")
    app.renderer.captureScreenshot(after)
    app.renderer.nativeSimulateMouseUp(200, 80)

    expectScreenshotsDiffer(before, after)
    app.unmount()
  })
})

describeNative("events on native surfaces", () => {
  let app: TestApp

  const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#000"/></svg>'

  it("fires onClick on an <svg>", async () => {
    const count = ref(0)
    const Clickable = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <svg
              source={ICON}
              style={{ width: 120, height: 80, color: "#5ca9ff" }}
              onClick={() => {
                count.value++
              }}
            />
            <text>{`clicks: ${count.value}`}</text>
          </div>
        )
      },
    })

    app = createTestApp(Clickable)
    expect(app.renderer.getAllText()).toEqual(["clicks: 0"])

    app.renderer.nativeSimulateClick(60, 40)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["clicks: 1"])
    app.unmount()
  })

  it("fires onMouseEnter and onMouseLeave on an <img>", async () => {
    const fixture = path.join(SHOTS_DIR, "identity-img-events.svg")
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    fs.writeFileSync(fixture, ICON, "utf8")

    const hovered = ref(false)
    const Hoverable = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <img
              src={fixture}
              objectFit="fill"
              style={{ width: 200, height: 120 }}
              onMouseEnter={() => {
                hovered.value = true
              }}
              onMouseLeave={() => {
                hovered.value = false
              }}
            />
            <text>{hovered.value ? "hovered" : "idle"}</text>
          </div>
        )
      },
    })

    app = createTestApp(Hoverable)
    expect(app.renderer.getAllText()).toEqual(["idle"])

    app.renderer.nativeSimulateMouseMove(100, 60)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["hovered"])

    app.renderer.nativeSimulateMouseMove(900, 700)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["idle"])
    app.unmount()
  })

  it("fires onClick on an <anchored> overlay", async () => {
    const count = ref(0)
    const Menu = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 800, height: 500 }}>
            <text>{`picked: ${count.value}`}</text>
            <anchored
              position={{ x: 300, y: 200 }}
              style={{ width: 240, height: 100, backgroundColor: "#1e1e2e" }}
              onClick={() => {
                count.value++
              }}
            >
              <text>item</text>
            </anchored>
          </div>
        )
      },
    })

    app = createTestApp(Menu)
    expect(app.renderer.getAllText()).toEqual(["picked: 0", "item"])

    app.renderer.nativeSimulateClick(420, 250)
    await app.settle()
    expect(app.renderer.getAllText()).toEqual(["picked: 1", "item"])
    app.unmount()
  })
})

describeNative("painted bounds for leaf surfaces", () => {
  let app: TestApp

  it("records bounds for <svg> without changing its layout box", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: 600, height: 300, padding: 20 }}>
            <svg
              testId="icon"
              source={
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#000"/></svg>'
              }
              style={{ width: 48, height: 32, color: "#5ca9ff" }}
            />
          </div>
        )
      },
    })

    app = createTestApp(App)

    const icon = bounds(app, "icon")
    expect(icon.width).toBeCloseTo(48, 0)
    expect(icon.height).toBeCloseTo(32, 0)
    expect(icon.x).toBeCloseTo(20, 0)
    expect(icon.y).toBeCloseTo(20, 0)
    app.unmount()
  })

  it("records bounds for <img> without changing its layout box", async () => {
    const fixture = path.join(SHOTS_DIR, "identity-img-fixture.svg")
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    fs.writeFileSync(
      fixture,
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#5ca9ff"/></svg>',
      "utf8",
    )

    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ display: "flex", width: 600, height: 300, padding: 24 }}>
            <img testId="picture" src={fixture} style={{ width: 200, height: 100 }} />
          </div>
        )
      },
    })

    app = createTestApp(App)

    const picture = bounds(app, "picture")
    expect(picture.width).toBeCloseTo(200, 0)
    expect(picture.height).toBeCloseTo(100, 0)
    expect(picture.x).toBeCloseTo(24, 0)
    expect(picture.y).toBeCloseTo(24, 0)
    app.unmount()
  })

  it("records the overlay bounds of a deferred <anchored>, not its trigger", async () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 800, height: 400 }}>
            <div testId="trigger" style={{ width: 120, height: 40 }}>
              <text>trigger</text>
              <anchored
                testId="overlay"
                position={{ x: 300, y: 200 }}
                style={{ width: 260, height: 90, backgroundColor: "#1e1e2e" }}
              >
                <text>overlay</text>
              </anchored>
            </div>
          </div>
        )
      },
    })

    app = createTestApp(App)

    const trigger = bounds(app, "trigger")
    const overlay = bounds(app, "overlay")
    expect(overlay.width).toBeCloseTo(260, 0)
    expect(overlay.height).toBeCloseTo(90, 0)
    expect(overlay.x).toBeCloseTo(300, 0)
    expect(overlay.y).toBeCloseTo(200, 0)
    expect(overlay.x).not.toBeCloseTo(trigger.x, 0)
    app.unmount()
  })
})

describeNative("gpui image state", () => {
  // gpui keeps `ImgState` (the animated-GIF frame index and the delayed loading
  // placeholder) in `InteractiveElementState`, which only exists when the
  // element has a `GlobalElementId`.
  //
  // The animation itself cannot be asserted here: `Img::request_layout` only
  // advances a frame while `window.is_window_active()`, and the test renderer
  // builds its window through gpui's `VisualTestContext::open_offscreen_window`,
  // which passes `focus: false`, so the window never becomes active. `active`
  // styling reads the same element state through the same id, so it proves the
  // id is there without depending on the animation clock.
  it("gives <img> element state that only a GPUI id can provide", async () => {
    const fixture = path.join(SHOTS_DIR, "identity-img-state.svg")
    fs.mkdirSync(SHOTS_DIR, { recursive: true })
    fs.writeFileSync(
      fixture,
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#5ca9ff"/></svg>',
      "utf8",
    )

    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
            <img
              src={fixture}
              objectFit="fill"
              style={{ width: 320, height: 200, active: { opacity: 0.2 } }}
            />
          </div>
        )
      },
    })

    const app = createTestApp(App)

    for (let i = 0; i < 5; i++) await app.settle()
    app.renderer.nativeSimulateMouseMove(160, 100)
    await app.settle()
    const idle = shot("identity-img-active-idle")
    app.renderer.captureScreenshot(idle)

    app.renderer.nativeSimulateMouseDown(160, 100)
    await app.settle()
    const pressed = shot("identity-img-active-pressed")
    app.renderer.captureScreenshot(pressed)
    app.renderer.nativeSimulateMouseUp(160, 100)

    expectScreenshotsDiffer(idle, pressed)
    app.unmount()
  })
})
