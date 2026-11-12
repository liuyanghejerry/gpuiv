/// Buffers Vue host-config mutations into one applyBatch() FFI call per flush.
///
/// Queue raw objects for setStyle / setCustomProp. Do not JSON.stringify them
/// first. The outer applyBatch stringify would escape that string again, and
/// Rust would parse twice. A 10k-row mount spent 626ms in applyBatch that way.
///
/// The wire format is exactly ten ops: createElement, destroyElement,
/// appendChild, insertBefore, setStyle, setText, setEventListener, setRoot,
/// setKeyboardFocusDim, setCustomProp — all with raw (unstringified) values.
/// There is no removeChild op: destroy_element unlinks from the parent
/// itself, and appendChild/insertBefore re-parent natively.
///
/// ## Batch timing
///
/// Vue's renderer is synchronous within a patch, but its component updates run
/// through the scheduler on a microtask. The `schedule` callback fires after
/// every enqueued op, so the host can flush the batch on a microtask that runs
/// after Vue's scheduler has finished its jobs. `flushMutations()` drains the
/// queue synchronously for callers that need the Rust tree current (mount,
/// tests, clock-pinned frames):
///
///   state change → Vue scheduler → patchProp/insert/remove callbacks
///                                ↓ each callback queues ops
///                                queue.push([name, ...args])  → schedule()
///                                ... (microtask)              → applyBatch(json)
///
/// Multiple state updates batched by Vue into one flush = one batch.

import type { MutationRenderer, NativeRenderer } from "../types.js"
import { containerForRenderer, unregisterEventHandlers } from "./event-registry.js"

export type MutationTuple = (number | string | boolean | object | null)[]

/**
 * Structural equality for the JSON values a mutation carries: styles and
 * custom props. A key whose value is `undefined` counts as absent, because
 * `JSON.stringify` drops it, so `{ color: undefined }` and `{}` reach Rust as
 * the same payload and must compare equal here.
 *
 * Only plain objects, arrays and primitives are compared. A function or class
 * instance is equal to itself and nothing else.
 */
export function sameMutationValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  // NaN serializes to null on both sides, and -0 to 0, so neither is a change.
  if (typeof left === "number" && typeof right === "number") return left !== left && right !== right
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false
  }
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (!sameMutationValue(left[index], right[index])) return false
    }
    return true
  }
  if (Array.isArray(right)) return false
  const leftProto = Object.getPrototypeOf(left)
  if (leftProto !== Object.prototype && leftProto !== null) return false
  if (Object.getPrototypeOf(right) !== leftProto) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  let defined = 0
  for (const key in leftRecord) {
    const value = leftRecord[key]
    if (value === undefined) continue
    defined++
    if (!sameMutationValue(value, rightRecord[key])) return false
  }
  let rightDefined = 0
  for (const key in rightRecord) {
    if (rightRecord[key] !== undefined) rightDefined++
  }
  return defined === rightDefined
}

let appliedBatches = 0

/**
 * How many batches of mutations have reached a renderer, across every queue.
 * It moves whenever the tree changes, which makes it the signal that an app is
 * still working: `collectGarbageWhenIdle` waits for it to hold still.
 */
export function appliedBatchCount(): number {
  return appliedBatches
}

/**
 * Wrap a NativeRenderer with batching support.
 *
 * The returned facade exists only for the Vue host config's mutation stream.
 * Application commands (scroll, selection, window, debug) use the original
 * NativeRenderer.
 *
 * `schedule` (optional) is called after each op is queued, so the host can
 * flush the batch at a chosen boundary (a microtask after Vue's scheduler).
 */
export function wrapWithBatching(
  inner: NativeRenderer,
  schedule?: () => void
): MutationRenderer {
  let queue: MutationTuple[] = []

  const enqueue = (op: MutationTuple): void => {
    queue.push(op)
    schedule?.()
  }

  return {
    createElement(id, elementType) {
      enqueue(["createElement", id, elementType])
    },
    destroyElement(id) {
      enqueue(["destroyElement", id])
      // Destroyed ids come back from applyBatch at flush time.
      return []
    },
    appendChild(parentId, childId) {
      enqueue(["appendChild", parentId, childId])
    },
    insertBefore(parentId, childId, beforeId) {
      enqueue(["insertBefore", parentId, childId, beforeId])
    },
    setStyle(id, style) {
      enqueue(["setStyle", id, style])
    },
    setText(id, content) {
      enqueue(["setText", id, content])
    },
    setEventListener(id, eventType, hasHandler) {
      enqueue(["setEventListener", id, eventType, hasHandler])
    },
    setRoot(id) {
      enqueue(["setRoot", id])
    },
    setKeyboardFocusDim(enabled) {
      enqueue(["setKeyboardFocusDim", enabled])
    },
    setCustomProp(id, key, value) {
      enqueue(["setCustomProp", id, key, value])
    },
    flushMutations() {
      if (queue.length === 0) return

      // Preserve the queue on failure so JS and Rust cannot desync.
      const destroyedIds = inner.applyBatch(JSON.stringify(queue))
      appliedBatches++
      const container = containerForRenderer(inner)
      if (container) {
        for (const id of destroyedIds) {
          unregisterEventHandlers(container.eventHandlers, id)
        }
      }

      // applyBatch already invalidates, so only clear after batch + cleanup.
      queue = []
    },
  }
}
