import { readFileSync } from "node:fs"
import type { NativeRenderer } from "@gpuiv/vue"
import { fonts } from "./tokens.js"

/** Original Nunito Latin + Noto Sans SC CJK faces, with normalized native
 * family names. Conversion details and OFL licences are in assets/fonts.
 */
export const ANIMAL_ISLAND_FONT_FAMILIES = {
  sans: "Animal Island Nunito",
  cjk: "Animal Island Noto Sans SC",
} as const

const names = [
  "AnimalIslandNunito-Medium", "AnimalIslandNunito-Bold", "AnimalIslandNunito-Black",
  "AnimalIslandNotoSansSC-Regular", "AnimalIslandNotoSansSC-Medium", "AnimalIslandNotoSansSC-Bold",
] as const
const loaded = new WeakSet<NativeRenderer>()
let files: Uint8Array[] | undefined

/** Call in the root setup, after native init and before rendering children.
 * GPUI caches family lookups, so loading in onMounted would be too late.
 * The sans token stays on the system default until all six faces register.
 * Ordinary native text uses its platform CJK fallback; native components
 * that expose a theme can opt into fontSansFallbacks with the cjk family.
 */
export function loadAnimalIslandFonts(renderer: NativeRenderer | null | undefined): void {
  if (!renderer?.loadFontBytes) return
  if (!loaded.has(renderer)) {
    files ??= names.map(name => readFileSync(new URL(`../assets/fonts/${name}.ttf`, import.meta.url)))
    for (const font of files) renderer.loadFontBytes(font)
    loaded.add(renderer)
  }
  fonts.sans = ANIMAL_ISLAND_FONT_FAMILIES.sans
}
