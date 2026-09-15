/** Dynamic menus: the test bridge records the converted menus (validating
 *  them through the production path) and drives item clicks through the armed
 *  callback. */

// @ts-nocheck

import { describe, expect, it } from "vitest"
import { TestRenderer, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative("dynamic menus", () => {
  it("records installed menus", () => {
    const renderer = new TestRenderer()
    renderer.setMenus(
      [
        {
          name: "Chat",
          items: [
            { label: "About Chat", id: "about" },
            { separator: true },
            {
              label: "Settings…",
              id: "settings",
              keystroke: "cmd-,",
            },
            { separator: true },
            { label: "Quit Chat", system: "quit", keystroke: "cmd-q" },
          ],
        },
      ],
      () => {}
    )

    const menus = renderer.getLastMenus()
    expect(menus).not.toBeNull()
    expect(menus[0].name).toBe("Chat")
    const items = menus[0].items
    expect(items[0].label).toBe("About Chat")
    expect(items[1].separator).toBe(true)
    expect(items[2].keystroke).toBe("cmd-,")
    expect(items[4].system).toBe("quit")
  })

  it("delivers item clicks to the callback", async () => {
    const renderer = new TestRenderer()
    const fired = []
    renderer.setMenus(
      [{ name: "Chat", items: [{ label: "Settings", id: "settings" }] }],
      (id) => fired.push(id)
    )

    renderer.fireMenuAction("settings")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fired).toEqual(["settings"])
  })

  it("rejects an item with no id, system action, submenu, or separator", () => {
    const renderer = new TestRenderer()
    expect(() =>
      renderer.setMenus([{ name: "Chat", items: [{ label: "Dangling" }] }], () => {})
    ).toThrow(/id/)
  })

  it("rejects an unknown system action", () => {
    const renderer = new TestRenderer()
    expect(() =>
      renderer.setMenus([{ name: "Chat", items: [{ system: "explode" }] }], () => {})
    ).toThrow(/unknown system menu action/)
  })
})
