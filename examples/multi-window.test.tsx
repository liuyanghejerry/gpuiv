/**
 * Multi-window e2e: a real child process serving automation on stdin, with a
 * second native window opened through `createWindow`.
 *
 * The automation bus only reaches the main renderer (one stdin per process),
 * so the second window is asserted through the main window's shared state:
 * it opens, mounts its own Vue tree, and its clicks update main-window refs
 * without leaking into the main window's element tree.
 *
 * Windows CI runners cannot host the live child's stdio handshake reliably,
 * and multi-window itself is macOS-only for now, so this runs on macOS.
 */
import { describe, expect, it } from 'vitest'
import { launch } from '@gpuiv/vue/automation'
import path from 'path'
import { fileURLToPath } from 'url'

describe.skipIf(process.platform !== 'darwin')('multi-window (live)', () => {
  it('opens a second window with isolated state', async () => {
    const app = await launch({
      command: 'bun',
      args: ['multi-window.tsx'],
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: { GPUIX_BACKGROUND: '1', VITEST: '' },
    })

    try {
      const status = app.getByTestId('second-status')
      await status.waitFor({ timeoutMs: 30_000 })
      expect(await status.textContent()).toContain('closed')

      await app.getByTestId('open-second').click()

      // The second window mounted its own tree and flipped the shared ref.
      const deadline = Date.now() + 10_000
      let opened = ''
      while (Date.now() < deadline) {
        opened = await status.textContent()
        if (opened.includes('open')) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(opened).toContain('open')

      // The main window kept its own content: the second window's element
      // ids (which restart from 1 in their own renderer) did not take over
      // the automation tree.
      expect(await app.getByTestId('poke-count').textContent()).toContain('pokes: 0')

      const screenshot = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'screenshots',
        'multi-window-main.png'
      )
      await app.screenshot({ path: screenshot })
      expect((await import('fs')).statSync(screenshot).size).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  }, 60_000)
})
