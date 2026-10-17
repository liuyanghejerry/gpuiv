/** Production password shaping and real-buffer editing, including Linux. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createApp, resetApp, type EventPayload, type HostNode } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest } from '@gpuiv/vue/automation'

const value = ref('a😀中é'), mode = ref('password')
// Fresh automation waits for ordinary window paints, which hidden Windows
// windows do not deliver. focus:false shows this fixture without activation.
const app = createApp(defineComponent(() => () => h('input', {
  value: value.value, type: mode.value, placeholder: '密码', placeholderColor: '#c4b89e', testId: 'password',
  onChange: (event: EventPayload) => { value.value = event.value ?? '' }, style: { width: 320, height: 40, fontSize: 20 },
})), { width: 400, height: 180, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & { getPaintedText(): string[], readClipboardText(): string | null,
  writeClipboardText(text: string): void }
const find = (node: HostNode): HostNode | undefined => node.props.testId === 'password' ? node : node.children.map(find).find(Boolean)
const originalClipboard = renderer.readClipboardText()
// Production getPaintedText currently reads paint state only on macOS. Linux
// still exercises native Unicode editing and clipboard; mask/IME paint is
// covered by the GPU-backed suite instead of treating an empty query as paint.
const checkPaint = process.platform === 'darwin'
let exitCode = 0
try {
  await Bun.sleep(150)
  const driver = await connectTest(liveRendererAsTest(renderer as any), async () => { await nextTick(); await Bun.sleep(50) })
  const input = driver.getByTestId('password')
  if (checkPaint) {
    assert(renderer.getPaintedText().includes('•••••'), JSON.stringify(renderer.getPaintedText()))
    assert(!renderer.getPaintedText().join('').includes(value.value))
  }
  await input.press('end')
  await input.press('backspace')
  assert.equal(value.value, 'a😀中', 'Deletion must use the real Unicode grapheme buffer')
  if (checkPaint) assert(renderer.getPaintedText().includes('•••'))
  const clipboardBaseline = renderer.readClipboardText()
  const modifier = process.platform === 'darwin' ? 'cmd' : 'ctrl'
  await input.press(`${modifier}-a`)
  await input.press(`${modifier}-c`)
  await input.press(`${modifier}-x`)
  assert.equal(value.value, 'a😀中')
  assert.equal(renderer.readClipboardText(), clipboardBaseline)
  mode.value = 'text'
  await nextTick(); await Bun.sleep(100)
  if (checkPaint) assert(renderer.getPaintedText().includes('a😀中'))
  await input.press('backspace')
  assert.equal(value.value, '', 'Mask toggle must preserve real text selection')
  mode.value = 'password'
  await nextTick(); await Bun.sleep(100)
  if (checkPaint) assert(renderer.getPaintedText().includes('密码'), 'Placeholder must remain readable in password mode')
  assert(renderer.getElementBounds!(find(app.container)!.id!))
  console.log('INPUT_PASSWORD_RESULT', JSON.stringify({ unicode: true, maskPaintChecked: checkPaint,
    cutProtected: true, clipboardReadAvailable: clipboardBaseline !== null, toggleSelection: true }))
} catch (error) { console.error(error); exitCode = 1 }
finally { if (originalClipboard !== null) renderer.writeClipboardText(originalClipboard); resetApp() }
process.exit(exitCode)
