/** Theme composable — the runtime answer to globals.css's `.dark` class.
 *
 *  The web original swaps two CSS variable maps under a `.dark` class on
 *  `<html>`. GPUIV has no CSS variables, so the token map is reactive Vue
 *  state instead: components read `theme.tokens.value` inside their render
 *  function and re-render when the mode flips.
 *
 *  Usage:
 *
 *  ```ts
 *  // App root
 *  const theme = provideTheme()           // or provideTheme({ dark: true })
 *
 *  // Any descendant component
 *  const theme = useTheme()
 *  return () => <div style={{ backgroundColor: theme.tokens.value.surface }} />
 *  ```
 *
 *  `useTheme()` outside a provider falls back to a shared app-level theme,
 *  so primitives also render in stories/tests that skip `provideTheme()`.
 */

import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue"
import { createShadows, darkTokens, lightTokens, type Shadows, type Tokens } from "./tokens.js"

export interface Theme {
  /** Reactive dark-mode flag. */
  isDark: Ref<boolean>
  /** The active token map. */
  tokens: ComputedRef<Tokens>
  /** The active elevation set (border ring + single blur shadow). */
  shadows: ComputedRef<Shadows>
  setDark(dark: boolean): void
  toggle(): void
}

export function createTheme(options: { dark?: boolean } = {}): Theme {
  const isDark = ref(options.dark ?? false)
  const tokens = computed(() => (isDark.value ? darkTokens : lightTokens))
  const shadows = computed(() => createShadows(tokens.value, isDark.value))
  return {
    isDark,
    tokens,
    shadows,
    setDark(dark: boolean) {
      isDark.value = dark
    },
    toggle() {
      isDark.value = !isDark.value
    },
  }
}

const ThemeKey: InjectionKey<Theme> = Symbol("gpuiv-beautiful-ui/theme")

/** Create (or wrap) a theme and provide it to descendants. Returns the theme. */
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
