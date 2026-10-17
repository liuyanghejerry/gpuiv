/** Theme composable for animal-island.
 *
 *  The web original has a single default theme (CSS custom properties under
 *  `:root`). GPUIV has no CSS variables, so the token values are module
 *  constants from `./tokens.js`; this composable exists so components read
 *  them through one injection point (matching `@gpuiv/beautiful-ui`'s API)
 *  and so a future dark variant has somewhere to live.
 *
 *  Usage:
 *
 *  ```ts
 *  const theme = provideTheme()   // App root (optional)
 *  const theme = useTheme()       // any descendant; falls back to a shared theme
 *  ```
 */

import { inject, provide, type InjectionKey } from "vue"
import * as tokens from "./tokens.js"

export interface Theme {
  /** The token module (`colors`, `spacing`, `radius`, `shadows`, …). */
  tokens: typeof tokens
}

export function createTheme(): Theme {
  return { tokens }
}

const ThemeKey: InjectionKey<Theme> = Symbol("gpuiv-animal-island/theme")

/** Provide a theme to descendants. Returns the theme. */
export function provideTheme(theme: Theme = createTheme()): Theme {
  provide(ThemeKey, theme)
  return theme
}

let sharedFallback: Theme | undefined

/** The nearest provided theme, or a shared app-level default. */
export function useTheme(): Theme {
  const provided = inject(ThemeKey, null)
  if (provided) return provided
  sharedFallback ??= createTheme()
  return sharedFallback
}
