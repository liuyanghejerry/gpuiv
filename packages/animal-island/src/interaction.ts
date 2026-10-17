import type { EventPayload } from "@gpuiv/vue"

/** Enter/Space keyboard activation for div-based controls
 *  (`role="button"` does not imply keyboard activation in GPUIV). */
export function activationKeys(fn: (e: EventPayload) => void) {
  return (e: EventPayload) => {
    if (e.key === "enter" || e.key === "space" || e.key === " ") fn(e)
  }
}
