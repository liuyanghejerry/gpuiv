import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip

describeWindow('Animal Island production window', () => {
  it('drives Image fades and Avatar fallbacks from real native decode events', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/animal-island-image.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    expect(result.stdout).toContain('ANIMAL_IMAGE_LIFECYCLE_OK')
  }, 25_000)

  it('uses a sidebar and isolated white component card with sibling scroll viewports', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/animal-island-windowing.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('COMPARISON_GALLERY_OK '))
    expect(line, result.stdout).toBeDefined()
    const value = JSON.parse(line!.slice('COMPARISON_GALLERY_OK '.length))
    expect(value.pages).toBe(40)
    expect(value.scrollOwners).toBe(2)
    expect(value.retainedInput).toBe('Compare')
    expect(value.initial.showcase.width - value.resized.showcase.width).toBeCloseTo(280, 1)
  }, 25_000)
})
