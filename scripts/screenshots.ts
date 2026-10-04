/**
 * Regenerate the screenshots the README links to.
 *
 * Test output lands in gitignored `screenshots/` folders and churns on every
 * run. Only the curated set below is committed, so the README never shows a
 * stale frame and the repo never carries a binary diff per test run.
 *
 *   bun scripts/screenshots.ts
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'images')

/** `[source screenshot, committed name]`, relative to the repo root. */
const CURATED: [string, string][] = [
  ['examples/screenshots/readme-chat.png', 'readme-chat.png'],
  ['examples/screenshots/readme-editor.png', 'readme-editor.png'],
  ['examples/screenshots/readme-gallery.png', 'readme-gallery.png'],
  ['examples/screenshots/readme-canvas.png', 'readme-canvas.png'],
  ['examples/screenshots/chat-top.png', 'chat-app.png'],
  ['examples/screenshots/chat-model-picker.png', 'chat-model-picker.png'],
  ['examples/screenshots/chat-sidebar-collapsed.png', 'chat-sidebar-collapsed.png'],
  ['packages/vue/screenshots/showcase.png', 'showcase.png'],
  ['packages/vue/screenshots/selection-after.png', 'selection.png'],
  ['packages/vue/screenshots/metrics-roomy.png', 'metrics.png'],
]

function run(command: string, args: string[], cwd: string) {
  console.log(`[screenshots] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`[screenshots] failed: ${command} ${args.join(' ')}`)
    process.exit(1)
  }
}

console.log('[screenshots] rendering visual tests')
run('bun', ['run', 'test', 'showcase'], path.join(ROOT, 'packages', 'vue'))
run('bun', ['run', 'test', 'chat'], path.join(ROOT, 'examples'))
run('bun', ['readme-screenshots.ts'], path.join(ROOT, 'examples'))

fs.mkdirSync(OUT, { recursive: true })
for (const [from, name] of CURATED) {
  const source = path.join(ROOT, from)
  if (!fs.existsSync(source)) {
    console.error(`[screenshots] missing ${from} — did its test run?`)
    process.exit(1)
  }
  const target = path.join(OUT, name)
  // Keep the capture's full colors and gradients. PNG compression and
  // metadata stripping reduce size without quantizing the rendered UI.
  const shrunk = spawnSync(
    'magick',
    [source, '-strip', '-define', 'png:compression-level=9', target],
    { stdio: 'inherit' }
  )
  if (shrunk.status !== 0) {
    console.warn('[screenshots] magick unavailable, copying uncompressed')
    fs.copyFileSync(source, target)
  }
  const kb = Math.round(fs.statSync(target).size / 1024)
  console.log(`[screenshots] ${name} (${kb} KB)`)
}
console.log(`[screenshots] wrote ${CURATED.length} files to docs/images`)
