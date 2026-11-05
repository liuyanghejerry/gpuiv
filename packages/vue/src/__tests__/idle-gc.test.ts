import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { collectGarbageWhenIdle } from "../idle-gc.js"
import { appliedBatchCount, wrapWithBatching } from "../reconciler/batch-renderer.js"

describe("collectGarbageWhenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = () => {
    let activity = 0
    const collect = vi.fn()
    const stop = collectGarbageWhenIdle({ activity: () => activity, collect, checkMs: 1000, quietChecks: 2 })
    return {
      collect,
      stop,
      work: () => void activity++,
      wait: (checks: number) => vi.advanceTimersByTime(checks * 1000),
    }
  }

  it("collects once after the app has been quiet, then waits for the next burst", () => {
    const { collect, work, wait } = setup()
    wait(1)
    expect(collect, "one quiet look is not enough").not.toHaveBeenCalled()
    wait(1)
    expect(collect).toHaveBeenCalledTimes(1)
    wait(10)
    expect(collect, "nothing new to collect").toHaveBeenCalledTimes(1)

    work()
    wait(1)
    expect(collect, "the burst itself is not quiet").toHaveBeenCalledTimes(1)
    wait(2)
    expect(collect).toHaveBeenCalledTimes(2)
  })

  it("starts counting again whenever work shows up", () => {
    const { collect, work, wait } = setup()
    wait(1)
    work()
    wait(1)
    wait(1)
    expect(collect).not.toHaveBeenCalled()
    wait(1)
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it("stops when asked", () => {
    const { collect, stop, wait } = setup()
    stop()
    wait(10)
    expect(collect).not.toHaveBeenCalled()
  })

  it("counts applied mutation batches by default", () => {
    const queue = wrapWithBatching({ applyBatch: () => [] as number[] })
    const before = appliedBatchCount()
    queue.flushMutations()
    expect(appliedBatchCount(), "an empty queue applies nothing").toBe(before)
    queue.createElement(1, "div")
    queue.flushMutations()
    expect(appliedBatchCount()).toBe(before + 1)
  })

  it("collects through Bun.gc when the runtime provides it", () => {
    const g = globalThis as Record<string, unknown>
    const previousBun = g.Bun
    const forced: boolean[] = []
    g.Bun = { gc: (force: boolean) => forced.push(force) }
    try {
      let activity = 0
      const stop = collectGarbageWhenIdle({ activity: () => activity, checkMs: 1000, quietChecks: 1 })
      vi.advanceTimersByTime(1000)
      expect(forced, "Bun.gc(true) runs the collection").toEqual([true])

      activity++
      vi.advanceTimersByTime(1000)
      vi.advanceTimersByTime(1000)
      expect(forced).toEqual([true, true])
      stop()
    } finally {
      if (previousBun === undefined) delete g.Bun
      else g.Bun = previousBun
    }
  })

  it("falls back to globalThis.gc (Node --expose-gc) without Bun", () => {
    const g = globalThis as Record<string, unknown>
    const previousBun = g.Bun
    const previousGc = g.gc
    let collected = 0
    delete g.Bun
    g.gc = () => collected++
    try {
      const stop = collectGarbageWhenIdle({ activity: () => 0, checkMs: 1000, quietChecks: 2 })
      vi.advanceTimersByTime(1000)
      expect(collected).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(collected).toBe(1)
      stop()
    } finally {
      if (previousBun === undefined) delete g.Bun
      else g.Bun = previousBun
      if (previousGc === undefined) delete g.gc
      else g.gc = previousGc
    }
  })

  it("schedules nothing when the runtime cannot force a collection", () => {
    const g = globalThis as Record<string, unknown>
    const previousBun = g.Bun
    const previousGc = g.gc
    delete g.Bun
    delete g.gc
    try {
      const stop = collectGarbageWhenIdle({ activity: () => 0, checkMs: 1000 })
      expect(vi.getTimerCount(), "no interval was scheduled").toBe(0)
      expect(() => stop()).not.toThrow()
    } finally {
      if (previousBun !== undefined) g.Bun = previousBun
      if (previousGc !== undefined) g.gc = previousGc
    }
  })
})
