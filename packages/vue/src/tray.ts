/** Tray / status-item helpers.
 *
 * One tray per process: `setTray` replaces whatever it showed before, and
 * `clearTray` removes it. The click callback fires on a tray click (macOS
 * status item button, Windows notify-icon left click); macOS and Windows
 * only — Linux reports unsupported (StatusNotifierItem is not implemented). */

import type { NativeRenderer } from "./types.js"

export interface TrayOptions {
  /** Filesystem path of the icon (macOS: any image AppKit reads, 16-18px
   *  logical; Windows: `.ico` preferred). */
  iconPath: string
  tooltip?: string
  /** macOS: render the icon as a monochrome template that follows the
   *  menu-bar appearance. */
  template?: boolean
}

function missing(method: string): Error {
  return new Error(
    `This renderer does not implement ${method} (the offscreen test renderer and very old natives predate it).`,
  )
}

export function setTray(
  renderer: NativeRenderer,
  options: TrayOptions,
  onClick?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.setTray) return reject(missing("setTray"))
    renderer.setTray(
      {
        iconPath: options.iconPath,
        ...(options.tooltip !== undefined ? { tooltip: options.tooltip } : {}),
        ...(options.template !== undefined ? { template: options.template } : {}),
      },
      onClick ? () => onClick() : null,
      (error: Error | null) => {
        if (error) return reject(error)
        resolve()
      },
    )
  })
}

export function clearTray(renderer: NativeRenderer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.clearTray) return reject(missing("clearTray"))
    renderer.clearTray((error: Error | null) => {
      if (error) return reject(error)
      resolve()
    })
  })
}
