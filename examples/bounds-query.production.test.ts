import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Exercise GpuixRenderer's real UI thread, independently of the headless
// TestGpuixRenderer. Linux CI can run this under an X11/Wayland session.
const linuxDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
const describeWindow = linuxDisplay ? describe : describe.skip

describeWindow('production bounds polling', () => {
  it('reads snapshots without repainting and keeps automation freshness', () => {
    const result = spawnSync(process.env.BUN_EXECUTABLE ?? 'bun', [fileURLToPath(new URL('./fixtures/bounds-query.ts', import.meta.url))], {
      cwd: import.meta.dirname, env: { ...process.env, GPUIX_BACKGROUND: '1' },
      encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, result.stderr || result.error?.message).toBe(0)
    const line = result.stdout.split('\n').find(line => line.startsWith('BOUNDS_QUERY_RESULT '))
    expect(line, result.stdout).toBeDefined()
    const metric = JSON.parse(line!.slice('BOUNDS_QUERY_RESULT '.length))
    expect(metric.queries).toBe(120)
    expect(metric.framesAfter).toBe(metric.framesBefore)
    expect(metric.initial.y).toBe(120)
    expect(metric.moved.y).toBe(220)
  })
})
