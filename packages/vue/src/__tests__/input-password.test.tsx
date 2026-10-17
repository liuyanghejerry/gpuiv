/** Native password shaping, model editing and UTF-16 geometry. */
// @ts-nocheck
import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createTestApp, hasNativeTestRenderer } from '../testing.js'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('native password input', () => {
  it('paints bullets while editing and events retain real Unicode text', async () => {
    const value = ref('a😀中é')
    const app = createTestApp(defineComponent(() => () => <input testId="password" type="password" value={value.value}
      onChange={event => { value.value = event.value }} style={{ width: 300, height: 40, fontSize: 20 }} />))
    try {
      const id = app.renderer.findByTestId('password')!.id
      expect(app.renderer.getPaintedText()).toContain('•••••')
      expect(app.renderer.getPaintedText()).not.toContain(value.value)
      app.renderer.nativeSimulateKeystrokes(id, 'end')
      app.renderer.nativeSimulateKeystrokes(id, 'backspace')
      await app.settle()
      // Grapheme deletion removes e + combining acute from the real buffer.
      expect(value.value).toBe('a😀中')
      expect(app.renderer.getPaintedText()).toContain('•••')
      const a11y = JSON.stringify(app.renderer.getA11yTree())
      expect(a11y).not.toContain('a😀中')
    } finally { app.unmount() }
  })

  it('maps painted mask geometry to real UTF-16 offsets around a surrogate pair', () => {
    const app = createTestApp(defineComponent(() => () => <input testId="password" type="password" value="a😀中"
      style={{ width: 300, height: 40, fontSize: 20, lineHeight: 24 }} />))
    try {
      const id = app.renderer.findByTestId('password')!.id
      const points = [0, 1, 3, 4].map(offset => app.renderer.getInputTextPosition(id, offset))
      expect(points.every(point => point.length === 2)).toBe(true)
      expect(points[1][0]).toBeGreaterThan(points[0][0])
      expect(points[2][0]).toBeGreaterThan(points[1][0])
      expect(points[3][0]).toBeGreaterThan(points[2][0])
      for (const [index, offset] of [0, 1, 3, 4].entries()) {
        expect(app.renderer.getInputTextOffset(id, points[index][0], points[index][1] + 10)).toBe(offset)
      }
    } finally { app.unmount() }
  })

  it('keeps IME marking, commit, candidate geometry and selection in real text coordinates', async () => {
    const value = ref('😀')
    const events: unknown[] = []
    const app = createTestApp(defineComponent(() => () => <input testId="password" type="password" value={value.value}
      onChange={event => { value.value = event.value }}
      onCompositionStart={event => events.push(['start', event.value])}
      onCompositionUpdate={event => events.push(['update', event.value])}
      onCompositionEnd={event => events.push(['end', event.value])}
      style={{ width: 300, height: 40 }} />))
    try {
      const id = app.renderer.findByTestId('password')!.id
      app.renderer.simulateMarkedText(id, 'ni', 0, 2)
      await app.settle()
      expect(value.value).toBe('😀ni')
      expect(app.renderer.getPaintedText()).toContain('•••')
      expect(app.renderer.getPaintedInputRuns(id).filter(run => run.underline).map(run => run.text).join('')).toBe('••')
      const afterEmoji = app.renderer.getInputTextPosition(id, 2)
      const atEnd = app.renderer.getInputTextPosition(id, 4)
      expect(atEnd[0]).toBeGreaterThan(afterEmoji[0])
      app.renderer.simulateImeCommit(id, '你')
      await app.settle()
      expect(value.value).toBe('😀你')
      expect(events).toEqual([['start', ''], ['update', 'ni'], ['end', '你']])
      expect(app.renderer.getPaintedText()).toContain('••')
    } finally { app.unmount() }
  })

  it('uses placeholder ink without masking it and preserves selection when toggled', async () => {
    const value = ref('')
    const mode = ref('password')
    const app = createTestApp(defineComponent(() => () => <input testId="password" type={mode.value} value={value.value}
      placeholder="密码" placeholderColor="#c4b89e" selection={value.value ? [1, 3] : undefined}
      style={{ width: 300, height: 40 }} />))
    try {
      const id = app.renderer.findByTestId('password')!.id
      expect(app.renderer.getPaintedText()).toContain('密码')
      value.value = 'a😀中'
      await app.settle()
      expect(app.renderer.getPaintedText()).toContain('•••')
      mode.value = 'text'
      await app.settle()
      expect(app.renderer.getPaintedText()).toContain('a😀中')
      app.renderer.nativeSimulateKeystrokes(id, 'backspace')
      await app.settle()
      // The selection [1,3] still selects the real emoji, not bullet bytes.
      expect(app.renderer.getPaintedText()).toContain('a中')
    } finally { app.unmount() }
  })

  it('does not export password selections through copy/cut', async () => {
    const value = ref('secret😀')
    const app = createTestApp(defineComponent(() => () => <input testId="password" type="password" value={value.value}
      onChange={event => { value.value = event.value }} style={{ width: 300, height: 40 }} />))
    try {
      const id = app.renderer.findByTestId('password')!.id
      app.renderer.writeClipboardText('unchanged')
      const modifier = process.platform === 'darwin' ? 'cmd' : 'ctrl'
      app.renderer.nativeSimulateKeystrokes(id, `${modifier}-a ${modifier}-c`)
      await app.settle()
      expect(app.renderer.readClipboardText()).toBe('unchanged')
      app.renderer.nativeSimulateKeystrokes(id, `${modifier}-x`)
      await app.settle()
      expect(value.value).toBe('secret😀')
      expect(app.renderer.readClipboardText()).toBe('unchanged')
    } finally { app.unmount() }
  })
})
