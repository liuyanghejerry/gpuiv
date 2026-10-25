/** Tray / status-item helpers.
 *
 * One tray per process: `setTray` replaces whatever it showed before, and
 * `clearTray` removes it. The click callback fires on a tray click (macOS
 * status item button, Windows notify-icon left click); macOS and Windows
 * only — Linux reports unsupported (StatusNotifierItem is not implemented).
 * `setTrayMenu` installs a native popup on an existing tray. */

import type { NativeRenderer, TrayMenuItem } from "./types.js"
export type { TrayMenuItem } from "./types.js"

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
    `This renderer does not implement ${method} (unsupported platform or an older native/test renderer).`,
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

/** Replace the current tray's native popup menu. Null or an empty list clears
 *  it. macOS opens the menu on a status-item click; Windows keeps left-click
 *  activation separate and opens the menu from the context-menu gesture. */
export function setTrayMenu(
  renderer: NativeRenderer,
  items: TrayMenuItem[] | null,
  onAction?: (id: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!renderer.setTrayMenu) return reject(missing("setTrayMenu"))
    if (items?.length && !onAction) {
      return reject(new Error("setTrayMenu needs an action handler for a non-empty menu"))
    }
    renderer.setTrayMenu(
      items,
      items?.length && onAction
        ? (error, id) => {
            if (error) throw error
            onAction(id)
          }
        : null,
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
