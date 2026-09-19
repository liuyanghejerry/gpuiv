import { afterEach, describe, expect, it, vi } from "vitest"
import { createScrollController } from "../scroll-controller.js"

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
  const offsets = new Map([[1, [0, 0]], [2, [0, -20]]])
  const renderer = {
    getScrollOffset: (id: number) => offsets.get(id) ?? null,
    scrollTo: vi.fn((id: number, x: number, y: number) => {
      offsets.set(id, [Math.min(0, x), Math.max(-500, Math.min(0, y))])
    }),
  }
  return { offsets, renderer, controller: createScrollController(renderer) }
}

describe("scroll controller", () => {
  it("interpolates native negative offsets and resolves after observed clamping", async () => {
    const { renderer, controller } = fixture()
    const done = controller.scrollTo(1, { y: -1000, behavior: "smooth", duration: 100 })
    await vi.advanceTimersByTimeAsync(32)
    expect(renderer.scrollTo.mock.calls.at(-1)![2]).toBeLessThan(0)
    expect(renderer.scrollTo.mock.calls.at(-1)![2]).toBeGreaterThan(-1000)
    await vi.runAllTimersAsync()
    expect(await done).toEqual({ status: "finished", offset: { x: 0, y: -500 } })
  })

  it("waits for observation even for an instant no-op", async () => {
    const { controller } = fixture()
    let finished = false
    const done = controller.scrollTo(1).then((result) => { finished = true; return result })
    await vi.advanceTimersByTimeAsync(16)
    expect(finished).toBe(false)
    await vi.runAllTimersAsync()
    expect((await done).status).toBe("finished")
  })

  it("replaces only the same element's animation", async () => {
    const { controller } = fixture()
    const old = controller.scrollTo(1, { y: -300, behavior: "smooth" })
    const other = controller.scrollTo(2, { x: -10, behavior: "smooth" })
    const next = controller.scrollTo(1, { y: -100 })
    expect((await old).status).toBe("cancelled")
    await vi.runAllTimersAsync()
    expect((await next).offset?.y).toBe(-100)
    expect((await other).offset).toEqual({ x: -10, y: -20 })
  })

  it("aborts and stops writing, including when already aborted", async () => {
    const { controller, renderer } = fixture()
    const abort = new AbortController()
    const done = controller.scrollTo(1, { y: -300, behavior: "smooth", signal: abort.signal })
    await vi.advanceTimersByTimeAsync(32)
    abort.abort()
    const count = renderer.scrollTo.mock.calls.length
    await vi.runAllTimersAsync()
    expect((await done).status).toBe("cancelled")
    expect(renderer.scrollTo).toHaveBeenCalledTimes(count)
    expect((await controller.scrollTo(1, { signal: abort.signal })).status).toBe("cancelled")
  })

  it("cancel and dispose release timers and do not restart", async () => {
    const { controller } = fixture()
    const first = controller.scrollTo(1, { y: -300, behavior: "smooth" })
    controller.cancel(1)
    expect((await first).status).toBe("cancelled")
    const second = controller.scrollTo(2, { y: -300, behavior: "smooth" })
    controller.dispose()
    expect((await second).status).toBe("cancelled")
    expect(vi.getTimerCount()).toBe(0)
    expect((await controller.scrollTo(1)).status).toBe("cancelled")
  })

  it("handles absent capabilities and a removed container", async () => {
    expect((await createScrollController({}).scrollTo(1)).status).toBe("unavailable")
    const { offsets, controller } = fixture()
    const done = controller.scrollTo(1, { y: -300, behavior: "smooth" })
    offsets.delete(1)
    await vi.runAllTimersAsync()
    expect(await done).toEqual({ status: "unavailable", offset: null })
  })

  it("rejects invalid coordinates before touching the renderer", () => {
    const { controller, renderer } = fixture()
    for (const options of [{ x: NaN }, { y: Infinity }, { duration: -1 }]) {
      expect(() => controller.scrollTo(1, options)).toThrow()
    }
    expect(() => controller.scrollTo(-1)).toThrow()
    expect(renderer.scrollTo).not.toHaveBeenCalled()
  })

  it("bounds the settling wait if layout keeps moving", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] })
    let y = 0
    const controller = createScrollController({ getScrollOffset: () => [0, --y], scrollTo() {} })
    const done = controller.scrollTo(1, { y: -300 })
    await vi.runAllTimersAsync()
    expect((await done).status).toBe("timeout")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("rejects renderer errors and cleans up", async () => {
    const { controller, renderer } = fixture()
    renderer.scrollTo.mockImplementation(() => { throw new Error("closed") })
    await expect(controller.scrollTo(1)).rejects.toThrow("closed")
    expect(vi.getTimerCount()).toBe(0)
  })
})
