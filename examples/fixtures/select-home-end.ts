/** Production renderer regression for Select's mounted-item keyboard edges. */
import assert from 'node:assert/strict'
import { defineComponent, h, nextTick } from 'vue'
import { createApp, Select, SelectContent, SelectItem, SelectTrigger, resetApp, type SelectItemState } from '@gpuiv/vue'
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from '@gpuiv/vue/automation'

const changes: string[] = []
const options = [
  ['disabled-first', true], ['first', false], ['middle', false], ['last', false], ['disabled-last', true],
] as const
const App = defineComponent(() => () => h('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: 20 } }, [
  h(Select, { defaultValue: 'middle', onValueChange: (value: string) => changes.push(value) }, { default: () => [
    h(SelectTrigger, { testId: 'trigger', style: { width: 160, height: 36, backgroundColor: '#ffffff' } }, () => h('text', 'Choose')),
    h(SelectContent, { testId: 'popup', style: { width: 160, backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column' } },
      () => options.map(([value, disabled]) => h(SelectItem, { value, disabled, style: { width: 160, height: 32 } }, {
        default: (state: SelectItemState) => h('text', `${state.highlighted ? '*' : ''}${value}`),
      }))),
  ] }),
]))
// Fresh automation waits for ordinary window paints, which hidden Windows
// windows do not deliver. focus:false shows this fixture without activation.
const app = createApp(App, { width: 400, height: 350, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
let exitCode = 0
try {
  const driver = await connectTest(liveRendererAsTest(renderer), async () => { await nextTick(); await Bun.sleep(60) })
  await Bun.sleep(350)
  await driver.getByTestId('trigger').press('home')
  await driver.getByTestId('trigger').press('end')
  assert.deepEqual(renderer.getAllText(), ['Choose'], 'Closed Home/End must not open Select')
  await driver.getByTestId('trigger').click()
  assert(renderer.getAllText().includes('*middle'))
  renderer.simulateKeystrokes!('end')
  await Bun.sleep(100)
  assert(renderer.getAllText().includes('*last'), 'End must skip the disabled trailing item')
  renderer.simulateKeystrokes!('home')
  await Bun.sleep(100)
  assert(renderer.getAllText().includes('*first'), 'Home must skip the disabled leading item')
  assert.deepEqual(changes, [], 'Edge navigation must not commit a value')
  renderer.simulateKeystrokes!('enter')
  await Bun.sleep(100)
  assert.deepEqual(changes, ['first'])
  assert.deepEqual(renderer.getAllText(), ['Choose'], 'Activation must close the menu')
  console.log('SELECT_HOME_END_RESULT', JSON.stringify({ closedIgnored: true, edges: ['last', 'first'], changes, menuClosed: true }))
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  resetApp()
}
process.exit(exitCode)
