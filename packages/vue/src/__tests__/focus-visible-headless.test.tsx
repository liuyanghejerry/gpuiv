/** Headless wire tests for the keyboard focus dim (upstream gpuix focus
 *  topic): every root creation sends one setKeyboardFocusDim op with the
 *  resolved value (default true, so a remount without the option restores
 *  the default), and popup surfaces declare keyboardFocusDim: false. Runs
 *  against the mock renderer (see headless.ts). */

// @ts-nocheck

import { defineComponent } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { Dialog, DialogBackdrop, DialogClose, DialogPopup, DialogPortal, DialogTrigger } from "../index.js"
import { mountHeadless } from "./headless.js"
import type { HeadlessApp } from "./headless.js"

function find(app: HeadlessApp, testId: string) {
  const walk = (node) => [node, ...node.children.flatMap(walk)]
  return walk(app.container).find((node) => node.props.testId === testId)
}

describe("focus-visible wire (headless)", () => {
  let app: HeadlessApp | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("sends setKeyboardFocusDim once per root, defaulting to true", async () => {
    app = mountHeadless(defineComponent({ setup: () => () => <div /> }))
    await app.settle()
    expect(app.renderer.opsOf("setKeyboardFocusDim")).toEqual([["setKeyboardFocusDim", true]])
  })

  it("the root option turns the dim off", async () => {
    app = mountHeadless(defineComponent({ setup: () => () => <div /> }), {
      keyboardFocusDim: false,
    })
    await app.settle()
    expect(app.renderer.opsOf("setKeyboardFocusDim")).toEqual([["setKeyboardFocusDim", false]])
  })

  it("the dialog popup opts itself out of the dim", async () => {
    app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <Dialog defaultOpen>
            <DialogTrigger>Open</DialogTrigger>
            <DialogPortal>
              <DialogBackdrop />
              <DialogPopup testId="popup" style={{ width: 300 }}>
                <DialogClose>Close</DialogClose>
              </DialogPopup>
            </DialogPortal>
          </Dialog>
        ),
      }),
    )
    await app.settle()
    const style = app.renderer.lastStyle(find(app, "popup").id)
    expect(style.keyboardFocusDim).toBe(false)
    expect(style.width).toBe(300)
  })
})
