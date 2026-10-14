/** Real-window geometry and (macOS/Windows) pixel proof for Tooltip entry. */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import { defineComponent, h, nextTick, type Component } from "vue"
import { createApp, resetApp, type HostNode } from "../../../vue/src/index.js"
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from "../../../vue/src/automation/index.js"
import { Tooltip } from "../../src/components/Tooltip.js"

function readPng(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  let width = 0, height = 0, channels = 0
  const chunks: Buffer[] = []
  for (let cursor = 8; cursor < bytes.length;) {
    const size = bytes.readUInt32BE(cursor), kind = bytes.toString("ascii", cursor + 4, cursor + 8)
    const data = bytes.subarray(cursor + 8, cursor + 8 + size)
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      assert.equal(data[8], 8); assert([2, 6].includes(data[9]!))
      assert.deepEqual([...data.subarray(10, 13)], [0, 0, 0])
      channels = data[9] === 6 ? 4 : 3
    } else if (kind === "IDAT") chunks.push(data)
    cursor += size + 12
  }
  const stride = width * channels, filtered = inflateSync(Buffer.concat(chunks)), pixels = Buffer.alloc(stride * height)
  assert.equal(filtered.length, (stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!
    assert(filter <= 4)
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x, left = x >= channels ? pixels[index - channels]! : 0
      const up = y ? pixels[index - stride]! : 0, upperLeft = y && x >= channels ? pixels[index - stride - channels]! : 0
      const p = left + up - upperLeft, distances = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upperLeft)]
      const paeth = distances[0]! <= distances[1]! && distances[0]! <= distances[2]! ? left : distances[1]! <= distances[2]! ? up : upperLeft
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth][filter]!
      pixels[index] = (filtered[y * (stride + 1) + 1 + x]! + predictor) & 255
    }
  }
  return { width, height, pixel(x: number, y: number) { const index = (y * width + x) * channels; return [...pixels.subarray(index, index + 3)] } }
}
const root = defineComponent(() => () => h("div", { style: { width: "100%", height: "100%", paddingTop: 170, paddingLeft: 240, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 80, backgroundColor: "#224466" } }, [
  ...(["top-start", "right-end"] as const).map((placement, index) => h(Tooltip, { placement, trigger: "click", title: "Tip", testId: `tip-${index}` }, {
    default: () => h("div", { testId: `trigger-${index}`, role: "button", tabIndex: 0, style: { width: 140, height: 40, backgroundColor: "#eeeeee", cursor: "pointer" } }, [h("text", { style: { pointerEvents: "none" } }, "Open")]),
  })),
])) as Component
const app = createApp(root, { width: 700, height: 480, focus: false, show: true })
const renderer = app.renderer as typeof app.renderer & LiveAutomationRenderer
const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
const all = () => walk(app.container)
const folder = mkdtempSync(join(tmpdir(), "gpuiv-tooltip-motion-"))
const results: { placement: string; start: number; middle: number; end: number; pixelChecked: boolean }[] = []
async function until(condition: () => boolean, message: string) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) await Bun.sleep(20)
  assert(condition(), message)
}
try {
  const driver = await connectTest(liveRendererAsTest(renderer), async () => { await nextTick(); await Bun.sleep(40) })
  await until(() => {
    const trigger = all().find(node => node.props.testId === "trigger-0")
    return !!trigger?.id && !!renderer.getElementBounds(trigger.id)?.width
  }, "Trigger must receive a painted native hitbox")
  await driver.clock.pause()
  for (const [index, placement, axis, direction] of [[0, "top-start", "y", -1], [1, "right-end", "x", 1]] as const) {
    await driver.getByTestId(`trigger-${index}`).click()
    await until(() => {
      const body = all().find(node => node.props.testId === `tip-${index}-content`)
      return !!body?.id && !!renderer.getElementBounds(body.id)?.width
    }, "Opened Tooltip must be laid out even at zero opacity")
    await Bun.sleep(80)
    const body = all().find(node => node.props.testId === `tip-${index}-content`)!
    const measure = () => renderer.getElementBounds(body.id!)!
    const start = measure()[axis]
    const pixels: number[][] = []
    function capture(stage: string) {
      if (process.platform === "linux") return
      const path = join(folder, `${index}-${stage}.png`)
      renderer.captureScreenshot(path)
      const image = readPng(readFileSync(path)), viewport = renderer.getWindowSize!()
      const box = measure(), scaleX = image.width / viewport.width, scaleY = image.height / viewport.height
      assert(Math.abs(scaleX - scaleY) < 0.01)
      // Right padding at vertical center is opaque cream and contains no glyph.
      pixels.push(image.pixel(Math.floor((box.x + box.width - 8) * scaleX), Math.floor((box.y + box.height / 2) * scaleY)))
    }
    capture("start")
    await driver.clock.fastForward(125)
    await Bun.sleep(80)
    const middle = measure()[axis]
    capture("middle")
    await driver.clock.fastForward(500)
    await Bun.sleep(80)
    const end = measure()[axis]
    capture("end")
    assert((middle - start) * direction > 0.25 && (end - middle) * direction > 0.05, `Tooltip must move through intermediate native pixels (${start}, ${middle}, ${end})`)
    assert(Math.abs((end - start) * direction - 4) < 0.6, `Tooltip must settle 4px away from the hidden position (${end - start})`)
    if (pixels.length) {
      const distance = (left: number[], right: number[]) => Math.max(...left.map((value, channel) => Math.abs(value - right[channel]!)))
      assert(distance(pixels[0]!, [34, 68, 102]) <= 3, `At t=0 the complete bubble surface must be transparent: ${pixels[0]}`)
      assert(distance(pixels[1]!, [34, 68, 102]) > 20 && distance(pixels[1]!, [247, 243, 223]) > 5, `The surface must fade through intermediate alpha: ${pixels[1]}`)
      assert(distance(pixels[2]!, [247, 243, 223]) <= 3, `Settled surface must be the original cream color: ${pixels[2]}`)
    }
    results.push({ placement, start, middle, end, pixelChecked: pixels.length === 3 })
    await driver.getByTestId(`trigger-${index}`).click()
    await until(() => !all().some(node => node.props.testId === `tip-${index}-content`), "Click close must unmount Tooltip without retaining its old hitbox")
  }
  console.log("REACT_TOOLTIP_MOTION_OK", JSON.stringify(results))
} finally { resetApp(); rmSync(folder, { recursive: true, force: true }) }
process.exit(0)
