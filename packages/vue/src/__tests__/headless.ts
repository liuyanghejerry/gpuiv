/// Headless component-testing harness: mount Vue components through the real
/// custom renderer against a recording NativeRenderer mock, then drive them
/// with protocol-level events dispatched through the shared event registry.
///
/// This is the mock-renderer pattern from renderer-core.test.ts lifted into a
/// reusable helper, so component logic (open/close, keyboard navigation,
/// controlled state, floating layers) can be tested on machines without a GPU
/// test renderer — Linux CI included. It asserts what crosses the mutation
/// protocol and what handlers do, never pixels.

import { nextTick } from "vue"
import type { App } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type { NativeRenderer, StyleDesc, HostNode } from "../types.js"
import { createGpuivRendererHost, type GpuivRendererHost } from "../reconciler/vue-renderer.js"
import {
  handleGpuixEvent,
  idAllocatorFor,
  nextWindowKeyEventId,
  nextWindowSelectionEventId,
} from "../reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "../hooks/use-gpuix.js"

type Op = unknown[]

export interface HeadlessOptions {
  width?: number
  height?: number
  onKeyDown?: (event: EventPayload) => void
  onKeyUp?: (event: EventPayload) => void
  onWindowShouldClose?: (event: EventPayload) => void
  onReopen?: (event: EventPayload) => void
  onSelectionChange?: (event: EventPayload) => void
}

/** A NativeRenderer that records every protocol op and answers query methods
 *  from configurable in-memory state. */
export class HeadlessRenderer implements NativeRenderer {
  ops: Op[] = []
  width: number
  height: number
  focusedElementId: number | null = null
  scrollOffsets = new Map<number, [number, number]>()
  elementBounds = new Map<
    number,
    { x: number; y: number; width: number; height: number }
  >()
  windowBounds = { x: 0, y: 0, width: 1280, height: 800 }
  /** Element ids ever destroyed — the destroyElement op unlinks a whole
   *  subtree (there is no removeChild op), so descendants are included. */
  destroyedIds = new Set<number>()
  private childrenByParent = new Map<number, number[]>()

  get destroyed(): number[] {
    return [...this.destroyedIds]
  }

  constructor(options: { width?: number; height?: number } = {}) {
    this.width = options.width ?? 1280
    this.height = options.height ?? 800
    this.windowBounds = { x: 0, y: 0, width: this.width, height: this.height }
  }

  applyBatch(json: string): number[] {
    const batch = JSON.parse(json) as Op[]
    this.ops.push(...batch)
    for (const op of batch) {
      if (op[0] === "appendChild" || op[0] === "insertBefore") {
        const parent = op[1] as number
        const child = op[2] as number
        const siblings = this.childrenByParent.get(parent) ?? []
        if (!siblings.includes(child)) siblings.push(child)
        this.childrenByParent.set(parent, siblings)
      } else if (op[0] === "destroyElement") {
        this.destroySubtree(op[1] as number)
      }
    }
    return []
  }

  private destroySubtree(rootId: number): void {
    const queue = [rootId]
    while (queue.length > 0) {
      const id = queue.shift() as number
      this.destroyedIds.add(id)
      this.elementBounds.delete(id)
      queue.push(...(this.childrenByParent.get(id) ?? []))
      this.childrenByParent.delete(id)
      for (const siblings of this.childrenByParent.values()) {
        const index = siblings.indexOf(id)
        if (index >= 0) siblings.splice(index, 1)
      }
    }
  }

  // ── Focus ───────────────────────────────────────────────────────
  focusElement(elementId: number): void {
    this.focusedElementId = elementId
  }
  focusNext(): void {
    this.focusedElementId = null
  }
  focusPrevious(): void {
    this.focusedElementId = null
  }
  getFocusedElementId(): number | null {
    return this.focusedElementId
  }
  focusNextWithin(): void {}
  focusPreviousWithin(): void {}
  blur(): void {
    this.focusedElementId = null
  }

  // ── Queries components rely on ──────────────────────────────────
  getScrollOffset(elementId: number): Array<number> | null {
    return this.scrollOffsets.get(elementId) ?? [0, 0]
  }
  getListScrollTop(elementId: number): Array<number> | null {
    return this.scrollOffsets.has(elementId)
      ? [0, 0, this.height]
      : null
  }
  getElementBounds(
    elementId: number
  ): { x: number; y: number; width: number; height: number } | null {
    return this.elementBounds.get(elementId) ?? null
  }
  getWindowSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }
  getWindowBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.windowBounds }
  }
  getSelectedText(): string | null {
    return null
  }
  clearSelection(): void {}

  // ── Op queries for assertions ────────────────────────────────────

  /** Every op of one kind, e.g. opsOf("createElement"). */
  opsOf(name: string): Op[] {
    return this.ops.filter((op) => op[0] === name)
  }

  /** The latest style payload set on an element (ops are append-only). */
  lastStyle(elementId: number): StyleDesc | undefined {
    const styles = this.opsOf("setStyle").filter((op) => op[1] === elementId)
    return styles.length
      ? (styles[styles.length - 1][2] as StyleDesc)
      : undefined
  }

  /** The current text content of an element (last setText wins). */
  textOf(elementId: number): string | undefined {
    if (this.destroyedIds.has(elementId)) return undefined
    const texts = this.opsOf("setText").filter((op) => op[1] === elementId)
    return texts.length ? (texts[texts.length - 1][2] as string) : undefined
  }

  /** Element ids whose current text content matches exactly. */
  idsWithText(content: string): number[] {
    const ids = this.opsOf("setText").map((op) => op[1] as number)
    return [...new Set(ids)].filter((id) => this.textOf(id) === content)
  }

  /** The element type recorded at creation. */
  typeOf(elementId: number): string | undefined {
    const create = this.opsOf("createElement").find((op) => op[1] === elementId)
    return create ? (create[2] as string) : undefined
  }

  /** Children of an element per the latest attach ops. */
  childrenOf(elementId: number): number[] {
    return [...(this.childrenByParent.get(elementId) ?? [])]
  }

  /** Parent of an element per the latest attach op. */
  parentOf(elementId: number): number | undefined {
    let parent: number | undefined
    for (const op of this.ops) {
      if (op[0] === "appendChild" && op[2] === elementId) parent = op[1] as number
      if (op[0] === "insertBefore" && op[2] === elementId) parent = op[1] as number
    }
    return parent
  }

  /** Whether an element currently has a listener of a type armed. */
  hasListener(elementId: number, type: string): boolean {
    let armed = false
    for (const op of this.opsOf("setEventListener")) {
      if (op[1] === elementId && op[2] === type) armed = op[3] === true
    }
    return armed
  }

  /** Every current text content, in first-set order — the closest mock analog
   *  of the retained tree's getAllText(): historical ops of destroyed elements
   *  are excluded. */
  allTexts(): string[] {
    const ids = [...new Set(this.opsOf("setText").map((op) => op[1] as number))]
    return ids
      .filter((id) => !this.destroyedIds.has(id))
      .map((id) => this.textOf(id) as string)
  }

  /** Nearest element at or above `elementId` with a listener of `type` armed —
   *  the mutation-protocol equivalent of hit-test bubbling: dispatch on the
   *  painted target, consume on the ancestor that listens. */
  closestWithListener(elementId: number, type: string): number | null {
    let current: number | undefined = elementId
    while (current !== undefined) {
      if (this.hasListener(current, type)) return current
      current = this.parentOf(current)
    }
    return null
  }
}

export interface HeadlessApp {
  app: App<HostNode>
  host: GpuivRendererHost
  renderer: HeadlessRenderer
  container: HostNode
  /** Flush Vue's scheduler and push pending mutations into the mock. */
  settle: () => Promise<void>
  /** Push pending mutations without awaiting Vue's scheduler. */
  flushMutations: () => void
  unmount: () => void
  /** Dispatch one protocol event; true when a live handler consumed it. */
  dispatch: (payload: Partial<EventPayload> & { elementId: number; eventType: string }) => boolean
  /** Dispatch the window-level key-down on the root's key event id. */
  windowKeyDown: (key: string, modifiers?: Partial<EventPayload>) => boolean
  windowKeyUp: (key: string) => boolean
  windowShouldClose: () => boolean
}

/** Mount a component headlessly through the real custom renderer. */
export function mountHeadless(
  rootComponent: unknown,
  options: HeadlessOptions = {}
): HeadlessApp {
  const renderer = new HeadlessRenderer(options)
  const windowKeyEventId = nextWindowKeyEventId(renderer)
  const windowSelectionEventId = nextWindowSelectionEventId(renderer)
  const host = createGpuivRendererHost(
    renderer,
    idAllocatorFor(renderer),
    {
      onKeyDown: options.onKeyDown,
      onKeyUp: options.onKeyUp,
      onWindowShouldClose: options.onWindowShouldClose,
      onReopen: options.onReopen,
      onSelectionChange: options.onSelectionChange,
    },
    windowKeyEventId,
    windowSelectionEventId
  )
  const app = host.vue.createApp(rootComponent as never)
  app.provide(GPUIV_CONTEXT, { renderer })
  app.mount(host.container)
  host.flushMutations()

  const dispatch: HeadlessApp["dispatch"] = (payload) =>
    handleGpuixEvent(payload as EventPayload, renderer)

  return {
    app,
    host,
    renderer,
    container: host.container,
    settle: async () => {
      await nextTick()
      host.flushMutations()
    },
    flushMutations: () => host.flushMutations(),
    unmount: () => {
      app.unmount()
      host.flushMutations()
    },
    dispatch,
    windowKeyDown: (key, modifiers = {}) =>
      dispatch({
        elementId: windowKeyEventId,
        eventType: "windowKeyDown",
        key,
        ...modifiers,
      }),
    windowKeyUp: (key) =>
      dispatch({ elementId: windowKeyEventId, eventType: "windowKeyUp", key }),
    windowShouldClose: () =>
      dispatch({
        elementId: windowKeyEventId,
        eventType: "windowShouldClose",
      }),
  }
}

// ── Event payload shorthands ──────────────────────────────────────

export function clickEvent(
  elementId: number,
  extra: Partial<EventPayload> = {}
): { elementId: number; eventType: string } & Partial<EventPayload> {
  return { elementId, eventType: "click", clickCount: 1, ...extra }
}

export function mouseDownEvent(
  elementId: number,
  extra: Partial<EventPayload> = {}
): { elementId: number; eventType: string } & Partial<EventPayload> {
  return { elementId, eventType: "mouseDown", button: 0, ...extra }
}

export function keyEvent(
  elementId: number,
  key: string,
  extra: Partial<EventPayload> = {}
): { elementId: number; eventType: string } & Partial<EventPayload> {
  return { elementId, eventType: "keyDown", key, ...extra }
}
