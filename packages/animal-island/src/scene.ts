/** Filesystem paths of the bundled scene wallpapers
 *  (`assets/scene/*.svg`, copied from animal-island-vue's
 *  `src/assets/img/scene/` — https://github.com/guokaigdg/animal-island-vue, MIT).
 *
 *  Resolved the same way as beautiful-ui's `fonts.ts`: this module sits one
 *  level below the package root in both `src/` and `dist/`, so
 *  `../assets/scene/<name>.svg` lands on the same directory either way.
 *  `<img>` takes the resulting fs path as `src`.
 */

import { fileURLToPath } from "node:url"

export const sweetCornerScene = fileURLToPath(new URL("../assets/scene/sweet-corner.svg", import.meta.url))
export const coffeeBreakScene = fileURLToPath(new URL("../assets/scene/coffee-break.svg", import.meta.url))
/** React Animal Island Progress scene variants (MIT). */
export const forestGroveScene = fileURLToPath(new URL("../assets/scene/forest-grove.svg", import.meta.url))
export const starryCampScene = fileURLToPath(new URL("../assets/scene/starry-camp.svg", import.meta.url))
