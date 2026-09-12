/**
 * The Bun-plugin half of GPUIV's Vue Fast Refresh: the path filter and the
 * onLoad callback that hmr-preload.js registers with `Bun.plugin`. It lives in
 * src so the tests can drive it without a Bun plugin runtime; hmr-preload.js
 * owns the Bun-specific `plugin()` call.
 *
 * Fast Refresh is best-effort: a file the transform cannot scan comes back
 * unchanged and keeps the classic full-remount behaviour. Bun is stricter
 * about one thing — every path the filter matches must resolve to a module.
 * An onLoad that returns `undefined` for a matched file throws
 * ("Expected module mock to return an object" on Bun 1.3.14), so the
 * exclusions live in the filter itself and every remaining branch returns
 * contents.
 */
import { readFile } from "node:fs/promises"
import { transformHmrSource } from "./transform.js"

export interface HmrPreloadOptions {
  /** Directory whose files are never transformed — the @gpuiv/vue install
   *  directory the preload ships in, passed as `import.meta.dir`. Apps call
   *  the preload from node_modules, so this is the package, never the app's
   *  own source; without it a monorepo app living in `packages/vue/` would
   *  silently get no HMR. */
  packageDir?: string
  /** Import specifier the injected registration calls load the runtime from.
   *  The tests point it at src; the shipped preload keeps the default. */
  importSpecifier?: string
}

export interface HmrPreload {
  /** `build.onLoad` filter. Excluded paths (node_modules, this package, .d.ts
   *  files) never match, so they never reach `load`. */
  filter: RegExp
  /** `build.onLoad` callback: for a matched path it always resolves with the
   *  module — the transformed source when the transform found components, the
   *  source itself otherwise. */
  load: (path: string) => Promise<{ contents: string; loader: "ts" | "tsx" }>
}

/** Regex source for one path separator, either platform's. */
const SEPARATOR = "[\\\\/]"

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Regex source matching any path inside `dir`, on either platform. */
function directoryPrefixPattern(dir: string): string {
  return dir.split(/[\\/]/).map(escapeRegExp).join(SEPARATOR) + SEPARATOR
}

export function createHmrPreload(options: HmrPreloadOptions = {}): HmrPreload {
  const excluded = [".*" + SEPARATOR + "node_modules" + SEPARATOR, ".*\\.d\\.[mc]?ts$"]
  if (options.packageDir) excluded.unshift(directoryPrefixPattern(options.packageDir))
  const filter = new RegExp(
    "^" + excluded.map((pattern) => `(?!${pattern})`).join("") + ".*\\.tsx?$",
    "i"
  )
  const importSpecifier = options.importSpecifier ?? "@gpuiv/vue/hmr"

  return {
    filter,
    load: async (path) => {
      const loader = /\.tsx$/i.test(path) ? "tsx" : "ts"
      // A file Bun cannot read fails the module load either way; let the
      // rejection carry the path instead of pretending the module is empty.
      const source = await readFile(path, "utf8")
      try {
        return { contents: transformHmrSource(source, path, importSpecifier), loader }
      } catch (error) {
        // The transform is a source scanner, not a parser: a file it chokes on
        // keeps the classic remount. Warn, or a transform bug looks exactly
        // like HMR simply not reloading the file.
        console.warn(`[gpuiv] HMR transform failed for ${path}`, error)
        return { contents: source, loader }
      }
    },
  }
}
