import type { EventPayload } from "@gpuiv/vue"

/** Native divs need explicit keyboard activation; a role alone does not
 * give them HTML button behavior. Keep this on the same host as onClick. */
export function activationKeys(activate: (() => void) | undefined) {
  return (event: EventPayload) => {
    if (event.key === "enter" || event.key === "space" || event.key === " ") activate?.()
  }
}
