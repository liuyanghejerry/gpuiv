/**
 * Public entry for the injected HMR calls (`import { … } from "@gpuiv/vue/hmr"`).
 * Only the two functions the transform injects belong here — the rest of the
 * registry is internal.
 */
export { __gpuivHmrComponent, __gpuivHmrFile } from "./runtime.js"
