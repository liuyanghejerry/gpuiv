import type { EventPayload } from "@gpuiv/native"
import type { Container, EventHandlerMap, NativeRenderer } from "../types.js"

const containersByRenderer = new WeakMap<NativeRenderer, Container>()

/** One renderer drives one window, one native root id, and one event map, so a
 *  second live root would silently take all three over: its `attachRoot` call
 *  replaces the shared entry, and unmounting either root then deletes it and
 *  kills every handler on the other. Sequential remounts are fine — the
 *  previous root unmounts (and detaches) first, which is what `createApp()`'s
 *  remount path does. */
export function attachRoot(renderer: NativeRenderer, container: Container): void {
  const existing = containersByRenderer.get(renderer)
  if (existing && existing !== container) {
    throw new Error(
      "This renderer already drives a mounted GPUIX root. One renderer owns one window, one native root id, and one event map, so a second root would silently take both over. Unmount the first root first."
    )
  }
  containersByRenderer.set(renderer, container)
}

/** Only the container that owns the renderer can remove the entry, so an
 *  unmounted root cannot take a later root's registration down with it. */
export function detachRoot(renderer: NativeRenderer, container: Container): void {
  if (containersByRenderer.get(renderer) !== container) return
  containersByRenderer.delete(renderer)
}

export function containerForRenderer(renderer: NativeRenderer): Container | undefined {
  return containersByRenderer.get(renderer)
}

export function handleGpuixEvent(payload: EventPayload, renderer: NativeRenderer): void {
  const container = containersByRenderer.get(renderer)
  if (!container) return
  const elementHandlers = container.eventHandlers.get(payload.elementId)
  if (!elementHandlers) return
  const handler = elementHandlers.get(payload.eventType)
  if (handler) handler(payload)
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
