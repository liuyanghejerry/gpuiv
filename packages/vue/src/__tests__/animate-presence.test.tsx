/** GPU-backed tests for AnimatePresence exit animations over motion.div. */

// @ts-nocheck

import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { AnimatePresence } from "../components/animate-presence.js"
import { motion } from "../components/motion.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

/** Vue brackets slot fragments with empty text anchors; they are layout-free
 *  (the native empty-text fix) and irrelevant to presence assertions. */
function texts(app: { renderer: { getAllText(): string[] } }): string[] {
  return app.renderer.getAllText().filter((text) => text !== "")
}

/** The harness mounts the app under a root wrapper div; the motion child is
 *  the div carrying the `motion` custom prop. */
function motionDiv(app: { renderer: { findByType(t: string): Array<{ customProps?: Record<string, unknown> }> } }) {
  return app.renderer.findByType("div").find((el) => el.customProps?.motion)
}

describeNative("AnimatePresence", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  function mountShowCard(show, options = {}) {
    const App = defineComponent({
      setup() {
        return () => (
          <AnimatePresence initial={options.initial ?? true}>
            {show.value ? (
              <motion.div
                key="card"
                initial={options.motionInitial ?? false}
                animate={{ opacity: 1 }}
                exit={options.exit}
                transition={options.transition ?? { duration: 0.2, ease: "linear" }}
              >
                <text>{options.label ?? "Leaving"}</text>
              </motion.div>
            ) : null}
          </AnimatePresence>
        )
      },
    })
    app = createTestApp(App)
    return app
  }

  it("keeps an exiting motion.div until the exit target finishes", async () => {
    const show = ref(true)
    app = mountShowCard(show, { exit: { opacity: 0 } })
    await app.settle()
    expect(texts(app)).toEqual(["Leaving"])

    app.renderer.clockPause()
    show.value = false
    await app.settle()
    expect(texts(app)).toEqual(["Leaving"])

    app.renderer.clockFastForward(100)
    app.renderer.flush()
    app.renderer.dispatchNativeEvents()
    expect(texts(app)).toEqual(["Leaving"])

    app.renderer.clockFastForward(100)
    app.renderer.flush()
    app.renderer.dispatchNativeEvents()
    await app.settle()
    expect(texts(app)).toEqual([])
  })

  it("skips enter when AnimatePresence initial is false", async () => {
    const show = ref(true)
    app = mountShowCard(show, {
      initial: false,
      motionInitial: { opacity: 0 },
      exit: { opacity: 0 },
    })
    await app.settle()

    expect(motionDiv(app)?.customProps?.motion).toMatchObject({
      initial: false,
      animate: { opacity: 1 },
    })
  })

  it("removes a child without an exit target", async () => {
    const show = ref(true)
    app = mountShowCard(show, { exit: undefined })
    await app.settle()
    expect(texts(app)).toEqual(["Leaving"])

    show.value = false
    await app.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await app.settle()
    expect(texts(app)).toEqual([])
  })

  it("removes a child when the exit target already matches", async () => {
    const show = ref(true)
    app = mountShowCard(show, { exit: { opacity: 1 } })
    await app.settle()

    app.renderer.clockPause()
    show.value = false
    await app.settle()
    // Zero distance to travel: settles on the next frame.
    app.renderer.flush()
    app.renderer.dispatchNativeEvents()
    await app.settle()
    expect(texts(app)).toEqual([])
  })

  it("does not retain a child after an invalid exit target", async () => {
    const show = ref(true)
    app = mountShowCard(show, { exit: { opacity: 2 } })
    await app.settle()

    app.renderer.clockPause()
    show.value = false
    await app.settle()
    app.renderer.flush()
    app.renderer.dispatchNativeEvents()
    await app.settle()
    expect(texts(app)).toEqual([])
  })

  it("exits with the latest props for a stable key", async () => {
    const show = ref(true)
    const version = ref(1)
    const App = defineComponent({
      setup() {
        return () => (
          <AnimatePresence>
            {show.value ? (
              <motion.div
                key="card"
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: version.value / 10 }}
                transition={{ duration: 0.2, ease: "linear" }}
              >
                <text>{`Version ${version.value}`}</text>
              </motion.div>
            ) : null}
          </AnimatePresence>
        )
      },
    })
    app = createTestApp(App)
    await app.settle()

    version.value = 2
    await app.settle()
    show.value = false
    await app.settle()

    expect(texts(app)).toEqual(["Version 2"])
    expect(motionDiv(app)?.customProps?.motion).toMatchObject({
      animate: { opacity: 0.2 },
    })
  })

  it("ignores a queued completion from the previous target", async () => {
    const show = ref(true)
    const completions: string[] = []
    const App = defineComponent({
      setup() {
        return () => (
          <AnimatePresence>
            {show.value ? (
              <motion.div
                key="card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: "linear" }}
                onMotionComplete={() => completions.push("complete")}
              >
                <text>Current target</text>
              </motion.div>
            ) : null}
          </AnimatePresence>
        )
      },
    })
    app = createTestApp(App)

    app.renderer.clockPause()
    await app.settle()
    app.renderer.clockFastForward(200)
    app.renderer.flush()
    show.value = false
    await app.settle()
    app.renderer.dispatchNativeEvents()

    expect(texts(app)).toEqual(["Current target"])
    expect(completions).toEqual([])

    app.renderer.clockFastForward(200)
    app.renderer.flush()
    app.renderer.dispatchNativeEvents()
    await app.settle()

    expect(texts(app)).toEqual([])
    expect(completions).toEqual(["complete"])
  })
})
