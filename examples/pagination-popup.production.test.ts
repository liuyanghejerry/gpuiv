import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('production Animal Pagination popup', () => {
  it('stays above its trigger through scrolling and resizing, fits the viewport, and selects a page size', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/pagination-popup.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('PAGINATION_POPUP_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metric = JSON.parse(line!.slice('PAGINATION_POPUP_RESULT '.length))
    expect(metric.scrolling).toHaveLength(2)
    expect(metric.resized.label).toBe('resized')
    expect(metric.fitted.label).toBe('viewport-fit')
    expect(metric.changes).toEqual([[1, 20]])
    expect(metric.sizeChanges).toEqual([[1, 20]])
    expect(metric.menuClosed).toBe(true)
  }, 25_000)
})
