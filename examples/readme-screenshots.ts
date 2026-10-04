/** Capture real example components with the offscreen GPU test renderer. */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createTestApp, hasNativeTestRenderer, type TestApp } from "@gpuiv/vue/testing"
import { connectTest } from "@gpuiv/vue/automation"
import { ChatApp } from "./chat"
import { App as Gallery } from "./beautiful-ui"
import { App as Editor } from "./markdown-editor"
import { App as Blends } from "./canvas-blends"

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "screenshots")

if (!hasNativeTestRenderer) {
  throw new Error("README screenshots require a release native build with the GPU test renderer (macOS or Windows).")
}
fs.mkdirSync(OUT, { recursive: true })

async function capture(name: string, app: TestApp, prepare?: (app: TestApp) => Promise<void>) {
  try {
    await app.settle()
    await prepare?.(app)
    await app.settle()
    app.renderer.captureScreenshot(path.join(OUT, `${name}.png`))
    console.log(`[readme-demos] ${name}`)
  } finally {
    app.unmount()
  }
}

await capture("readme-chat", createTestApp(ChatApp, { width: 1280, height: 800 }), async (app) => {
  const list = app.renderer.findByType("virtual-list")[0]
  if (!list) throw new Error("The chat demo's virtual list did not mount.")
  // Show a real patch from the demo, with the sidebar and composer in view.
  app.renderer.scrollToItem(list.id, 10)
  await app.settle()
})
await capture("readme-editor", createTestApp(Editor, { width: 1080, height: 800 }))
await capture("readme-gallery", createTestApp(Gallery, { width: 800, height: 900 }), async (app) => {
  const automation = await connectTest(app.renderer, app.settle)
  await automation.clock.pause()
  await automation.clock.fastForward(1000)
})
await capture("readme-canvas", createTestApp(Blends, { width: 580, height: 520 }))
