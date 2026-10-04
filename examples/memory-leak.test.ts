import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const output = resolve(import.meta.dirname, '../tmp/memory-leak-gate')
mkdirSync(output, { recursive: true })
const run = promisify(execFile)
const scenarios = ['loaders', 'gallery', 'overlays', 'native'] as const
async function worker(scenario: string, fault?: string) {
  const name = scenario + (fault ? '-' + fault : '')
  rmSync(resolve(output, `${name}.json`), { force: true })
  let code = 0, stdout = '', stderr = ''
  try {
    const result = await run('bun', ['memory-leak-worker.tsx', scenario], {
      cwd: import.meta.dirname, timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'production', GPUIX_BACKGROUND: '1', GPUIV_MEMORY_FAULT: fault ?? '' },
    })
    stdout = result.stdout; stderr = result.stderr
  } catch (error: any) {
    code = typeof error.code === 'number' ? error.code : -1
    stdout = error.stdout ?? ''; stderr = error.stderr ?? String(error)
  }
  writeFileSync(resolve(output, `${name}.log`), stdout + stderr)
  let report: any
  try { report = JSON.parse(readFileSync(resolve(output, `${name}.json`), 'utf8')) }
  catch { throw new Error(`Memory worker ${name} did not produce a report (exit ${code}):\n${stderr}`) }
  return { code, stderr, report }
}
describe('memory leak gate', () => {
  for (const scenario of scenarios) it(`reclaims ${scenario} resources on the same renderer`, async () => {
    const { code, stderr, report } = await worker(scenario)
    expect(code, stderr).toBe(0)
    expect(report.status).toBe('passed')
    expect(report.completedCycles).toBe(30)
    expect(report.resources).toHaveLength(30)
    expect(report.samples).toHaveLength(4)
    expect(report.byteBudgetsEnforced).toBe(false)
  }, 250_000)

  for (const fault of ['timer', 'node', 'handler']) it(`rejects an intentionally retained ${fault}`, async () => {
    const { code, report } = await worker('loaders', fault)
    expect(code).toBe(1)
    expect(report.status).toBe('failed')
    expect(report.error).toMatch(/retained resources|timers survived/)
  }, 30_000)
})
afterAll(() => {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const rows = scenarios.map(scenario => {
    try {
      const report = JSON.parse(readFileSync(resolve(output, `${scenario}.json`), 'utf8'))
      const mib = (n: number) => (n / 1024 / 1024).toFixed(2)
      return `| ${scenario} | ${report.completedCycles}/30 | ${report.status} | ${report.growth ? mib(report.growth.heapBytes) : '—'} | ${report.growth ? mib(report.growth.rssBytes) : '—'} |`
    } catch { return `| ${scenario} | — | Missing report | — | — |` }
  })
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '### Memory resource gate', '', '| Scenario | Cycles | Resource checks | JS heap Δ (MiB) | RSS Δ (MiB) |',
    '| --- | ---: | --- | ---: | ---: |', ...rows, '',
    'Resource ownership and GPUI entity leaks are enforced. Heap/RSS byte growth is observation-only until hosted-runner calibration. Three deliberate retention faults must also fail.', '',
  ].join('\n'))
})
