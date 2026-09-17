/** Helpers over the OS notification center bridge.
 *
 * The renderer methods are direct napi calls; these wrappers only add the
 * missing-method error so a stale `@gpuiv/native` fails loudly instead of
 * silently dropping notifications. */

import type {
  NativeRenderer,
  SystemNotificationOptions,
  SystemNotificationResponse,
} from "./types.js"

function missing(method: string): Error {
  return new Error(
    `The native renderer does not implement ${method}; update @gpuiv/native.`
  )
}

/** Set the app's process-wide identity and user-visible name. Call once,
 *  early — before posting notifications. */
export function setAppIdentity(
  renderer: NativeRenderer,
  identifier: string,
  name: string
): void {
  if (!renderer.setAppIdentity) throw missing("setAppIdentity")
  renderer.setAppIdentity(identifier, name)
}

/** Post a notification to the OS notification center. Returns the effective
 *  tag — the described one, or a generated tag when omitted — so an untagged
 *  notification can still be dismissed. */
export function showSystemNotification(
  renderer: NativeRenderer,
  notification: SystemNotificationOptions
): string {
  if (!renderer.showSystemNotification) throw missing("showSystemNotification")
  return renderer.showSystemNotification(notification)
}

/** Remove the delivered or pending notification with this tag. */
export function dismissSystemNotification(renderer: NativeRenderer, tag: string): void {
  if (!renderer.dismissSystemNotification) throw missing("dismissSystemNotification")
  renderer.dismissSystemNotification(tag)
}

/** Register the handler for notification activations — the body or an
 *  action button. Replaces any earlier handler. */
export function onSystemNotificationResponse(
  renderer: NativeRenderer,
  handler: (response: SystemNotificationResponse) => void
): void {
  if (!renderer.onSystemNotificationResponse)
    throw missing("onSystemNotificationResponse")
  renderer.onSystemNotificationResponse((error, response) => {
    if (error) throw error
    handler(response)
  })
}
