/** Deep link helpers: URLs the app is asked to open, and registering the app
 *  as the handler for a URL scheme. */

import type { NativeRenderer } from "./types.js"
import { fileURLToPath } from "node:url"

const subscriptions = new WeakMap<NativeRenderer, { handler: (urls: string[]) => void }>()

/** One OS delivery. Paths are decoded absolute local paths, URLs retain
 * their original spelling. The app decides whether to open tabs/windows. */
export interface OpenRequest {
  paths: string[]
  urls: string[]
  /** Invalid file URLs are reported individually; valid siblings survive. */
  errors: Array<{ url: string; error: Error }>
}

/** Decode OS file URLs with Node's platform-aware converter (Unicode,
 * percent escapes, Windows drive letters and UNC paths). No filesystem
 * reads, command execution, extension filtering or deduplication. */
export function parseOpenRequest(urls: readonly string[]): OpenRequest {
  const request: OpenRequest = { paths: [], urls: [], errors: [] }
  for (const url of urls) {
    if (!/^file:/i.test(url)) {
      request.urls.push(url)
      continue
    }
    try {
      const parsed = new URL(url)
      if (parsed.search || parsed.hash) throw new Error("File URLs must not contain a query or fragment")
      const path = fileURLToPath(parsed)
      if (path.includes("\0")) throw new Error("File paths must not contain NUL")
      request.paths.push(path)
    } catch (error) {
      request.errors.push({ url, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }
  return request
}

function missing(method: string): Error {
  return new Error(
    `The native renderer does not implement ${method}; update @gpuiv/native.`
  )
}

/** Register the handler invoked when the platform asks the app to open one
 *  or more URLs — deep links, files dropped on the Dock icon, and friends.
 *  Replaces any earlier handler. Native startup batches replay in order.
 *  Dispose before tearing down the application. Disposing an older helper
 *  subscription does not clear its replacement on the same renderer.
 *  This owns the process-wide native callback; do not mix with direct
 *  renderer.onOpenUrls calls or subscriptions on another renderer. */
export function onOpenUrls(renderer: NativeRenderer, handler: (urls: string[]) => void): () => void {
  if (!renderer.onOpenUrls) throw missing("onOpenUrls")
  const subscription = { handler }
  const previous = subscriptions.get(renderer)
  subscriptions.set(renderer, subscription)
  try {
    renderer.onOpenUrls((error, urls) => {
      // A native call already queued on Node may outlive replacement (HMR).
      // Route it to the current owner rather than losing the open request.
      const current = subscriptions.get(renderer)
      if (!current) return
      if (error) throw error
      current.handler(urls)
    })
  } catch (error) {
    if (previous) subscriptions.set(renderer, previous)
    else subscriptions.delete(renderer)
    throw error
  }
  return () => {
    if (subscriptions.get(renderer) !== subscription) return
    subscriptions.delete(renderer)
    renderer.onOpenUrls?.(null)
  }
}

/** File opening and deep links share one OS callback. Register together so
 * neither overwrites the other. macOS Finder/Dock opens arrive as file URLs;
 * command-line arguments and single-instance IPC are app-owned inputs. */
export function onOpenRequests(renderer: NativeRenderer, handler: (request: OpenRequest) => void): () => void {
  return onOpenUrls(renderer, (urls) => handler(parseOpenRequest(urls)))
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
