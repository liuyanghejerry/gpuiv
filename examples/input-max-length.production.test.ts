import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip
describeWindow('production Input length correction', () => {
  it('keeps emoji valid and applies coalesced revisions to the actual editor', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/input-max-length.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('INPUT_MAX_LENGTH_RESULT '))
    expect(line, result.stdout).toBeDefined()
    expect(JSON.parse(line!.slice('INPUT_MAX_LENGTH_RESULT '.length))).toEqual({ surrogateSafe: true, nativeLimit: true, coalescedRevision: true })
  })
})
