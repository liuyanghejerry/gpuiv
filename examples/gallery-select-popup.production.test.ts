import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('production gallery destination Select', () => {
  it('opens above the actual gallery trigger, follows scrolling, and selects 森林', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/gallery-select-popup.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('GALLERY_SELECT_POPUP_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metric = JSON.parse(line!.slice('GALLERY_SELECT_POPUP_RESULT '.length))
    expect(metric.scrollOwners).toBe(1)
    expect(metric.initial.label).toBe('initial')
    expect(metric.scrolled.label).toBe('scrolled')
    expect(metric.selectedLabel).toContain('森林')
    expect(metric.menuClosed).toBe(true)
  }, 25_000)
})
