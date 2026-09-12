/** Promise wrappers over the native file-dialog callbacks.
 *
 * The napi layer is errback-style (the dialog answer arrives from a
 * background thread), but application code should not have to thread a
 * callback through: these helpers turn the one-shot answers into Promises,
 * the shape the DOM's `showOpenFilePicker()` made canonical for JS. */

import type {
  NativeRenderer,
  NewPathPromptOptions,
  NewPathPromptOutcome,
  PathPromptOptions,
  PathPromptOutcome,
} from "./types.js"

function missing(method: string): Error {
  return new Error(
    `The native renderer does not implement ${method}; update @gpuiv/native.`
  )
}

/** Open the platform file-selection dialog.
 *
 * Resolves with the selected paths, or `null` when the user cancelled. */
export function promptForPaths(
  renderer: NativeRenderer,
  options: PathPromptOptions
): Promise<string[] | null> {
  return new Promise((resolve, reject) => {
    if (!renderer.promptForPaths) return reject(missing("promptForPaths"))
    renderer.promptForPaths(options, (error, outcome: PathPromptOutcome | null) => {
      if (error) return reject(error)
      resolve(outcome?.paths ?? null)
    })
  })
}

/** Open the platform save dialog.
 *
 * Resolves with the chosen path, or `null` when the user cancelled. */
export function promptForNewPath(
  renderer: NativeRenderer,
  options: NewPathPromptOptions = {}
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!renderer.promptForNewPath) return reject(missing("promptForNewPath"))
    renderer.promptForNewPath(
      options.directory ?? null,
      options.suggestedName ?? null,
      (error, outcome: NewPathPromptOutcome | null) => {
        if (error) return reject(error)
        resolve(outcome?.path ?? null)
      }
    )
  })
}
