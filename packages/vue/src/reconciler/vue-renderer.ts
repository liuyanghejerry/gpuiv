/// The Vue 3 binding for GPUIX — a custom renderer whose host ops emit the
/// same mutation protocol as the React host config.
///
/// Vue's renderer is synchronous within a patch, but its component updates run
/// through the scheduler on a microtask. Mutations are therefore queued in the
/// BatchingRenderer and flushed on a microtask that runs after Vue's scheduler
/// has finished its jobs. `flushMutations()` drains the queue synchronously for
/// callers that need the Rust tree current (mount, tests, clock-pinned frames).

import { createRenderer, type Renderer, type RendererOptions } from "vue"
import type { EventPayload } from "@gpuiv/native"
import type {
  Container,
  ElementProps,
  HostNode,
  MutationRenderer,
  NativeRenderer,
  WindowKeyEventHandlers,
} from "../types.js"
import { wrapWithBatching } from "./batch-renderer.js"
import {
  attachRoot,
  detachRoot,
  registerEventHandler,
  unregisterEventHandler,
} from "./event-registry.js"

// ── Prop classification ──────────────────────────────────────────────

/// Props the renderer handles itself (never forwarded as custom props).
const RESERVED_PROPS = new Set([
  "style",
  "class",
  "children",
  "key",
  "ref",
  "ref_for",
  "ref_key",
  "modelValue",
])

/// Built-in element types that don't use custom props.
const BUILT_IN_TYPES = new Set(["div", "text"])

/// Event names the native side knows. `onInput` is an alias for `change`.
const EVENT_TYPES = new Set([
  "click",
  "auxClick",
  "highlight",
  "mouseDown",
  "mouseUp",
  "mouseEnter",
  "mouseLeave",
  "mouseMove",
  "mouseDownOutside",
  "contextMenu",
  "keyDown",
  "keyUp",
  "focus",
  "blur",
  "scroll",
  "change",
  "submit",
  "toggleFile",
  "showMore",
  "lineClick",
  "linkClick",
  "visibleRange",
])

/// Props that reach Rust on EVERY element type, including div and text.
const UNIVERSAL_PROPS = new Set([
  "autoFocus",
  "tabIndex",
  "motion",
  "testId",
  // `highlight` is scoped by where it sits in the tree, so it has to reach a
  // plain `div`. Without it here, custom props are dropped for built-ins and
  // the prop silently never arrives in Rust.
  "highlight",
  // Wheel zoom over a canvas: opt out of ancestor scrollers consuming the
  // same gesture. See the `scroll` wiring in wire_host_events.
  "stopWheelPropagation",
])

function eventTypeForProp(prop: string): string | null {
  if (!prop.startsWith("on") || prop.length <= 2) return null
  const eventType = prop[2].toLowerCase() + prop.slice(3)
  if (eventType === "input") return "change"
  return EVENT_TYPES.has(eventType) ? eventType : null
}

function isHandler(value: unknown): boolean {
  return typeof value === "function" || Array.isArray(value)
}

function isBuiltIn(node: HostNode): boolean {
  return BUILT_IN_TYPES.has(node.type)
}

function shouldForwardProp(node: HostNode, key: string): boolean {
  if (RESERVED_PROPS.has(key)) return false
  if (eventTypeForProp(key) && isHandler(node.props[key])) return false
  if (isBuiltIn(node)) return UNIVERSAL_PROPS.has(key)
  return true
}

// ── Style normalization ──────────────────────────────────────────────

function camelize(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Convert a Vue style binding (object, array, or CSS string) into a
 * gpuix StyleDesc: kebab-case keys become camelCase, `--custom` properties
 * are dropped, null values are removed.
 */
export function toGpuixStyle(style: unknown): Record<string, unknown> {
  if (style == null) return {}
  if (typeof style === "string") {
    const result: Record<string, unknown> = {}
    for (const part of style.split(";")) {
      const idx = part.indexOf(":")
      if (idx <= 0) continue
      const key = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (!key || key.startsWith("--")) continue
      result[camelize(key)] = value
    }
    return result
  }
  if (Array.isArray(style)) {
    const result: Record<string, unknown> = {}
    for (const item of style) {
      Object.assign(result, toGpuixStyle(item))
    }
    return result
  }
  if (typeof style === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
      if (value == null || key.startsWith("--")) continue
      result[camelize(key)] = value
    }
    return result
  }
  return {}
}

// ── Host node helpers ────────────────────────────────────────────────

export function createHostNode(
  type: string,
  id: number,
  text: string
): HostNode {
  return { id, type, text, props: {}, parent: null, children: [], created: false }
}

// ── Batching host ────────────────────────────────────────────────────

export interface GpuivBatchedHost {
  /** The commit-phase facade — what host ops queue mutations on. */
  renderer: MutationRenderer
  /** Drain the mutation queue synchronously (applyBatch to Rust). */
  flushMutations: () => void
  /** Schedule the drain on a microtask (Vue update path). */
  scheduleFlush: () => void
}

export function createBatchedHost(inner: NativeRenderer): GpuivBatchedHost {
  let flushScheduled = false
  const scheduleFlush = (): void => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      batched.flushMutations()
    })
  }
  const batched = wrapWithBatching(inner, scheduleFlush)
  return {
    renderer: batched,
    flushMutations: () => {
      flushScheduled = false
      batched.flushMutations()
    },
    scheduleFlush,
  }
}

// ── Renderer host ────────────────────────────────────────────────────

export interface GpuivRendererHost {
  /** Vue's custom renderer — use `.createApp()` to build apps. */
  vue: Renderer<HostNode>
  /** The container node passed to `app.mount()` — a real root div in Rust. */
  container: HostNode
  /** The commit-phase facade the host config queues mutations on. */
  renderer: MutationRenderer
  /** Flush queued mutations synchronously. */
  flushMutations: () => void
  /** Release this root's claim on the renderer's event map. Returns whether
   *  this root was the live one (and so its native listeners must stop). */
  detach: () => boolean
  /** The registry container backing this root. */
  registryContainer: Container
}

export function createGpuivRendererHost(
  inner: NativeRenderer,
  ids: { nextElementId: number },
  windowKeyEventHandlers: WindowKeyEventHandlers = {},
  windowKeyEventId = 0
): GpuivRendererHost {
  const host = createBatchedHost(inner)
  const container: Container = {
    renderer: host.renderer,
    ids,
    eventHandlers: new Map(),
    windowKeyEventHandlers,
    windowKeyEventId,
  }
  // Events always arrive with the raw renderer (renderer.ts, testing.ts), and
  // the facade's flushMutations looks the container up by `inner` — only the
  // raw renderer needs the registration.
  attachRoot(inner, container)

  const containerNode = createHostNode(
    "#container",
    ++ids.nextElementId,
    ""
  )
  containerNode.created = false

  const nodeOps: RendererOptions<HostNode, HostNode> = {
    createElement(type: string): HostNode {
      return createHostNode(type, ++ids.nextElementId, "")
    },

    createText(text: string): HostNode {
      return createHostNode("#text", ++ids.nextElementId, text)
    },

    createComment(): HostNode {
      // Comments are pure anchors — never sent to Rust. `id` stays null so
      // insertNode's mirror-only branch applies.
      return { id: null, type: "#comment", text: "", props: {}, parent: null, children: [], created: false }
    },

    setText(node: HostNode, text: string): void {
      node.text = text
      if (node.created && node.id != null && node.type !== "#comment") {
        host.renderer.setText(node.id, text)
      }
    },

    setElementText(node: HostNode, text: string): void {
      // Replace all element children with a single text run.
      for (const child of [...node.children]) {
        removeNode(child)
      }
      node.children = []
      node.text = text
      if (node.created && node.id != null) {
        host.renderer.setText(node.id, text)
      }
    },

    insert(child: HostNode, parent: HostNode, anchor: HostNode | null): void {
      insertNode(child, parent, anchor)
    },

    remove(child: HostNode): void {
      removeNode(child)
    },

    parentNode(node: HostNode): HostNode | null {
      return node.parent
    },

    nextSibling(node: HostNode): HostNode | null {
      const parent = node.parent
      if (!parent) return null
      const index = parent.children.indexOf(node)
      if (index === -1 || index + 1 >= parent.children.length) return null
      return parent.children[index + 1]
    },

    patchProp(
      node: HostNode,
      key: string,
      _prev: unknown,
      next: unknown
    ): void {
      patchNodeProp(node, key, next)
    },

    querySelector(): null {
      return null
    },

    setScopeId(): void {},

    insertStaticContent(
      content: string,
      parent: HostNode,
      anchor: HostNode | null,
      _namespace: unknown,
      start?: unknown,
      end?: unknown
    ): [HostNode, HostNode] {
      const text =
        typeof start === "number" || typeof end === "number"
          ? content.slice(typeof start === "number" ? start : 0)
          : content
      const node = createHostNode(
        text.includes("<") ? "div" : "#text",
        ++ids.nextElementId,
        text
      )
      insertNode(node, parent, anchor)
      return [node, node]
    },
  }

  const vue = createRenderer(nodeOps)

  return {
    vue,
    container: containerNode,
    renderer: host.renderer,
    flushMutations: host.flushMutations,
    registryContainer: container,
    /** Release this root's claim on the renderer's event map. Call after the
     *  Vue app unmounted, before another root may mount on the same renderer.
     *  Returns whether this root was the live one. */
    detach: () => detachRoot(inner, container),
  }

  // ── Node mutation internals (closure over container) ────────────

  function materialize(node: HostNode): void {
    if (node.created || node.id == null) return
    const r = host.renderer
    const isContainer = node.type === "#container"
    const isText = node.type === "#text"
    const type = isText ? "text" : isContainer ? "div" : node.type
    r.createElement(node.id, type)
    node.created = true
    if (isContainer) {
      // React's root element is the app's own root (which carries explicit
      // width/height 100%). Our container div is a wrapper around it, so it
      // must carry its own 100% size — percentage sizes only resolve against
      // a definite parent, and a stretch-only parent is not definite in Taffy.
      r.setStyle(node.id, { width: "100%", height: "100%" })
      r.setRoot(node.id)
      return
    }
    if (isText) {
      r.setText(node.id, node.text)
      return
    }
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "style") {
        if (value != null) r.setStyle(node.id, toGpuixStyle(value))
      } else if (key === "class") {
        // No class support — styles only.
      } else {
        const eventType = eventTypeForProp(key)
        if (eventType && isHandler(value)) {
          applyEvent(node, eventType, value)
        } else if (shouldForwardProp(node, key)) {
          r.setCustomProp(node.id, key, serializeValue(value))
        }
      }
    }
    if (node.text !== "" && node.text !== undefined) {
      r.setText(node.id, node.text)
    }
  }

  function serializeValue(value: unknown): string | number | boolean | object | null {
    if (value == null || typeof value === "function") return null
    return value as string | number | boolean | object
  }

  function applyEvent(node: HostNode, eventType: string, value: unknown): void {
    if (node.id == null) return
    if (value == null) {
      unregisterEventHandler(container.eventHandlers, node.id, eventType)
      host.renderer.setEventListener(node.id, eventType, false)
      return
    }
    const handler: (event: EventPayload) => void = Array.isArray(value)
      ? (payload) => {
          for (const fn of value) (fn as (p: EventPayload) => void)(payload)
        }
      : (value as (event: EventPayload) => void)
    registerEventHandler(container.eventHandlers, node.id, eventType, handler)
    host.renderer.setEventListener(node.id, eventType, true)
  }

  function patchNodeProp(node: HostNode, key: string, next: unknown): void {
    if (node.id == null) return
    if (key === "class") return
    if (key === "style") {
      if (next == null) delete node.props.style
      else node.props.style = next
      if (node.created) host.renderer.setStyle(node.id, toGpuixStyle(next))
      return
    }
    const eventType = eventTypeForProp(key)
    if (eventType && (isHandler(next) || next == null)) {
      if (next == null) {
        delete node.props[key]
        if (node.created) applyEvent(node, eventType, null)
      } else {
        node.props[key] = next
        if (node.created) applyEvent(node, eventType, next)
      }
      return
    }
    if (shouldForwardProp(node, key)) {
      if (next == null) delete node.props[key]
      else node.props[key] = next
      if (node.created) {
        host.renderer.setCustomProp(
          node.id,
          key,
          serializeValue(next)
        )
      }
    }
  }

  function removeFromParentMirror(node: HostNode): void {
    const parent = node.parent
    if (!parent) return
    const index = parent.children.indexOf(node)
    if (index !== -1) parent.children.splice(index, 1)
  }

  function removeNode(node: HostNode): void {
    const parent = node.parent
    if (parent && node.id != null && parent.id != null && node.created) {
      // No removeChild wire op: native destroy_element unlinks from the parent.
      host.renderer.destroyElement(node.id)
    }
    removeFromParentMirror(node)
    node.parent = null
  }

  function insertNode(
    child: HostNode,
    parent: HostNode,
    anchor: HostNode | null
  ): void {
    if (parent === containerNode && !containerNode.created) {
      materialize(containerNode)
    }
    const resolvedParent = parent
    // Move across parents: mirror-only. There is no removeChild wire op —
    // the appendChild/insertBefore below re-parents natively.
    if (child.parent && child.parent !== parent) {
      removeFromParentMirror(child)
    }
    child.parent = parent
    let index = -1
    let at = -1
    // Comment nodes are pure anchors — mirror only, never sent to Rust.
    if (child.id == null) {
      const existing = resolvedParent.children.indexOf(child)
      if (existing !== -1) resolvedParent.children.splice(existing, 1)
      resolveAnchorIndex()
      resolvedParent.children.splice(at, 0, child)
      return
    }
    // Materialize parent before child so Rust sees appendChild only for
    // already-created parents.
    if (!resolvedParent.created) materialize(resolvedParent)
    if (!child.created) materialize(child)

    if (anchor === child || anchor == null || !resolvedParent.children.includes(anchor)) {
      const existing = resolvedParent.children.indexOf(child)
      if (existing !== -1) resolvedParent.children.splice(existing, 1)
      host.renderer.appendChild(resolvedParent.id!, child.id!)
      resolvedParent.children.push(child)
      return
    }

    resolveAnchorIndex()
    if (at < resolvedParent.children.length) {
      host.renderer.insertBefore(resolvedParent.id!, child.id!, resolvedParent.children[at].id!)
      resolvedParent.children.splice(at, 0, child)
    } else {
      host.renderer.appendChild(resolvedParent.id!, child.id!)
      resolvedParent.children.push(child)
    }

    // Compute the Rust insertion index for a given anchor: the anchor's
    // position, or, for comment anchors, the next real (non-comment) node.
    function resolveAnchorIndex(): void {
      if (anchor == null) {
        at = resolvedParent.children.length
        return
      }
      index = resolvedParent.children.indexOf(anchor)
      if (index === -1) {
        // Anchor is not a child of this parent (e.g. a fragment comment that
        // was never mounted) — fall back to appending.
        at = resolvedParent.children.length
        return
      }
      const existing = resolvedParent.children.indexOf(child)
      if (existing !== -1) {
        resolvedParent.children.splice(existing, 1)
        if (existing < index) index--
      }
      at = index
      while (at < resolvedParent.children.length && resolvedParent.children[at].id == null) {
        at++
      }
    }
  }
}

export type { ElementProps }
