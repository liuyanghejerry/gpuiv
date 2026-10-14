/** Validate that the numeric strip actually moves in GPUI, not just in props. */
import assert from "node:assert/strict"
import { defineComponent, h, nextTick, ref } from "vue"
import { createApp, resetApp, type HostNode } from "../../../vue/src/index.js"
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from "../../../vue/src/automation/index.js"
import { Countdown } from "../../src/components/Countdown.js"
import { Avatar } from "../../src/components/Avatar.js"

const finishAt = ref(Date.now() + 10000)
const app = createApp(defineComponent(() => () => h("div", { style: { width: "100%", height: "100%", padding: 40 } }, [
  h(Countdown, { value: finishAt.value, format: "ss", testId: "countdown" }),
  h(Avatar, { size: 40, gap: 4, testId: "avatar" }, { default: () => h("text", "Animal Island") }),
])), { width: 500, height: 240, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
const all = () => walk(app.container)
async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) await Bun.sleep(20)
  assert(condition(), message)
}
try {
  const driver = await connectTest(liveRendererAsTest(renderer), async () => { await nextTick(); await Bun.sleep(40) })
  await until(() => {
    const avatar = all().find(node => node.props.testId === "avatar")
    const fitted = avatar?.children.find(node => (node.props.style as { flexShrink?: number; opacity?: number } | undefined)?.flexShrink === 0 && (node.props.style as { opacity?: number })?.opacity !== 0)
    const fittedWidth = fitted?.id == null ? undefined : renderer.getElementBounds(fitted.id)?.width
    return ((fitted?.props.style as { fontSize?: number } | undefined)?.fontSize ?? 16) < 16 && fittedWidth != null && fittedWidth > 0 && fittedWidth <= 33
  }, "Avatar must fit the real unshrunk native text width")
  const avatar = all().find(node => node.props.testId === "avatar")!
  const measure = avatar.children.find(node => (node.props.style as { opacity?: number } | undefined)?.opacity === 0)!
  const visible = avatar.children.find(node => (node.props.style as { flexShrink?: number; opacity?: number } | undefined)?.flexShrink === 0 && (node.props.style as { opacity?: number })?.opacity !== 0)!
  const naturalWidth = renderer.getElementBounds(measure.id!)!.width
  const visibleWidth = renderer.getElementBounds(visible.id!)!.width
  assert(naturalWidth > 32, "The measurement must retain the text's natural width outside the avatar layout")
  assert(visibleWidth <= 33, `The fitted native text must fit the avatar gap (${visibleWidth})`)
  finishAt.value = Date.now() + 1800
  await nextTick()
  await until(() => all().find(node => node.props.testId === "countdown")?.props["aria-valuetext"] === "01", "Countdown must reach the final second")
  const digit = all().find(node => (node.props.motion as { animate?: { top?: number } } | undefined)?.animate?.top === -31)
  assert(digit?.id != null, "The changing digit must have an actual native motion strip")
  await driver.clock.pause()
  await driver.clock.fastForward(500)
  await Bun.sleep(80)
  const before = renderer.getElementBounds(digit.id!)!.y
  await until(() => all().find(node => node.props.testId === "countdown")?.props["aria-valuetext"] === "00", "Countdown must finish")
  await Bun.sleep(80)
  const start = renderer.getElementBounds(digit.id!)!.y
  assert(Math.abs(start - before) < 1, `A frozen native clock must retain the first numeric face (${start} vs ${before})`)
  await driver.clock.fastForward(175)
  await Bun.sleep(80)
  const middle = renderer.getElementBounds(digit.id!)!.y
  assert(middle > start + 1 && middle < start + 30, `The native numeric strip must move through intermediate pixels (${middle} vs ${start})`)
  await driver.clock.fastForward(500)
  await Bun.sleep(80)
  const end = renderer.getElementBounds(digit.id!)!.y
  assert(Math.abs(end - start - 31) < 1, `The native numeric strip must settle exactly one digit below (${end - start})`)
  console.log("REACT_COUNTDOWN_MOTION_OK", JSON.stringify({ start, middle, end, naturalWidth, visibleWidth }))
} finally { resetApp() }
process.exit(0)
