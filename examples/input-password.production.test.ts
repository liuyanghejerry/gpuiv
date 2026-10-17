import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const describeWindow = process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY ? describe : describe.skip
describeWindow('production native password input', () => {
  it('preserves Unicode edits, blocks cut and retains selection across mode changes', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/input-password.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('INPUT_PASSWORD_RESULT '))
    expect(line, result.stdout).toBeDefined()
    expect(JSON.parse(line!.slice('INPUT_PASSWORD_RESULT '.length))).toMatchObject({ unicode: true, cutProtected: true, toggleSelection: true })
  })
})
