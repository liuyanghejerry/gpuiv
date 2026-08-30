/// Buffers Vue host-config mutations into one applyBatch() FFI call per flush.
///
/// Queue raw objects for setStyle / setCustomProp. Do not JSON.stringify them
/// first. The outer applyBatch stringify would escape that string again, and
/// Rust would parse twice. A 10k-row mount spent 626ms in applyBatch that way.
///
/// The wire format is exactly nine ops: createElement, destroyElement,
/// appendChild, insertBefore, setStyle, setText, setEventListener, setRoot,
/// setCustomProp — all with raw (unstringified) values. There is no
/// removeChild op: destroy_element unlinks from the parent itself, and
/// appendChild/insertBefore re-parent natively.
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
    setCustomProp(id, key, value) {
      enqueue(["setCustomProp", id, key, value])
    },
    flushMutations() {
      if (queue.length === 0) return

      // Preserve the queue on failure so JS and Rust cannot desync.
      const destroyedIds = inner.applyBatch(JSON.stringify(queue))
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
