/** Finite, background-window audit of the gallery. Run from examples/:
 * NODE_ENV=production bun profile-beautiful-ui.ts
 * MOUNT_ONLY=1 NODE_ENV=production bun --cpu-prof --cpu-prof-dir=../tmp/cpu-profiles profile-beautiful-ui.ts
 * Draw FPS counts completed GPUI draws; it is not a compositor presentation counter.
 */
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { nextTick } from "vue"
import { createApp } from "@gpuiv/vue"
import { connectTest, liveRendererAsTest, type LiveAutomationRenderer } from "@gpuiv/vue/automation"
import { createTestApp } from "@gpuiv/vue/testing"
import { App } from "./beautiful-ui"

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const output = resolve(import.meta.dirname, "../tmp/beautiful-ui-perf")
mkdirSync(output, { recursive: true })
if (process.env.MOUNT_ONLY === "1") {
  const started = performance.now()
  const app = createTestApp(App, { width: 960, height: 760 })
  console.log(JSON.stringify({ label: "mount", mountMs: performance.now() - started }))
  app.unmount()
  process.exit(0)
}

const app = createApp(App, { title: "Beautiful UI performance audit", width: 960, height: 760, focus: false })
const renderer = app.renderer
// Tick and let the Vue scheduler commit between synthetic input events.
const automation = await connectTest(liveRendererAsTest(renderer as unknown as LiveAutomationRenderer), async () => {
  await nextTick()
  await sleep(20)
})
const results: unknown[] = []
try {
  await sleep(2000)
  const scrollId = (await automation.getByTestId("gallery-scroll").element()).id
  const applyBatch = renderer.applyBatch.bind(renderer)
  let commits = 0
  renderer.applyBatch = json => { commits++; return applyBatch(json) }
  async function measure(label: string, action = () => sleep(3000)) {
    const firstFrame = renderer.getDebugFrameOverlayStats!().frames
    renderer.resetDebugFrameOverlayStats!()
    const firstCommit = commits
    const start = performance.now()
    const cpu = process.cpuUsage()
    await action()
    const durationMs = performance.now() - start
    const draw = renderer.getDebugFrameOverlayStats!()
    const used = process.cpuUsage(cpu)
    const result = {
      label, durationMs,
      drawsPerSecond: (draw.frames - firstFrame) * 1000 / durationMs,
      commitsPerSecond: (commits - firstCommit) * 1000 / durationMs,
      cpuPercentOfOneCore: (used.user + used.system) / durationMs / 10,
      draw, offset: renderer.getScrollOffset!(scrollId),
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }
  async function wheel(direction: number) {
    for (let i = 0; i < 180; i++) {
      await automation.mouse.wheel({ x: 700, y: 400 }, 0, direction * 70)
      await sleep(16)
    }
  }
  await measure("top-animation")
  await automation.screenshot({ path: resolve(output, "top.png") })
  await measure("scroll-down", () => wheel(-1))
  await sleep(800)
  await measure("bottom-animation")
  await measure("scroll-up", () => wheel(1))
  await measure("top-after-roundtrip")
  // Measure the pixel loader's cadence separately from other gallery motion.
  const loading = await automation.getByTestId("section-body-LoadingState").bounds()
  renderer.scrollTo!(scrollId, 0, -(loading.y - 140))
  await sleep(1500)
  await measure("loading-animation")
  await automation.screenshot({ path: resolve(output, "loading.png") })
  await Bun.write(resolve(output, "results.json"), JSON.stringify({
    platform: process.platform, arch: process.arch, nodeEnv: process.env.NODE_ENV,
    window: { width: 960, height: 760 }, results,
  }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  app.unmount()
  process.exit(process.exitCode ?? 0)
}
