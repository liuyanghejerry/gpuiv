/** Generate the chat example's app icons (dev machine only).
 *
 * Needs `rsvg-convert` (brew install librsvg); the .ico writer is pure TS.
 * Output goes to ./dist — gitignored, consumed by `bun run package`. */
import { buildAppIcons } from '@gpuiv/packager/icons'

const icons = await buildAppIcons({
  svg: './assets/icons/openai-mark.svg',
  outDir: './dist',
  background: '#10a37f',
})

console.log(
  `[icons] ${icons.icns ?? '(no icns off-darwin)'} + ${icons.ico} ready in ./dist`,
)
