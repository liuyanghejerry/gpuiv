import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('production Select Home/End navigation', () => {
  it('ignores closed edges and highlights enabled mounted edges before activation', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/select-home-end.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('SELECT_HOME_END_RESULT '))
    expect(line, result.stdout).toBeDefined()
    expect(JSON.parse(line!.slice('SELECT_HOME_END_RESULT '.length))).toEqual({
      closedIgnored: true, edges: ['last', 'first'], changes: ['first'], menuClosed: true,
    })
  }, 25_000)
})
