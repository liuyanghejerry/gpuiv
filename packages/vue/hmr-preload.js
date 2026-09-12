/**
 * Bun preload for GPUIV's Vue Fast Refresh under `bun --hot`.
 *
 * Register it from the app's bunfig.toml so Bun rewrites every component
 * module before evaluation:
 *
 *   # bunfig.toml
 *   preload = ["./node_modules/@gpuiv/vue/hmr-preload.js"]
 *
 * (In the GPUIV monorepo the examples use a relative path instead:
 * `preload = ["../packages/vue/hmr-preload.js"]`.)
 *
 * The plugin injects per-file/per-component registration calls next to each
 * top-level `const X = defineComponent(...)`; the runtime half lives in
 * src/hmr/runtime.ts and the filter/loader half in src/hmr/preload.ts.
 * node_modules, this package's own files, `.d.ts` files, and files the
 * transform cannot scan are left alone.
 */
import { plugin } from "bun"
import { createHmrPreload } from "./dist/hmr/preload.js"

const hmr = createHmrPreload({ packageDir: import.meta.dir })

plugin({
  name: "gpuiv-vue-hmr",
  setup(build) {
    build.onLoad({ filter: hmr.filter }, (args) => hmr.load(args.path))
  },
})
