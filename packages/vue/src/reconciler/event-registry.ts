import type { EventPayload } from "@gpuiv/native"
import type { Container, ElementIdAllocator, EventHandlerMap, NativeRenderer } from "../types.js"

interface RendererState {
  container?: Container
  ids: ElementIdAllocator
}

// bun --hot preserves the native renderer (renderer.ts keeps it on a
// globalThis slot), so its element-ID allocator must survive JavaScript
// module re-evaluation too: a fresh WeakMap would restart ids at 0 and
// collide with the retained Rust tree.
const RENDERER_STATES_KEY = Symbol.for("@gpuiv/vue/renderer-states")
const rendererStates = (() => {
  const existing = Reflect.get(globalThis, RENDERER_STATES_KEY) as
    | WeakMap<NativeRenderer, RendererState>
    | undefined
  if (existing) return existing
  const created = new WeakMap<NativeRenderer, RendererState>()
  Reflect.set(globalThis, RENDERER_STATES_KEY, created)
  return created
})()

function stateFor(renderer: NativeRenderer): RendererState {
  let state = rendererStates.get(renderer)
  if (!state) {
    state = { ids: { nextElementId: 0 } }
    rendererStates.set(renderer, state)
  }
  return state
}

export function idAllocatorFor(renderer: NativeRenderer): ElementIdAllocator {
  return stateFor(renderer).ids
}

/** One renderer drives one window, one native root id, and one event map, so a
 *  second live root would silently take all three over: its `attachRoot` call
 *  replaces the shared entry, and unmounting either root then deletes it and
 *  kills every handler on the other. Sequential remounts are fine — the
 *  previous root unmounts (and detaches) first, which is what `createApp()`'s
 *  remount path does. */
export function attachRoot(renderer: NativeRenderer, container: Container): void {
  const state = stateFor(renderer)
  const existing = state.container
  if (existing && existing !== container) {
    throw new Error(
      "This renderer already drives a mounted GPUIX root. One renderer owns one window, one native root id, and one event map, so a second root would silently take both over. Unmount the first root first."
    )
  }
  state.container = container
}

/** Only the container that owns the renderer can remove the entry, so an
 *  unmounted root cannot take a later root's registration down with it. */
export function detachRoot(renderer: NativeRenderer, container: Container): void {
  const state = stateFor(renderer)
  if (state.container === container) {
    state.container = undefined
  }
}

export function containerForRenderer(renderer: NativeRenderer): Container | undefined {
  return stateFor(renderer).container
}

/** Dispatch one native event. Returns true only when a live handler consumed
 *  it, so a render-level `onEvent` observer never hears events that belong to
 *  a stale root. */
export function handleGpuixEvent(payload: EventPayload, renderer: NativeRenderer): boolean {
  const container = containerForRenderer(renderer)
  if (!container) return false
  const onEvent = container.onEvent
  const elementHandlers = container.eventHandlers.get(payload.elementId)
  if (!elementHandlers) return false
  const handler = elementHandlers.get(payload.eventType)
  if (!handler) return false
  handler(payload)
  onEvent?.(payload)
  return true
}

export function registerEventHandler(
  eventHandlers: EventHandlerMap,
  elementId: number,
  eventType: string,
  handler: (event: EventPayload) => void
): void {
  let elementHandlers = eventHandlers.get(elementId)
  if (!elementHandlers) {
    elementHandlers = new Map()
    eventHandlers.set(elementId, elementHandlers)
  }
  elementHandlers.set(eventType, handler)
}

export function unregisterEventHandler(
  eventHandlers: EventHandlerMap,
  elementId: number,
  eventType: string
): void {
  const m = eventHandlers.get(elementId)
  if (!m) return
  m.delete(eventType)
  if (m.size === 0) eventHandlers.delete(elementId)
}

export function unregisterEventHandlers(
  eventHandlers: EventHandlerMap,
  elementId: number
): void {
  eventHandlers.delete(elementId)
}
