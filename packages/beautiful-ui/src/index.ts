/** @gpuiv/beautiful-ui — AI chat primitives rendered natively on the GPU.
 *
 *  Ported from beautiful-ui (https://github.com/slev12397/beautiful-ui):
 *  Phase 0 design tokens + Phase 1 primitives (ContextCards, SearchList,
 *  FilterTable, RecommendationCard, ChatComposer, CodeBlock, LoadingState).
 *
 *  @see https://github.com/liuyanghejerry/gpuiv/issues/110
 */

// tokens, colours & theme
export { lightTokens, darkTokens, createShadows, radius, fonts, ease, duration } from "./tokens.js"
export type { Tokens, Shadows, Shadow } from "./tokens.js"
export { mix, withAlpha, toSrgb, parseColor } from "./colors.js"
export { createTheme, provideTheme, useTheme, type Theme } from "./theme.js"
export { icons, type IconName } from "./icons.js"

// atoms
export * from "./atoms/index.js"

// primitives
export * from "./primitives/index.js"
