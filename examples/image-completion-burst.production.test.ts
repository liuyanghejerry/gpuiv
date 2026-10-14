import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip
describeWindow('production image completion batching', () => {
  it('coalesces simultaneous resource notifications into a few frames', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/image-completion-burst.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('IMAGE_COMPLETION_BURST_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metric = JSON.parse(line!.slice('IMAGE_COMPLETION_BURST_RESULT '.length))
    expect(metric).toMatchObject({ count: 48, loads: 48, errors: 0 })
    expect(metric.frames).toBeLessThan(24)
  })
})
