/// GPU-backed port of upstream's scrollbar tests (d789ba4/a064295/90c6ad0/
/// 447ade9 + f15c044's logical-pixel reads): the thumb is pure paint, so these
/// read the pixels of a captureScreenshot instead of asserting on bounds.

import path from "path"
import { defineComponent } from "vue"
import { describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import { readPixels, readLogicalPixels, SHOTS_DIR, type Pixels } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const THUMB = "#ff0000"

/** Rows (within the scroller's 100px) holding thumb-coloured pixels in a column. */
function thumbRows(pixels: Pixels, x: number, top = 0) {
  const rows: number[] = []
  for (let y = 0; y < 100; y++) {
    const [r, g, b] = pixels.at(x, top + y)
    if (r > 200 && g < 60 && b < 60) rows.push(y)
  }
  return rows
}

async function shoot(
  contentHeight: number,
  scrollTo?: number,
  scroller: Record<string, unknown> = {},
) {
  const App = defineComponent({
    setup: () => () => (
      <div
        testId="scroller"
        style={{
          width: 100,
          height: 100,
          overflow: "scroll",
          scrollbarColor: THUMB,
          ...scroller,
        }}
      >
        <div style={{ width: 100, height: contentHeight, backgroundColor: "#202020" }} />
      </div>
    ),
  })
  const app = createTestApp(App)
  try {
    await app.settle()
    if (scrollTo !== undefined) {
      app.renderer.scrollTo(app.renderer.findByTestId("scroller")!.id, 0, -scrollTo)
      app.renderer.flush()
    }
    const file = path.join(SHOTS_DIR, `scrollbar-${contentHeight}-${scrollTo ?? "top"}.png`)
    app.renderer.captureScreenshot(file)
    return file
  } finally {
    app.unmount()
  }
}

describeNative("scrollbarColor (vue)", () => {
  it("paints a thumb along the right edge, as long as the viewport is of the content", async () => {
    // 100px of a 300px content: a third of the track.
    const file = await shoot(300)
    // eslint-disable-next-line no-console
    console.log(
      "DIAG raw png:",
      (() => {
        const raw = readPixels(file)
        let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let count = 0
      for (let y = 0; y < raw.height; y++) {
        for (let x = 0; x < raw.width; x++) {
          const [r, g, b] = raw.at(x, y)
          if (r > 200 && g < 60 && b < 60) {
            count++
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }
        }
      }
      return JSON.stringify({ w: raw.width, h: raw.height, red: count, box: [minX, minY, maxX, maxY] })
      })(),
    )
    const rows = thumbRows(readLogicalPixels(file), 97)
    expect(rows[0]).toBe(0)
    expect(rows.at(-1)).toBe(32)
    expect(thumbRows(readLogicalPixels(await shoot(300)), 80), "only along the edge").toEqual([])
    expect(thumbRows(readLogicalPixels(await shoot(300)), 93), "6px wide: x 94 to 99").toEqual([])
    expect(thumbRows(readLogicalPixels(await shoot(300)), 94).length).toBeGreaterThan(0)
  })

  it("follows the scroll offset", async () => {
    const rows = thumbRows(readLogicalPixels(await shoot(300, 200)), 97)
    expect(rows[0]).toBe(67)
    expect(rows.at(-1)).toBe(99)
    const middle = thumbRows(readLogicalPixels(await shoot(300, 100)), 97)
    expect(middle[0]).toBeGreaterThan(25)
    expect(middle[0]).toBeLessThan(45)
  })

  it("paints nothing when the content fits", async () => {
    expect(thumbRows(readLogicalPixels(await shoot(80)), 97)).toEqual([])
  })

  it("is off without a colour, and takes the thickness from scrollbarWidth", async () => {
    expect(
      thumbRows(readLogicalPixels(await shoot(300, undefined, { scrollbarColor: undefined })), 97),
    ).toEqual([])
    const wide = await shoot(300, undefined, { scrollbarWidth: 12 })
    expect(
      thumbRows(readLogicalPixels(wide), 89).length,
      "12px wide: x 88 to 99",
    ).toBeGreaterThan(0)
    expect(thumbRows(readLogicalPixels(wide), 87)).toEqual([])
  })

  it("draws a thumb along the bottom for sideways scrolling, and leaves the corner when both show", async () => {
    const App = defineComponent({
      setup: () => () => (
        <div
          style={{
            width: 100,
            height: 100,
            overflow: "scroll",
            scrollbarColor: THUMB,
            scrollbarWidth: 6,
          }}
        >
          <div style={{ width: 300, height: 300, backgroundColor: "#202020" }} />
        </div>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const file = path.join(SHOTS_DIR, "scrollbar-both.png")
      app.renderer.captureScreenshot(file)
      const pixels = readLogicalPixels(file)
      const isThumb = (x: number, y: number) => {
        const [r, g, b] = pixels.at(x, y)
        return r > 200 && g < 60 && b < 60
      }
      // Vertical thumb: the right edge, from the top, stopping short of the corner.
      const down = Array.from({ length: 100 }, (_, y) => y).filter((y) => isThumb(97, y))
      // Horizontal thumb: the bottom edge, from the left, stopping short of the corner.
      const across = Array.from({ length: 100 }, (_, x) => x).filter((x) => isThumb(x, 97))
      expect(down[0]).toBe(0)
      expect(across[0]).toBe(0)
      expect(down.at(-1)).toBeLessThan(94)
      expect(across.at(-1)).toBeLessThan(94)
      expect(isThumb(97, 97), "the corner stays free").toBe(false)
    } finally {
      app.unmount()
    }
  })

  it("never shortens a thumb below a grabbable length", async () => {
    const rows = thumbRows(readLogicalPixels(await shoot(5000)), 97)
    expect(rows.length).toBe(20)
  })
})

describeNative("scrollbarColor on a <virtual-list> (vue)", () => {
  /** 30 rows of 40px in a 160px list: 1200px of content. */
  async function shootList(scrollToRow?: number, scrollbarColor: string | null = THUMB) {
    const App = defineComponent({
      setup: () => () => (
        <virtual-list
          testId="list"
          overdraw={0}
          estimatedItemHeight={40}
          style={{
            width: 100,
            height: 160,
            backgroundColor: "#202020",
            scrollbarColor: scrollbarColor ?? undefined,
          }}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <div key={index} style={{ height: 40, flexShrink: 0 }} />
          ))}
        </virtual-list>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      if (scrollToRow !== undefined) {
        app.renderer.scrollToItem(app.renderer.findByTestId("list")!.id, scrollToRow)
        app.renderer.flush()
      }
      const file = path.join(
        SHOTS_DIR,
        `scrollbar-list-${scrollToRow ?? "top"}-${scrollbarColor ? "on" : "off"}.png`,
      )
      app.renderer.captureScreenshot(file)
      const pixels = readLogicalPixels(file)
      const rows: number[] = []
      for (let y = 0; y < 160; y++) {
        const [r, g, b] = pixels.at(97, y)
        if (r > 200 && g < 60 && b < 60) rows.push(y)
      }
      return rows
    } finally {
      app.unmount()
    }
  }

  it("paints a thumb at the top of a list that rests there", async () => {
    // 160px of 1200px is 21px of the track.
    const rows = await shootList()
    expect(rows[0]).toBe(0)
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(rows.length).toBeLessThanOrEqual(22)
  })

  it("moves the thumb down as the list scrolls", async () => {
    // 600px of the 1040px it can move: past the middle of the track.
    const rows = await shootList(15)
    expect(rows[0]).toBeGreaterThan(70)
    expect(rows[0]).toBeLessThan(90)
    expect((await shootList(29))[0]).toBeGreaterThan(rows[0]!)
  })

  it("paints nothing without a colour", async () => {
    expect(await shootList(undefined, null)).toEqual([])
  })

  it("sizes the rows it has not measured from the ones it has, not from the estimate", async () => {
    const App = defineComponent({
      setup: () => () => (
        <virtual-list
          testId="list"
          overdraw={0}
          estimatedItemHeight={40}
          style={{
            width: 100,
            height: 400,
            backgroundColor: "#202020",
            scrollbarColor: THUMB,
          }}
        >
          {Array.from({ length: 20 }, (_, index) => (
            <div key={index} style={{ height: 200, flexShrink: 0 }} />
          ))}
        </virtual-list>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const file = path.join(SHOTS_DIR, "scrollbar-list-tall-rows.png")
      app.renderer.captureScreenshot(file)
      const pixels = readLogicalPixels(file)
      const rows: number[] = []
      for (let y = 0; y < 400; y++) {
        const [r, g, b] = pixels.at(97, y)
        if (r > 200 && g < 60 && b < 60) rows.push(y)
      }
      // 20 rows of 200px in a 400px list is 4000px, so the thumb is 40px. With
      // only the 40px estimate for the rows out of view it would be 143px.
      expect(rows[0]).toBe(0)
      expect(rows.length).toBeGreaterThanOrEqual(38)
      expect(rows.length).toBeLessThanOrEqual(42)
    } finally {
      app.unmount()
    }
  })
})

describeNative("padding on a <virtual-list> (vue)", () => {
  const ROW = "#00ff00"

  it("insets the rows on every side and keeps the thumb at the list's own edge", async () => {
    const App = defineComponent({
      setup: () => () => (
        <virtual-list
          overdraw={0}
          estimatedItemHeight={40}
          style={{
            width: 100,
            height: 160,
            paddingTop: 20,
            paddingLeft: 10,
            paddingRight: 30,
            backgroundColor: "#202020",
            scrollbarColor: THUMB,
          }}
        >
          {Array.from({ length: 30 }, (_, index) => (
            <div key={index} style={{ height: 40, flexShrink: 0, backgroundColor: ROW }} />
          ))}
        </virtual-list>
      ),
    })
    const app = createTestApp(App)
    try {
      await app.settle()
      const file = path.join(SHOTS_DIR, "scrollbar-list-padded.png")
      app.renderer.captureScreenshot(file)
      const pixels = readLogicalPixels(file)
      const rows = { left: Infinity, right: -Infinity, top: Infinity }
      let thumbX = -1
      for (let y = 0; y < 160; y++) {
        for (let x = 0; x < 100; x++) {
          const [r, g, b] = pixels.at(x, y)
          if (g > 200 && r < 60 && b < 60) {
            rows.left = Math.min(rows.left, x)
            rows.right = Math.max(rows.right, x)
            rows.top = Math.min(rows.top, y)
          }
          if (r > 200 && g < 60 && b < 60) thumbX = Math.max(thumbX, x)
        }
      }
      // 30 rows of 40px in a 160px list: the rows get 60px of the 100px.
      expect(rows).toEqual({ left: 10, right: 69, top: 20 })
      expect(thumbX, "the thumb sits in the right padding, at the list's edge").toBe(99)
    } finally {
      app.unmount()
    }
  })
})
