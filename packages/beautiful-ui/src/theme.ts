/** Theme composable — tracks light/dark mode and exposes the active token map. */

import { computed, ref, type Ref } from "vue"
import { lightTokens, darkTokens, type TokenKey } from "./tokens.js"

export type TokenMap = typeof lightTokens

export function useTheme() {
  const isDark = ref(false)

  const tokens = computed<TokenMap>(() => (isDark.value ? darkTokens : lightTokens) as TokenMap)

  function toggle() {
    isDark.value = !isDark.value
  }

  return { isDark, tokens, toggle }
}

/** Resolve a single token to its current colour string. */
export function token(t: TokenKey, isDark = false): string {
  return isDark ? darkTokens[t] : lightTokens[t]
}
