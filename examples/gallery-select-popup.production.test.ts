import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('production gallery destination Select', () => {
  it('navigates to Select, opens above its trigger, follows content scrolling, and selects from blank option padding', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/gallery-select-popup.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('GALLERY_SELECT_POPUP_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metric = JSON.parse(line!.slice('GALLERY_SELECT_POPUP_RESULT '.length))
    expect(metric.scrollOwners).toBe(2)
    expect(metric.nestedScrolling).toBe(false)
    expect(metric.selectedPage).toBe('select')
    expect(metric.initial.label).toBe('initial')
    expect(metric.scrolled.label).toBe('scrolled')
    expect(metric.selectedLabel).toContain('森林')
    expect(metric.blankClicks.map((click: { key: string; side: string }) => [click.key, click.side])).toEqual([
      ['forest', 'left'], ['beach', 'right'], ['island', 'left'],
    ])
    expect(metric.blankClicks.map((click: { label: string }) => click.label)).toEqual(['森林', '海滩', '小岛'])
    expect(metric.menuClosed).toBe(true)
  }, 25_000)
})
