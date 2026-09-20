/** @gpuiv/beautiful-ui — AI chat primitives rendered natively on the GPU.
 *
 * Phase A: ContextCards, SearchList, FilterTable, RecommendationCard,
 * ChatComposer, CodeBlock, LoadingState (+ supporting atoms).
 *
 * @see https://github.com/liuyanghejerry/gpuiv/issues/110
 */

// tokens & theme
export { lightTokens, darkTokens, shadowCard, shadowRaised, shadowOverlay, shadowHairline, shadowBtn, shadowInsetField, radius, ease } from "./tokens.js"
export type { TokenKey, ShadowKey } from "./tokens.js"
export { useTheme, token } from "./theme.js"

// atoms
export * from "./atoms/index.js"

// primitives (Phase A)
export * from "./primitives/index.js"
