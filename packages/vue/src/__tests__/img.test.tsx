/// GPU-backed tests for <img> sources: filesystem paths, data URLs, and
/// http(s) URLs must decode to the same pixels, and the shared data-URL
/// decoder now also accepts base64 SVG sources for <svg>.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, type TestRenderer } from "../testing.js"
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

// Same SVG the native test renderer's FakeHttpClient serves, so an http src
// and the disk fixture decode to identical pixels.
const HTTP_FIXTURE_PATH = path.join(SHOTS_DIR, "gpuiv-img-fixture.svg")
const HTTP_SVG_FIXTURE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">',
  '<rect x="0" y="0" width="240" height="140" fill="#1e2d59"/>',
  '<rect x="16" y="16" width="208" height="108" rx="14" fill="#5ca9ff"/>',
  '<circle cx="68" cy="70" r="24" fill="#ffd166"/>',
  '<rect x="112" y="50" width="88" height="14" rx="7" fill="#20304f"/>',
  '<rect x="112" y="74" width="70" height="12" rx="6" fill="#2a3c61"/>',
  "</svg>",
].join("")

function writeSvgFixture(filePath: string): void {
  fs.writeFileSync(filePath, HTTP_SVG_FIXTURE, "utf8")
}

function imgBounds(renderer: TestRenderer, testId: string) {
  const element = renderer.findByTestId(testId)
  expect(element, `missing testId ${testId}`).toBeDefined()
  const rect = renderer.getElementBounds(element!.id)
  expect(rect, `no painted bounds for ${testId}`).toEqual(expect.any(Array))
  return { x: rect![0], y: rect![1], width: rect![2], height: rect![3] }
}

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

  it("keeps a sized http src box stable across load", () => {
    const App = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 400, height: 240, padding: 16 }}>
            <img
              testId="remote"
              src="https://example.test/gpuiv-img.svg"
              objectFit="cover"
              style={{ width: 220, height: 120 }}
            />
          </div>
        )
      },
    })
    const app = createTestApp(App)

    const first = imgBounds(app.renderer, "remote")
    expect(first.width).toBeCloseTo(220, 0)
    expect(first.height).toBeCloseTo(120, 0)

    app.renderer.flush()
    app.renderer.flush()
    app.renderer.flush()

    const after = imgBounds(app.renderer, "remote")
    expect(after.width).toBeCloseTo(220, 0)
    expect(after.height).toBeCloseTo(120, 0)
    expect(after.x).toBeCloseTo(first.x, 0)
    expect(after.y).toBeCloseTo(first.y, 0)
    app.unmount()
  })

  it("forwards borderRadius through style", () => {
    const app = createTestApp(defineComponent({
      setup: () => () => (
        <img
          src={IMAGE_FIXTURE_PATH}
          objectFit="cover"
          style={{ width: 80, height: 80, borderRadius: 40 }}
        />
      ),
    }))
    const images = app.renderer.findByType("img")
    expect(images.length).toBe(1)
    expect(images[0].style?.borderRadius).toBe(40)
    app.unmount()
  })

  it("clips pixels to borderRadius", () => {
    const square = path.join(SHOTS_DIR, "gpuiv-img-square.png")
    const circle = path.join(SHOTS_DIR, "gpuiv-img-circle.png")
    if (fs.existsSync(square)) fs.unlinkSync(square)
    if (fs.existsSync(circle)) fs.unlinkSync(circle)

    const plain = createTestApp(defineComponent({
      setup: () => () => (
        <div style={{ width: 160, height: 160, backgroundColor: "#00ff00", padding: 20 }}>
          <img src={IMAGE_FIXTURE_PATH} objectFit="cover" style={{ width: 120, height: 120 }} />
        </div>
      ),
    }))
    plain.renderer.flush()
    plain.renderer.captureScreenshot(square)
    plain.unmount()

    const rounded = createTestApp(defineComponent({
      setup: () => () => (
        <div style={{ width: 160, height: 160, backgroundColor: "#00ff00", padding: 20 }}>
          <img
            src={IMAGE_FIXTURE_PATH}
            objectFit="cover"
            style={{ width: 120, height: 120, borderRadius: 60 }}
          />
        </div>
      ),
    }))
    rounded.renderer.flush()
    rounded.renderer.captureScreenshot(circle)
    rounded.unmount()

    // Skipped on CI like every pixel compare.
    if (!process.env.CI) {
      expect(
        bufferSimilarity(fs.readFileSync(square), fs.readFileSync(circle))
      ).toBeLessThan(0.99)
    }
  })

  it("renders http URLs like filesystem images when width and height are set", () => {
    writeSvgFixture(HTTP_FIXTURE_PATH)
    const pathImage = path.join(SHOTS_DIR, "gpuiv-img-path-url.png")
    const urlImage = path.join(SHOTS_DIR, "gpuiv-img-http-url.png")
    if (fs.existsSync(pathImage)) fs.unlinkSync(pathImage)
    if (fs.existsSync(urlImage)) fs.unlinkSync(urlImage)

    const fromPath = createTestApp(defineComponent({
      setup: () => () => <img src={HTTP_FIXTURE_PATH} style={{ width: 240, height: 140 }} />,
    }))
    fromPath.renderer.flush()
    fromPath.renderer.captureScreenshot(pathImage)
    fromPath.unmount()

    const fromUrl = createTestApp(defineComponent({
      setup: () => () => (
        <img src="https://example.test/gpuiv-img.svg" style={{ width: 240, height: 140 }} />
      ),
    }))
    fromUrl.renderer.flush()
    fromUrl.renderer.flush()
    fromUrl.renderer.flush()
    fromUrl.renderer.captureScreenshot(urlImage)
    fromUrl.unmount()

    expect(fs.statSync(pathImage).size).toBeGreaterThan(0)
    expect(fs.statSync(urlImage).size).toBeGreaterThan(0)
    if (!process.env.CI) {
      expect(
        bufferSimilarity(fs.readFileSync(pathImage), fs.readFileSync(urlImage))
      ).toBeGreaterThan(0.99)
    }
  })
})
