/** Dev-mode warning when a plain scroll `<div>` retains more than 300
 *  children, steering long collections to `<virtual-list>`. Headless: no GPU. */

import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mountHeadless } from "./headless.js"

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  vi.restoreAllMocks()
  process.env.NODE_ENV = originalNodeEnv
})

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => h("div", { key: i }))
}

describe("long plain scroll container warning", () => {
  it("warns once when a plain scroll div mounts more than 300 children", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const App = defineComponent({
      setup: () => () =>
        h("div", { testId: "big-list", style: { overflowY: "scroll" } }, makeItems(305)),
    })
    const app = mountHeadless(App)
    try {
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain("<virtual-list>")
      expect(warn.mock.calls[0]?.[0]).toContain('testId="big-list"')
      expect(warn.mock.calls[0]?.[0]).toContain("305 children")
    } finally {
      app.unmount()
    }
  })

  it("does not warn at 300 children and warns once when growing past 300", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const count = ref(300)
    const App = defineComponent({
      setup: () => () =>
        h("div", { style: { overflow: "scroll" } }, makeItems(count.value)),
    })
    const app = mountHeadless(App)
    try {
      expect(warn).not.toHaveBeenCalled()

      count.value = 301
      await app.settle()
      expect(warn).toHaveBeenCalledTimes(1)

      count.value = 350
      await app.settle()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      app.unmount()
    }
  })

  it("does not warn for <virtual-list> or non-scrolling <div>", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const App = defineComponent({
      setup: () => () =>
        h("div", null, [
          h("virtual-list", { style: { height: 400 } }, makeItems(400)),
          h("div", { style: { overflowY: "hidden" } }, makeItems(400)),
          h("div", null, makeItems(400)),
        ]),
    })
    const app = mountHeadless(App)
    try {
      expect(warn).not.toHaveBeenCalled()
    } finally {
      app.unmount()
    }
  })

  it("is silent in production mode", () => {
    process.env.NODE_ENV = "production"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const App = defineComponent({
      setup: () => () =>
        h("div", { style: { overflowY: "scroll" } }, makeItems(400)),
    })
    const app = mountHeadless(App)
    try {
      expect(warn).not.toHaveBeenCalled()
    } finally {
      app.unmount()
    }
  })
})
