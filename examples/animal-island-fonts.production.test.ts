import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AnimalIslandFontsResult } from './fixtures/animal-island-fonts.js'

// Use the real production text system, including Linux display sessions.
// TestGpuixRenderer's headless backend is not available on Linux yet.
const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('Animal Island production fonts', () => {
  it('registers before paint and preserves weighted Latin, CJK and mixed Unicode selection', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/animal-island-fonts.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(value => value.startsWith('ANIMAL_ISLAND_FONTS_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metrics = JSON.parse(line!.slice('ANIMAL_ISLAND_FONTS_RESULT '.length)) as AnimalIslandFontsResult
    expect(metrics.registrations).toBe(6)
    expect(metrics.firstBatchAfterRegistrations).toBe(6)
    expect(metrics.latinWidths).toHaveLength(3)
    expect(metrics.latinWidths[1]).toBeGreaterThan(metrics.latinWidths[0]!)
    expect(metrics.latinWidths[2]).toBeGreaterThan(metrics.latinWidths[1]!)
    expect(metrics.mixedCombiningCodePoint).toBe(0x0301)
    expect(metrics.selections).toEqual({
      'cjk-fallback': '小岛标题图片加载失败',
      'cjk-direct': '小岛标题图片加载失败',
      mixed: 'Animal 小岛 🐾 e\u0301',
    })
    // Bounds/selection validate fallback behavior; the public API cannot
    // identify the font face chosen for each Chinese or emoji glyph.
    expect(metrics.resolvedFallbackFaceExposed).toBe(false)
  }, 25_000)
})
