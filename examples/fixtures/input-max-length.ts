/** Real native text edits and coalesced valueRevision correction contract. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createApp, resetApp, type EventPayload } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest } from '@gpuiv/vue/automation'
import { Input } from '@gpuiv/animal-island'

const value = ref(''), maxLength = ref(1)
const correctedValue = ref(''), revision = ref(0)
const nativeValues: string[] = [], errors: unknown[] = []
// Fresh automation waits for ordinary window paints, which hidden Windows
// windows do not deliver. focus:false shows this fixture without activation.
const app = createApp(defineComponent(() => () => h('div', { style: { width: 320, display: 'flex', flexDirection: 'column', gap: 20 } }, [
  h(Input, { testId: 'limited', modelValue: value.value, maxLength: maxLength.value,
    'onUpdate:modelValue': (next: string) => { value.value = next } }),
  h('input', { testId: 'revision', value: correctedValue.value, valueRevision: revision.value,
    onChange: (event: EventPayload) => { nativeValues.push(event.value ?? '') }, style: { width: 300, height: 40 } }),
])), { width: 400, height: 200, focus: false, show: true, errorOverlay: false,
  onRuntimeError: (error: unknown) => { errors.push(error) } })
const settle = async () => { await nextTick(); await Bun.sleep(60) }
let exitCode = 0
try {
  await Bun.sleep(120)
  const driver = await connectTest(liveRendererAsTest(app.renderer as any), settle)
  const limited = driver.getByTestId('limited').getByType('input')
  await limited.fill('🌴')
  assert.equal(value.value, '', 'A UTF-16 limit of 1 cannot keep half an emoji')
  assert.equal(errors.length, 0, 'Length correction must remain valid Rust JSON')
  await limited.press('Z')
  assert.equal(value.value, 'Z', 'The native editor must have accepted the empty correction')
  maxLength.value = 2
  await settle()
  await limited.fill('🌴')
  assert.equal(value.value, '🌴')
  await limited.press('B')
  assert.equal(value.value, '🌴')
  await limited.press('backspace')
  assert.equal(value.value, '', 'Backspace must delete the corrected native emoji, not an overflow character')

  // Keep native edits unacknowledged, then change value and revision together
  // in one Vue render. "A" is an earlier pending echo of the true "A🌴"
  // buffer, so the explicit revision must take priority over echo suppression.
  const contract = driver.getByTestId('revision')
  await contract.press('A 🌴')
  assert.equal(nativeValues[nativeValues.length - 1], 'A🌴')
  correctedValue.value = 'A'
  revision.value++
  await settle()
  await contract.press('backspace')
  assert.equal(nativeValues[nativeValues.length - 1], '', 'valueRevision must correct the actual editor before Backspace')
  assert.equal(errors.length, 0)
  console.log('INPUT_MAX_LENGTH_RESULT', JSON.stringify({ surrogateSafe: true, nativeLimit: true, coalescedRevision: true }))
} catch (error) { console.error(error); exitCode = 1 }
finally { resetApp() }
process.exit(exitCode)
