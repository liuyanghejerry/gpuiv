/// Unit tests for the shared event registry: per-renderer state (id allocator,
/// window-event generation counters), root ownership rules, event routing with
/// stale-generation gating, and handler-map cleanup.

import { describe, expect, it, vi } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import type { Container, NativeRenderer } from "../types.js"
import {
  attachRoot,
  containerForRenderer,
  detachRoot,
  handleGpuixEvent,
  idAllocatorFor,
  nextWindowKeyEventId,
  nextWindowSelectionEventId,
  registerEventHandler,
  unregisterEventHandler,
  unregisterEventHandlers,
} from "../reconciler/event-registry.js"

class StubRenderer implements NativeRenderer {
  applyBatch(): number[] {
    return []
  }
}

/** A registry container; spies for the router's observers when no handler set
 *  is given, the given handlers verbatim otherwise. */
function makeContainer(
  handlers?: Container["windowKeyEventHandlers"]
): Container & {
  onKeyDown: ReturnType<typeof vi.fn>
  onKeyUp: ReturnType<typeof vi.fn>
  onWindowShouldClose: ReturnType<typeof vi.fn>
  onReopen: ReturnType<typeof vi.fn>
  onSelectionChange: ReturnType<typeof vi.fn>
  onEvent: ReturnType<typeof vi.fn>
} {
  const onKeyDown = vi.fn()
  const onKeyUp = vi.fn()
  const onWindowShouldClose = vi.fn()
  const onReopen = vi.fn()
  const onSelectionChange = vi.fn()
  const onEvent = vi.fn()
  const container: Container = {
    renderer: { flushMutations() {} },
    ids: { nextElementId: 0 },
    eventHandlers: new Map(),
    windowKeyEventHandlers:
      handlers ?? { onKeyDown, onKeyUp, onWindowShouldClose, onReopen, onSelectionChange },
    windowKeyEventId: nextWindowKeyEventId(new StubRenderer()),
    windowSelectionEventId: nextWindowSelectionEventId(new StubRenderer()),
    onEvent,
  }
  return Object.assign(container, {
    onKeyDown,
    onKeyUp,
    onWindowShouldClose,
    onReopen,
    onSelectionChange,
    onEvent,
  })
}

function attach(renderer: NativeRenderer, container: Container): Container {
  attachRoot(renderer, container)
  return container
}

const payload = (eventType: string, elementId: number): EventPayload =>
  ({ eventType, elementId }) as EventPayload

describe("event registry state", () => {
  it("returns one stable allocator per renderer and keeps renderers independent", () => {
    const renderer = new StubRenderer()
    const ids = idAllocatorFor(renderer)
    expect(ids).toBe(idAllocatorFor(renderer))
    ids.nextElementId = 7
    expect(idAllocatorFor(renderer).nextElementId).toBe(7)

    const other = new StubRenderer()
    expect(idAllocatorFor(other)).not.toBe(ids)
    expect(idAllocatorFor(other).nextElementId).toBe(0)
  })

  it("increments the window key and selection generation counters separately", () => {
    const renderer = new StubRenderer()
    expect(nextWindowKeyEventId(renderer)).toBe(1)
    expect(nextWindowKeyEventId(renderer)).toBe(2)
    expect(nextWindowSelectionEventId(renderer)).toBe(1)
    expect(nextWindowKeyEventId(renderer)).toBe(3)
    expect(nextWindowSelectionEventId(renderer)).toBe(2)
  })
})

describe("event registry root ownership", () => {
  it("rejects a second root but accepts re-attaching the live one", () => {
    const renderer = new StubRenderer()
    const first = makeContainer()
    attach(renderer, first)
    expect(containerForRenderer(renderer)).toBe(first)

    expect(() => attachRoot(renderer, first)).not.toThrow()

    const second = makeContainer()
    expect(() => attach(renderer, second)).toThrowError(
      /already drives a mounted GPUIX root/
    )
    expect(containerForRenderer(renderer)).toBe(first)
  })

  it("lets only the owning container detach, and reports missing roots", () => {
    const renderer = new StubRenderer()
    expect(detachRoot(renderer, makeContainer())).toBe(false)

    const live = attach(renderer, makeContainer())
    const stranger = makeContainer()
    expect(detachRoot(renderer, stranger)).toBe(false)
    expect(containerForRenderer(renderer)).toBe(live)

    expect(detachRoot(renderer, live)).toBe(true)
    expect(containerForRenderer(renderer)).toBeUndefined()
    expect(detachRoot(renderer, live)).toBe(false)
  })
})

describe("handleGpuixEvent routing", () => {
  it("drops every event while no root owns the renderer", () => {
    const renderer = new StubRenderer()
    expect(handleGpuixEvent(payload("windowKeyDown", 1), renderer)).toBe(false)
    expect(handleGpuixEvent(payload("click", 1), renderer)).toBe(false)
  })

  it("normalizes window key events on the live generation and reports them to onEvent", () => {
    const renderer = new StubRenderer()
    const container = attach(renderer, makeContainer())
    const id = container.windowKeyEventId

    const stale = handleGpuixEvent(payload("windowKeyDown", id - 1), renderer)
    expect(stale).toBe(false)
    expect(container.onKeyDown).not.toHaveBeenCalled()
    expect(container.onEvent).not.toHaveBeenCalled()

    expect(handleGpuixEvent({ ...payload("windowKeyDown", id), key: "q" }, renderer)).toBe(true)
    expect(container.onKeyDown).toHaveBeenCalledExactlyOnceWith({
      eventType: "keyDown",
      elementId: 0,
      key: "q",
    })
    // The observer hears the raw native event, not the normalized one.
    expect(container.onEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "windowKeyDown", elementId: id })
    )
  })

  it("routes windowKeyUp as keyUp and keeps the close/reopen types as-is", () => {
    const renderer = new StubRenderer()
    const container = attach(renderer, makeContainer())
    const id = container.windowKeyEventId

    expect(handleGpuixEvent({ ...payload("windowKeyUp", id), key: "a" }, renderer)).toBe(true)
    expect(container.onKeyUp).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "keyUp", elementId: 0, key: "a" })
    )

    expect(handleGpuixEvent(payload("windowShouldClose", id), renderer)).toBe(true)
    expect(container.onWindowShouldClose).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "windowShouldClose", elementId: 0 })
    )

    expect(handleGpuixEvent(payload("appReopen", id), renderer)).toBe(true)
    expect(container.onReopen).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "appReopen", elementId: 0 })
    )
  })

  it("rejects a window event the root registers no handler for", () => {
    const renderer = new StubRenderer()
    const container = attach(renderer, makeContainer({}))
    const id = container.windowKeyEventId

    for (const type of ["windowKeyDown", "windowKeyUp", "windowShouldClose", "appReopen"]) {
      expect(handleGpuixEvent(payload(type, id), renderer)).toBe(false)
    }
    expect(container.onEvent).not.toHaveBeenCalled()
  })

  it("gates selectionChange on its own generation id", () => {
    const renderer = new StubRenderer()
    const container = attach(renderer, makeContainer())
    const id = container.windowSelectionEventId

    expect(handleGpuixEvent(payload("windowSelectionChange", id - 1), renderer)).toBe(false)
    expect(container.onSelectionChange).not.toHaveBeenCalled()

    expect(
      handleGpuixEvent({ ...payload("windowSelectionChange", id), value: "sel" }, renderer)
    ).toBe(true)
    expect(container.onSelectionChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "selectionChange", elementId: 0, value: "sel" })
    )
    expect(container.onEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ eventType: "windowSelectionChange", elementId: id })
    )
  })

  it("rejects a selectionChange the root registers no handler for", () => {
    const renderer = new StubRenderer()
    const bare = attach(renderer, makeContainer({}))
    expect(
      handleGpuixEvent(payload("windowSelectionChange", bare.windowSelectionEventId), renderer)
    ).toBe(false)
    expect(bare.onEvent).not.toHaveBeenCalled()
  })

  it("delivers element events to the registered handler only", () => {
    const renderer = new StubRenderer()
    const container = attach(renderer, makeContainer())
    const handler = vi.fn()
    registerEventHandler(container.eventHandlers, 42, "click", handler)

    const event = payload("click", 42)
    expect(handleGpuixEvent(event, renderer)).toBe(true)
    expect(handler).toHaveBeenCalledExactlyOnceWith(event)
    expect(container.onEvent).toHaveBeenCalledExactlyOnceWith(event)

    // Unknown element, and a known element without that listener: dropped.
    container.onEvent.mockClear()
    expect(handleGpuixEvent(payload("click", 43), renderer)).toBe(false)
    expect(handleGpuixEvent(payload("mouseDown", 42), renderer)).toBe(false)
    expect(container.onEvent).not.toHaveBeenCalled()
  })
})

describe("event handler map cleanup", () => {
  it("registers several types per element and lets the latest handler win", () => {
    const map: Container["eventHandlers"] = new Map()
    const first = vi.fn()
    const second = vi.fn()
    registerEventHandler(map, 5, "click", first)
    registerEventHandler(map, 5, "mouseDown", vi.fn())
    expect(map.get(5)!.size).toBe(2)

    registerEventHandler(map, 5, "click", second)
    expect(map.get(5)!.size).toBe(2)
    expect(map.get(5)!.get("click")).toBe(second)
  })

  it("unregisterEventHandler drops one type and the element once the last type goes", () => {
    const map: Container["eventHandlers"] = new Map()
    registerEventHandler(map, 5, "click", vi.fn())
    registerEventHandler(map, 5, "mouseDown", vi.fn())

    unregisterEventHandler(map, 5, "click")
    expect(map.get(5)!.has("click")).toBe(false)
    expect(map.get(5)!.has("mouseDown")).toBe(true)

    unregisterEventHandler(map, 5, "mouseDown")
    expect(map.has(5)).toBe(false)

    // Unknown element and unknown type are no-ops.
    expect(() => unregisterEventHandler(map, 99, "click")).not.toThrow()
    registerEventHandler(map, 7, "click", vi.fn())
    expect(() => unregisterEventHandler(map, 7, "scroll")).not.toThrow()
    expect(map.get(7)!.size).toBe(1)
  })

  it("unregisterEventHandlers drops every type of an element at once", () => {
    const map: Container["eventHandlers"] = new Map()
    registerEventHandler(map, 5, "click", vi.fn())
    registerEventHandler(map, 5, "mouseDown", vi.fn())
    registerEventHandler(map, 6, "click", vi.fn())

    unregisterEventHandlers(map, 5)
    expect(map.has(5)).toBe(false)
    expect(map.get(6)!.size).toBe(1)
  })
})
