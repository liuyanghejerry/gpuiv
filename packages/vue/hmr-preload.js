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
 * src/hmr/runtime.ts. Files outside the project's own source (node_modules,
 * this package itself) and files the transform cannot scan are left alone.
 */
import { plugin } from "bun"
import { transformHmrSource } from "./dist/hmr/transform.js"

plugin({
  name: "gpuiv-vue-hmr",
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      if (
        args.path.includes("/node_modules/") ||
        args.path.includes("/packages/vue/") ||
        args.path.endsWith(".d.ts")
      ) {
        return undefined
      }
      let source
      try {
        source = await Bun.file(args.path).text()
      } catch {
        return undefined
      }
      let transformed
      try {
        transformed = transformHmrSource(source, args.path)
      } catch {
        return undefined
      }
      if (transformed === source) return undefined
      return { contents: transformed, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }
    })
  },
})
