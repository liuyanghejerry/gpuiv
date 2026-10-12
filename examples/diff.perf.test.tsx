import { defineComponent } from 'vue'
import { expect, it } from 'vitest'
import { createTestApp, hasNativeTestRenderer } from '@gpuiv/vue'
import { readFileSync } from 'node:fs'

function patch(lines: number) {
  return `diff --git a/Payment.m b/Payment.m\n--- a/Payment.m\n+++ b/Payment.m\n@@ -1,${lines + 2} +1,${lines + 2} @@\n @implementation Payment\n` +
    Array.from({ length: lines }, (_, i) => `-    [self payOrder:@"old-${i}" completion:nil];\n+    [self payOrder:@"订单😀-${i}" completion:callback];\n`).join('') + ' @end\n'
}

it('keeps highlighted diff scrolling within a frame budget', () => {
  expect(hasNativeTestRenderer).toBe(true)
  const patches = process.env.DIFF_PERF_PATCH
    ? [readFileSync(process.env.DIFF_PERF_PATCH, 'utf8')]
    : [patch(150), patch(4000)]
  for (const source of patches) {
    const start = performance.now()
    const app = createTestApp(defineComponent(() => () =>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <diff patch={source} wordDiff scroll style={{ flexGrow: 1, minHeight: 0 }} />
      </div>), { width: 1440, height: 1000 })
    try {
      const mount = performance.now() - start
      for (let i = 0; i < 8; i++) app.renderer.dispatchScrollWheel(700, 500, 0, -60)
      const samples = []
      for (let i = 0; i < 40; i++) {
        const t = performance.now()
        app.renderer.dispatchScrollWheel(700, 500, 0, i < 20 ? -60 : 60)
        samples.push(performance.now() - t)
      }
      samples.sort((a, b) => a - b)
      console.log(`[diff.perf] bytes=${source.length} mount=${mount.toFixed(1)}ms wheel p50=${samples[20].toFixed(2)}ms p95=${samples[37].toFixed(2)}ms max=${samples[39].toFixed(2)}ms`)
      expect(app.renderer.getPaintedText().length).toBeGreaterThan(0)
      const before = app.renderer.getPaintedText().join('\n')
      app.renderer.dispatchScrollWheel(700, 500, 0, -350)
      expect(app.renderer.getPaintedText().join('\n')).not.toBe(before)
      app.renderer.nativeSimulateMouseDown(180, 300)
      const drag = []
      for (let i = 0; i < 40; i++) {
        const t = performance.now()
        app.renderer.nativeSimulateMouseMove(300 + i * 5, 320 + i * 5, 0)
        drag.push(performance.now() - t)
      }
      app.renderer.nativeSimulateMouseUp(495, 515)
      expect(app.renderer.getSelectedText()?.length).toBeGreaterThan(0)
      drag.sort((a, b) => a - b)
      console.log(`[diff.perf] selection p95=${drag[37].toFixed(2)}ms max=${drag[39].toFixed(2)}ms`)
      if (process.platform === 'darwin') {
        const scale = process.env.CI ? 1.5 : 1
        expect(samples[37]).toBeLessThan(8 * scale)
        // The test mouse helper flushes before and after each move.
        expect(drag[37]).toBeLessThan(16 * scale)
      }
    } finally { app.unmount() }
  }
}, 30000)
