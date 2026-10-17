import type { EventPayload } from "@gpuiv/vue"

export interface ImageEventDetails extends Record<string, unknown> { src: string }

/** Decode only completions for the currently displayed source. */
export function readImageEvent(event: EventPayload, src: string): ImageEventDetails | null {
  if (typeof event.value !== "string") return null
  try {
    const details: unknown = JSON.parse(event.value)
    return typeof details === "object" && details !== null &&
      "src" in details && details.src === src ? details as ImageEventDetails : null
  } catch {
    return null
  }
}

/** Match asynchronous image completions to the currently displayed source. */
export function imageEventMatches(event: EventPayload, src: string): boolean {
  return readImageEvent(event, src) !== null
}
