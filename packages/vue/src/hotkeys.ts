/** Global-shortcut helpers.
 *
 * `registerGlobalShortcut` arms a system-wide hotkey (any app focused);
 * registering the same accelerator again replaces it, `unregisterGlobalShortcut`
 * removes it. macOS uses Carbon RegisterEventHotKey (no accessibility
 * permission needed), Windows uses RegisterHotKey; Linux reports unsupported.
 *
 * Accelerators are `'+'`-separated: modifiers `ctrl`, `alt`/`option`,
 * `shift`, `cmd`/`win`/`super`, then one key — `a`–`z`, `0`–`9`, `f1`–`f12`.
 * Example: `"cmd+shift+j"`, `"ctrl+alt+t"`. */

import type { NativeRenderer } from "./types.js"

function missing(method: string): Error {
  return new Error(
    `This renderer does not implement ${method} (the offscreen test renderer and very old natives predate it).`,
  )
}

export function registerGlobalShortcut(
  renderer: NativeRenderer,
  accelerator: string,
  onTrigger?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.registerGlobalShortcut) return reject(missing("registerGlobalShortcut"))
    renderer.registerGlobalShortcut(
      { accelerator },
      onTrigger ? () => onTrigger() : null,
      (error: Error | null) => {
        if (error) return reject(error)
        resolve()
      },
    )
  })
}

export function unregisterGlobalShortcut(renderer: NativeRenderer, accelerator: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.unregisterGlobalShortcut) return reject(missing("unregisterGlobalShortcut"))
    renderer.unregisterGlobalShortcut(accelerator, (error: Error | null) => {
      if (error) return reject(error)
      resolve()
    })
  })
}
