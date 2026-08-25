import type { EventPayload } from "@gpuiv/native"
import type { Container, EventHandlerMap, NativeRenderer } from "../types.js"

const containersByRenderer = new WeakMap<NativeRenderer, Container>()

export function attachRoot(renderer: NativeRenderer, container: Container): void {
  containersByRenderer.set(renderer, container)
}

export function detachRoot(renderer: NativeRenderer): void {
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
