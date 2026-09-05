/// GPU-backed tests for <img> sources: filesystem paths and data URLs must
/// decode to the same pixels, and the shared data-URL decoder now also
/// accepts base64 SVG sources for <svg>.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { bufferSimilarity, SHOTS_DIR } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const IMAGE_FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/images/code.png"
)

const SVG_FIXTURE = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">',
  '<rect x="1" y="1" width="14" height="14" rx="3" fill="#000"/>',
  "</svg>",
].join("")
const SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SVG_FIXTURE).toString("base64")}`

describeNative("custom element: img (vue)", () => {
  it("renders base64 data URLs like filesystem images", () => {
    const App = defineComponent({
      props: { src: { type: String, required: true } },
      setup(props) {
        return () => <img src={props.src} style={{ width: 240, height: 140 }} />
      },
    })

    const pathImage = path.join(SHOTS_DIR, "gpuiv-img-path.png")
    const dataImage = path.join(SHOTS_DIR, "gpuiv-img-data-url.png")
    if (fs.existsSync(pathImage)) fs.unlinkSync(pathImage)
    if (fs.existsSync(dataImage)) fs.unlinkSync(dataImage)

    const fromPath = createTestApp(defineComponent({
      setup: () => () => <App src={IMAGE_FIXTURE_PATH} />,
    }))
    fromPath.renderer.captureScreenshot(pathImage)
    fromPath.unmount()

    const fromData = createTestApp(defineComponent({
      setup: () => () => (
        <App src={`data:image/png;base64,${fs.readFileSync(IMAGE_FIXTURE_PATH).toString("base64")}`} />
      ),
    }))
    fromData.renderer.captureScreenshot(dataImage)
    fromData.unmount()

    expect(fs.statSync(pathImage).size).toBeGreaterThan(0)
    expect(fs.statSync(dataImage).size).toBeGreaterThan(0)
    // Same decoded pixels both ways. Skipped on CI like every pixel compare.
    if (!process.env.CI) {
      expect(
        bufferSimilarity(fs.readFileSync(pathImage), fs.readFileSync(dataImage))
      ).toBeGreaterThan(0.99)
    }
  })

  it("accepts base64 SVG data URLs on <svg>", () => {
    const app = createTestApp(defineComponent({
      setup: () => () => <svg src={SVG_DATA_URL} style={{ width: 16, height: 16 }} />,
    }))
    expect(app.renderer.findByType("svg")).toHaveLength(1)
    app.unmount()
  })

  it("falls back to a painted message for a malformed data URL", () => {
    const app = createTestApp(defineComponent({
      setup: () => () => <img src="data:image/png;base64,not-base64!" style={{ width: 100, height: 40 }} />,
    }))
    expect(app.renderer.getPaintedText()).toContain("img: load failed")
    app.unmount()
  })

  it("keeps the no-src fallback testable", () => {
    const app = createTestApp(defineComponent({
      setup: () => () => <img src="" style={{ width: 100, height: 40 }} />,
    }))
    expect(app.renderer.getPaintedText()).toContain("img: no src")
    app.unmount()
  })
})
