import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip
describeWindow('production native image events', () => {
  it('decodes sources once, rejects stale work and refreshes shared windows', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/image-events.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('IMAGE_EVENTS_RESULT '))
    expect(line, result.stdout).toBeDefined()
    expect(JSON.parse(line!.slice('IMAGE_EVENTS_RESULT '.length))).toMatchObject({ loads: 7, errors: 5, stale: 0, sharedRequests: 1 })
  })
})
