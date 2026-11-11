import type { EventPayload } from "@gpuiv/native"
import type {
  Container,
  ElementIdAllocator,
  EventHandlerMap,
  KeyEvent,
  NativeRenderer,
} from "../types.js"

/**
 * One open overlay: a dialog, menu, popover or tooltip. Only the top layer
 * closes on Escape. A layer is above its parent and above every layer that
 * opened before it.
 */
export interface DismissLayer {
  /** Escape reached the window and no handler prevented it. */
  onEscapeKeyDown(event: KeyEvent): void
}

/** Shared by every event of one GPUI key dispatch. */
interface KeystrokeFlags {
  id: number | undefined
  prevented: boolean
  stopped: boolean
}

interface RendererState {
  container?: Container
  ids: ElementIdAllocator
  windowKeyEventId: number
  windowSelectionEventId: number
  layers: DismissLayer[]
  // Native emits one keystroke's events back to back, in GPUI bubble order,
  // and the window event last. So only the latest keystroke needs flags.
  keystroke: KeystrokeFlags
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
    state = {
      ids: { nextElementId: 0 },
      windowKeyEventId: 0,
      windowSelectionEventId: 0,
      layers: [],
      keystroke: { id: undefined, prevented: false, stopped: false },
    }
    rendererStates.set(renderer, state)
  }
  return state
}

function toKeyEvent(event: EventPayload, flags: KeystrokeFlags): KeyEvent {
  return {
    ...event,
    get defaultPrevented() {
      return flags.prevented
    },
    preventDefault() {
      flags.prevented = true
    },
    stopPropagation() {
      flags.stopped = true
    },
  }
}

function hasCommandModifier(event: KeyEvent): boolean {
  const modifiers = event.modifiers
  return Boolean(modifiers?.ctrl || modifiers?.alt || modifiers?.cmd)
}

/** Register an open overlay on this renderer's layer stack. Call the returned
 *  function when it closes. */
export function pushDismissLayer(renderer: NativeRenderer, layer: DismissLayer): () => void {
  const state = stateFor(renderer)
  state.layers.push(layer)
  return () => {
    const index = state.layers.indexOf(layer)
    if (index >= 0) state.layers.splice(index, 1)
  }
}

export function idAllocatorFor(renderer: NativeRenderer): ElementIdAllocator {
  return stateFor(renderer).ids
}

export function nextWindowKeyEventId(renderer: NativeRenderer): number {
  // A queued event from an old root must not enter its replacement.
  const state = stateFor(renderer)
  state.windowKeyEventId += 1
  return state.windowKeyEventId
}

export function nextWindowSelectionEventId(renderer: NativeRenderer): number {
  // Same generation rule as the window key events, on its own id.
  const state = stateFor(renderer)
  state.windowSelectionEventId += 1
  return state.windowSelectionEventId
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
 *  unmounted root cannot take a later root's registration down with it.
 *  Returns whether this container was the live one. */
export function detachRoot(renderer: NativeRenderer, container: Container): boolean {
  const state = stateFor(renderer)
  if (state.container === container) {
    state.container = undefined
    return true
  }
  return false
}

export function containerForRenderer(renderer: NativeRenderer): Container | undefined {
  return stateFor(renderer).container
}

/** Dispatch one native event. Returns true only when a live handler consumed
 *  it, so a render-level `onEvent` observer never hears events that belong to
 *  a stale root. A window key event is always consumed: its default action
 *  (Tab moving focus, Escape closing the top layer) runs even with no
 *  `onKeyDown` registered. */
export function handleGpuixEvent(payload: EventPayload, renderer: NativeRenderer): boolean {
  const container = containerForRenderer(renderer)
  if (!container) return false
  const onEvent = container.onEvent
  const flagsFor = (): KeystrokeFlags => {
    const state = stateFor(renderer)
    // A synthetic event without an id never shares flags with another event.
    if (payload.keystrokeId == null) {
      return { id: undefined, prevented: false, stopped: false }
    }
    if (state.keystroke.id !== payload.keystrokeId) {
      state.keystroke = {
        id: payload.keystrokeId,
        prevented: false,
        stopped: false,
      }
    }
    return state.keystroke
  }
  if (payload.eventType === "windowKeyDown" || payload.eventType === "windowKeyUp") {
    if (payload.elementId !== container.windowKeyEventId) return false
    const keyDown = payload.eventType === "windowKeyDown"
    const observers = container.windowKeyEventHandlers
    const handler = keyDown ? observers.onKeyDown : observers.onKeyUp
    const flags = flagsFor()
    const keyEvent = toKeyEvent(
      { ...payload, elementId: 0, eventType: keyDown ? "keyDown" : "keyUp" },
      flags
    )
    if (handler && !flags.stopped) handler(keyEvent)
    // Default actions run last, after every element handler and the window
    // handler of this keystroke had the chance to call preventDefault().
    if (keyDown && !flags.prevented && !hasCommandModifier(keyEvent)) {
      if (keyEvent.key === "escape") {
        stateFor(renderer).layers.at(-1)?.onEscapeKeyDown(keyEvent)
      } else if (keyEvent.key === "tab" && container.tabNavigation !== false) {
        if (keyEvent.modifiers?.shift) renderer.focusPrevious?.()
        else renderer.focusNext?.()
      }
    }
    onEvent?.(payload)
    return true
  }
  if (
    payload.eventType === "windowShouldClose" ||
    payload.eventType === "appReopen"
  ) {
    if (payload.elementId !== container.windowKeyEventId) return false
    const observers = container.windowKeyEventHandlers
    const isShouldClose = payload.eventType === "windowShouldClose"
    const handler = isShouldClose ? observers.onWindowShouldClose : observers.onReopen
    if (!handler) return false
    handler({ ...payload, elementId: 0 })
    onEvent?.(payload)
    return true
  }
  if (payload.eventType === "windowSelectionChange") {
    if (payload.elementId !== container.windowSelectionEventId) return false
    const handler = container.windowKeyEventHandlers.onSelectionChange
    if (!handler) return false
    handler({
      ...payload,
      elementId: 0,
      eventType: "selectionChange",
    })
    onEvent?.(payload)
    return true
  }
  const elementHandlers = container.eventHandlers.get(payload.elementId)
  if (!elementHandlers) return false
  const handler = elementHandlers.get(payload.eventType)
  if (!handler) return false
  if (payload.eventType === "keyDown" || payload.eventType === "keyUp") {
    const flags = flagsFor()
    if (!flags.stopped) handler(toKeyEvent(payload, flags))
    onEvent?.(payload)
    return true
  }
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
