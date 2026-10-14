import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip
describeWindow('Animal Island decoded image geometry', () => {
  it('preserves intrinsic ratios and actual leaf sizes for single-axis pixel frames', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/animal-island-image-intrinsic.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('ANIMAL_IMAGE_INTRINSIC_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const resultBody = JSON.parse(line!.slice('ANIMAL_IMAGE_INTRINSIC_RESULT '.length)) as { replacementHeight: number; errorHeight: number }
    expect(resultBody.replacementHeight).toBe(120)
    expect(resultBody.errorHeight).toBeLessThan(100)
  }, 25_000)
})
