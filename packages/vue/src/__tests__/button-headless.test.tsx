/** Headless logic tests for the Button primitive (upstream `dced20d`, the
 *  Button half): activation from a click, Enter on key-down (not a held
 *  repeat) and Space on key-up, disabled leaving the Tab order while
 *  focusableWhenDisabled keeps it, a prevented key-down blocking activation,
 *  the { disabled } state style function, and asChild merging. Runs against
 *  the mock renderer (see headless.ts) so it works on Linux. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { Button } from "../index.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessApp } from "./headless.js"

function find(app: HeadlessApp, testId: string) {
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return walk(app.container).find((node) => node.props.testId === testId)
}

function click(app: HeadlessApp, testId: string) {
  const node = find(app, testId)
  expect(node, `missing testId: ${testId}`).toBeDefined()
  return app.dispatch({ elementId: node.id, eventType: "click", clickCount: 1 })
}

function keyDown(app: HeadlessApp, testId: string, key: string, extra = {}) {
  return app.dispatch({ elementId: find(app, testId).id, eventType: "keyDown", key, ...extra })
}

function keyUp(app: HeadlessApp, testId: string, key: string, extra = {}) {
  return app.dispatch({ elementId: find(app, testId).id, eventType: "keyUp", key, ...extra })
}

describe("button (headless)", () => {
  let app: HeadlessApp | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("renders a role=button tab stop", async () => {
    const App = defineComponent({
      setup: () => () => (
        <Button testId="save">Save</Button>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    const button = find(app, "save")
    expect(button.props.role).toBe("button")
    expect(button.props.tabIndex).toBe(0)
    expect(app.renderer.allTexts()).toEqual(["Save"])
  })

  it("activates from a click, Enter key-down (not held) and Space key-up", async () => {
    const log: string[] = []
    const App = defineComponent({
      setup: () => () => (
        <Button testId="save" onClick={() => log.push("save")}>Save</Button>
      ),
    })
    app = mountHeadless(App)
    await app.settle()

    click(app, "save")
    keyDown(app, "save", "enter")
    keyDown(app, "save", "enter", { isHeld: true })
    keyDown(app, "save", "space")
    keyUp(app, "save", "space")
    expect(log).toEqual(["save", "save", "save"])
  })

  it("runs the user's key handlers and a prevented key-down blocks activation", async () => {
    const log: string[] = []
    const App = defineComponent({
      setup: () => () => (
        <div>
          <Button
            testId="plain"
            onKeyDown={() => log.push("down")}
            onKeyUp={() => log.push("up")}
            onClick={() => log.push("plain")}
          >
            Plain
          </Button>
          <Button
            testId="prevented"
            onKeyDown={(event) => {
              log.push("down")
              event.preventDefault()
            }}
            onClick={() => log.push("prevented")}
          >
            Prevented
          </Button>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()

    keyDown(app, "plain", "enter")
    keyUp(app, "plain", "space")
    expect(log).toEqual(["down", "plain", "up", "plain"])

    // A prevented key-down blocks activation, and because both halves of the
    // keystroke share one keystrokeId (like a native dispatch), the flag also
    // suppresses the Space key-up activation.
    keyDown(app, "prevented", "enter", { keystrokeId: 7 })
    keyUp(app, "prevented", "space", { keystrokeId: 7 })
    expect(log).toEqual(["down", "plain", "up", "plain", "down"])
  })

  it("disabled leaves the Tab order and swallows activation and the user's onClick", async () => {
    const log: string[] = []
    const App = defineComponent({
      setup: () => () => (
        <div>
          <Button testId="off" disabled onClick={() => log.push("off")}>Off</Button>
          <Button
            testId="busy"
            disabled
            focusableWhenDisabled
            onClick={() => log.push("busy")}
          >
            Busy
          </Button>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()

    expect(find(app, "off").props.tabIndex).toBe(-1)
    expect(find(app, "busy").props.tabIndex).toBe(0)

    click(app, "off")
    keyDown(app, "off", "enter")
    keyUp(app, "off", "space")
    click(app, "busy")
    keyDown(app, "busy", "enter")
    keyUp(app, "busy", "space")
    expect(log).toEqual([])
  })

  it("style may be a function of { disabled }", async () => {
    const disabled = ref(false)
    const App = defineComponent({
      setup: () => () => (
        <Button
          testId="styled"
          disabled={disabled.value}
          style={({ disabled }) => ({ opacity: disabled ? 0.4 : 1 })}
        >
          Save
        </Button>
      ),
    })
    app = mountHeadless(App)
    await app.settle()
    expect(app.renderer.lastStyle(find(app, "styled").id)).toEqual({ opacity: 1 })

    disabled.value = true
    await app.settle()
    expect(app.renderer.lastStyle(find(app, "styled").id)).toEqual({ opacity: 0.4 })
  })

  it("asChild merges button behavior onto the single child and keeps its own tabIndex", async () => {
    const log: string[] = []
    const App = defineComponent({
      setup: () => () => (
        <div>
          <Button asChild testId="row" onClick={() => log.push("row")}>
            <div testId="child" tabIndex={3}>Row</div>
          </Button>
          <Button asChild testId="off" disabled onClick={() => log.push("off")}>
            <div testId="child-off" tabIndex={3}>Off</div>
          </Button>
        </div>
      ),
    })
    app = mountHeadless(App)
    await app.settle()

    // The child itself is the button: one element, merged props (the Button's
    // own testId wins over the child's, like any cloneVNode merge), no wrapper.
    expect(
      app.container.children.flatMap((child) => child.children).map((child) => child.props.testId)
    ).toEqual(["row", "off"])
    expect(app.renderer.allTexts()).toEqual(["Row", "Off"])

    const row = find(app, "row")
    expect(row.props.role).toBe("button")
    expect(row.props.tabIndex).toBe(3)
    click(app, "row")
    keyDown(app, "row", "enter")
    expect(log).toEqual(["row", "row"])

    expect(find(app, "off").props.tabIndex).toBe(-1)
    click(app, "off")
    expect(log).toEqual(["row", "row"])
  })
})
