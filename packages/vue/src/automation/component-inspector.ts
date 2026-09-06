/// Component-state inspector for the automation protocol.
///
/// Walks Vue's internal component-instance tree (`app._instance` → `subTree`
/// → `vnode.component`) — the same fields Vue DevTools itself relies on.
/// These fields are NOT covered by Vue's public API promise, so every entry
/// point fails closed: when Vue reshapes them the caller sees `null`, never
/// a throw, and the rest of the protocol keeps working.
///
/// Element attribution is free because GPUIV host nodes are JS objects and
/// `vnode.el` carries the automation element id, so "which component rendered
/// this element" needs no renderer changes.
///
/// Every read runs under `pauseTracking()` / `resetTracking()`. Without that,
/// one `getComponentState` call would register the inspector as a reactive
/// dependency of the inspected component and re-render it on every later
/// state change.
///
/// `instance.computed` no longer exists in Vue 3.5: computed refs returned
/// from `setup` surface through `setupState` (refs read unwrapped), and
/// options-API `data` has its own field. There is no public handle for
/// options-API `computed` — it hides behind the instance proxy.

import { isRef, type App as VueApp, type VNode } from "vue"
// `pauseTracking`/`resetTracking` are reactivity-internal in every Vue
// version and not re-exported by the `vue` metapackage, hence the direct
// dependency. Vue 3.5 renamed the old pause/resume pair to this nested
// form; keep `@vue/reactivity` pinned to the same line as `vue`.
import { pauseTracking, resetTracking } from "@vue/reactivity"
import type { ComponentInspector } from "./client.js"
import type { ComponentTreeNode, SerializedValue } from "./protocol.js"
import type { HostNode } from "../types.js"

/** Bounds so one fat component state cannot drown the protocol payload. */
const MAX_DEPTH = 4
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 50
const MAX_STRING = 500

/** The subset of Vue's ComponentInternalInstance the walker touches. */
interface InspectorInstance {
  type: { name?: string; __name?: string; __file?: string } | Function
  subTree: VNode
  setupState: unknown
  props: unknown
  attrs: unknown
  data: unknown
  isUnmounted?: boolean
}

interface InstanceNode {
  /** Sequential per-call id, assigned in DFS order. */
  id: number
  instance: InspectorInstance
  hostIds: number[]
  children: InstanceNode[]
}

function componentName(type: InspectorInstance["type"]): string {
  if (typeof type === "function") return type.name || "Anonymous"
  return type.name ?? type.__name ?? "Anonymous"
}

function componentFile(type: InspectorInstance["type"]): string | undefined {
  if (typeof type === "function") return undefined
  return type.__file
}

function serialize(value: unknown, depth: number, seen: Set<object>): SerializedValue {
  if (isRef(value)) {
    try {
      return serialize(value.value, depth, seen)
    } catch (error) {
      return `[threw: ${String(error)}]`
    }
  }
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
    case "number":
    case "boolean":
      return value
    case "bigint":
      return String(value)
    case "function":
      return `ƒ ${(value as { name?: string }).name || "anonymous"}()`
    case "symbol":
      return String(value)
  }
  if (value instanceof Error) return `Error: ${value.message}`
  if (depth >= MAX_DEPTH) return "…"
  const obj = value as object
  if (seen.has(obj)) return "[circular]"
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      const items = obj
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => serialize(item, depth + 1, seen))
      if (obj.length > MAX_ARRAY_ITEMS) {
        items.push(`…+${obj.length - MAX_ARRAY_ITEMS} more`)
      }
      return items
    }
    if (obj instanceof Map) {
      const record: Record<string, SerializedValue> = {}
      let i = 0
      for (const [key, entry] of obj) {
        if (i >= MAX_ARRAY_ITEMS) {
          record["…"] = `+${obj.size - i} more`
          break
        }
        record[String(key)] = serialize(entry, depth + 1, seen)
        i += 1
      }
      return record
    }
    if (obj instanceof Set) {
      return serialize([...obj], depth + 1, seen)
    }
    const record: Record<string, SerializedValue> = {}
    const keys = Object.keys(obj).slice(0, MAX_OBJECT_KEYS)
    for (const key of keys) {
      try {
        record[key] = serialize((obj as Record<string, unknown>)[key], depth + 1, seen)
      } catch (error) {
        record[key] = `[threw: ${String(error)}]`
      }
    }
    return record
  } finally {
    seen.delete(obj)
  }
}

/** One record off the instance (`props`, `attrs`, `setupState`, `data`). */
function serializeRecord(source: unknown): Record<string, SerializedValue> | undefined {
  if (source === null || source === undefined) return undefined
  try {
    return serialize(source, 0, new Set()) as Record<string, SerializedValue>
  } catch (error) {
    return { "[unavailable]": String(error) }
  }
}

/** Collect this instance's own host ids and the child component instances.
 *  Component vnodes stop the descent — their subtree belongs to the child,
 *  and their `el` alias the child's first host node. */
function collectSubTree(
  vnode: VNode | null | undefined,
  hostIds: number[],
  childInstances: InspectorInstance[]
): void {
  if (!vnode) return
  const component = vnode.component as InspectorInstance | null
  if (component) {
    childInstances.push(component)
    return
  }
  const el = vnode.el as HostNode | null
  if (el && el.id != null) hostIds.push(el.id)
  const { children } = vnode
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === "object") {
        collectSubTree(child as VNode, hostIds, childInstances)
      }
    }
  }
  // Compiled block trees keep fast re-render paths here; the public VNode
  // type omits the field, so reach it structurally.
  const dynamic = (vnode as unknown as { dynamicChildren?: VNode[] })
    .dynamicChildren
  if (dynamic) {
    for (const child of dynamic) collectSubTree(child, hostIds, childInstances)
  }
}

function buildInstanceTree(root: InspectorInstance): InstanceNode {
  let nextId = 0
  const visited = new Set<InspectorInstance>([root])

  const visit = (instance: InspectorInstance): InstanceNode => {
    const hostIds: number[] = []
    const childInstances: InspectorInstance[] = []
    collectSubTree(instance.subTree, hostIds, childInstances)
    const node: InstanceNode = { id: ++nextId, instance, hostIds, children: [] }
    for (const child of childInstances) {
      if (child.isUnmounted || visited.has(child)) continue
      visited.add(child)
      node.children.push(visit(child))
    }
    return node
  }

  return visit(root)
}

function serializeInstance(node: InstanceNode): ComponentTreeNode {
  const { type } = node.instance
  return {
    id: node.id,
    name: componentName(type),
    ...(componentFile(type) ? { file: componentFile(type) } : {}),
    hostIds: node.hostIds,
    props: serializeRecord(node.instance.props),
    attrs: serializeRecord(node.instance.attrs),
    state: serializeRecord(node.instance.setupState),
    data: serializeRecord(node.instance.data),
    children: node.children.map(serializeInstance),
  }
}

/**
 * Build an inspector over a mounted GPUIV Vue app. Attach it to the
 * automation session with `connectTest(renderer, settle, inspector)`; the
 * live app wires it up automatically after mount.
 */
export function createComponentInspector(app: VueApp<HostNode>): ComponentInspector {
  const rootInstance = (): InspectorInstance | null => {
    const root = (app as unknown as { _instance?: InspectorInstance })._instance
    return root && !root.isUnmounted ? root : null
  }
  return {
    getComponentTree(): ComponentTreeNode[] | null {
      const root = rootInstance()
      if (!root) return null
      try {
        pauseTracking()
        try {
          return [serializeInstance(buildInstanceTree(root))]
        } finally {
          resetTracking()
        }
      } catch {
        // Vue internals moved. Degrade to "no components" instead of
        // poisoning the whole automation session.
        return null
      }
    },
    getComponentState(elementId: number): ComponentTreeNode | null {
      const root = rootInstance()
      if (!root) return null
      try {
        pauseTracking()
        try {
          const tree = buildInstanceTree(root)
          const stack = [tree]
          while (stack.length > 0) {
            const node = stack.pop()!
            if (node.hostIds.includes(elementId)) {
              return { ...serializeInstance(node), children: undefined }
            }
            stack.push(...node.children)
          }
          return null
        } finally {
          resetTracking()
        }
      } catch {
        return null
      }
    },
  }
}
