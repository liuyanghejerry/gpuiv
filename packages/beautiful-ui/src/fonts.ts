import { readFileSync } from "node:fs"
import type { NativeRenderer } from "@gpuiv/vue"

const loaded = new WeakSet<NativeRenderer>()
let files: Uint8Array[] | undefined

/** Register the bundled OFL fonts with this host's native text system. */
export function loadBeautifulFonts(renderer: NativeRenderer | null) {
  if (!renderer?.loadFontBytes || loaded.has(renderer)) return
  files ??= ["Inter", "JetBrainsMono"].map((name) => readFileSync(new URL(`../fonts/${name}.ttf`, import.meta.url)))
  for (const font of files) renderer.loadFontBytes(font)
  loaded.add(renderer)
}
