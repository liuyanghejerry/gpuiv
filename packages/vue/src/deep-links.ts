/** Deep link helpers: URLs the app is asked to open, and registering the app
 *  as the handler for a URL scheme. */

import type { NativeRenderer } from "./types.js"

function missing(method: string): Error {
  return new Error(
    `The native renderer does not implement ${method}; update @gpuiv/native.`
  )
}

/** Register the handler invoked when the platform asks the app to open one
 *  or more URLs — deep links, files dropped on the Dock icon, and friends.
 *  Replaces any earlier handler. */
export function onOpenUrls(renderer: NativeRenderer, handler: (urls: string[]) => void): void {
  if (!renderer.onOpenUrls) throw missing("onOpenUrls")
  renderer.onOpenUrls((error, urls) => {
    if (error) throw error
    handler(urls)
  })
}

/** Register the app as the handler for a URL scheme (e.g. `"myapp"` for
 *  `myapp://` URLs). Resolves when registration completed; rejects with the
 *  platform's reason when it did not — macOS requires 12+, a bundle id, and
 *  an installed app; Windows and Linux report unsupported. */
export function registerUrlScheme(renderer: NativeRenderer, scheme: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.registerUrlScheme) return reject(missing("registerUrlScheme"))
    renderer.registerUrlScheme(scheme, (error) => {
      if (error) return reject(error)
      resolve()
    })
  })
}
