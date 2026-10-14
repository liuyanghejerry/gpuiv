import { defineComponent, h, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HostNode } from "@gpuiv/vue"
import { GallerySection, useGalleryWindowing } from "../../../examples/animal-island.js"
import { mountHost } from "./harness.js"

let app: ReturnType<typeof mountHost> | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => { app?.unmount(); app = undefined; vi.useRealTimers() })

function fixture() {
  const geometry = { viewportWidth: 600, paintedWidth: 600, viewportHeight: 400, offset: 0, heights: [500, 500, 500, 500, 500, 500] }
  const boundsReads = { viewport: 0, header: 0, body: 0 }
  const localMounts = new Map<number, number>()
  const Demo = defineComponent({
    props: { index: { type: Number, required: true } },
    setup(props) {
      localMounts.set(props.index, (localMounts.get(props.index) ?? 0) + 1)
      return () => h("text", null, `demo-${props.index}`)
    },
  })
  const App = defineComponent({
    setup() {
      const scroller = ref<HostNode | null>(null)
      useGalleryWindowing(scroller)
      return () => h("div", { ref: scroller, testId: "scroller", style: { overflow: "scroll", height: geometry.viewportHeight, width: geometry.viewportWidth } },
        [h("div", { style: { display: "flex", flexDirection: "column", gap: 40, padding: 28 } },
          geometry.heights.map((_height, index) => h(GallerySection, { key: index, title: `Section ${index}` }, {
            default: () => [h(Demo, { index })],
          })),
        )],
      )
    },
  })
  app = mountHost(App, {
    getScrollOffset: () => [0, geometry.offset],
    getElementBounds: (id) => {
      const node = app?.all().find((candidate) => candidate.id === id)
      if (!node) return null
      if (node.props.testId === "scroller") {
        boundsReads.viewport++
        return { x: 0, y: 62 + geometry.offset, width: geometry.viewportWidth, height: geometry.viewportHeight }
      }
      const marker = /^section-mounted-(\d+)$/.exec(String(node.props.testId))
      if (marker) {
        boundsReads.body++
        return { x: 28, y: 10000, width: geometry.paintedWidth - 56, height: geometry.heights[Number(marker[1])] }
      }
      // Header text/header bounds are always mounted. Deliberately stale y:
      // windowing must use current measured heights, not capture that y forever.
      boundsReads.header++
      return { x: 28, y: 10000, width: geometry.viewportWidth - 56, height: 28 }
    },
  })
  return { app, geometry, localMounts, boundsReads }
}
async function advance(ms = 400) { await vi.advanceTimersByTimeAsync(ms); await app!.settle() }
const exists = (testId: string) => app!.all().some((node) => node.props.testId === testId)

describe("Animal Island section windowing", () => {
  it("keeps section titles and body heights while distant demos unmount", async () => {
    const { app } = fixture()
    await advance()
    expect(app.text()).toContain("Section 5")
    expect(exists("section-mounted-0")).toBe(true)
    expect(exists("section-mounted-5")).toBe(false)
    expect(app.find("section-placeholder-5").props.style).toMatchObject({ height: 500 })
    expect(app.find("section-body-5").props).toMatchObject({ "aria-label": "Section 5" })
    expect(app.all().filter((node) => (node.props.style as { overflow?: string } | undefined)?.overflow === "scroll")).toHaveLength(1)
  })

  it("mounts near a new scroll position and unmounts after the wider hysteresis band", async () => {
    const { geometry } = fixture()
    await advance()
    expect(exists("section-mounted-2")).toBe(false)
    geometry.offset = -700; await advance(120)
    expect(exists("section-mounted-2")).toBe(true)
    // Going just beyond the mount band retains the mounted body.
    geometry.offset = -300; await advance(120)
    expect(exists("section-mounted-2")).toBe(true)
    geometry.offset = -3000; await advance(120)
    expect(exists("section-mounted-0")).toBe(false)
    expect(exists("section-mounted-5")).toBe(true)
  })

  it("updates later content positions after a mounted Collapse/Form grows", async () => {
    const { geometry } = fixture()
    await advance()
    geometry.offset = -700; await advance(120)
    expect(exists("section-mounted-2")).toBe(true)
    geometry.heights[1] = 2400; await advance(400)
    expect(exists("section-mounted-2")).toBe(false)
    expect(app!.find("section-placeholder-2").props.style).toMatchObject({ height: 500 })
  })

  it("only polls mounted bodies in steady state and refreshes headers on width changes", async () => {
    const { geometry, boundsReads } = fixture()
    await advance()
    expect(boundsReads.header).toBe(6)
    const bodyReads = boundsReads.body
    await advance(800)
    expect(boundsReads.header).toBe(6)
    expect(boundsReads.body).toBeGreaterThan(bodyReads)
    geometry.viewportWidth = 400
    geometry.paintedWidth = 400
    await advance(400)
    expect(boundsReads.header).toBe(12)
  })

  it("uses the current viewport height after a resize", async () => {
    const { geometry } = fixture()
    await advance()
    expect(exists("section-mounted-3")).toBe(false)
    geometry.viewportHeight = 1000; await advance(250)
    expect(exists("section-mounted-3")).toBe(true)
  })

  it("remeasures all body heights at a new viewport width", async () => {
    const { geometry } = fixture()
    await advance()
    expect(exists("section-placeholder-5")).toBe(true)
    geometry.viewportWidth = 400
    geometry.paintedWidth = 400
    geometry.heights[5] = 900
    await advance(250)
    expect(exists("section-mounted-5")).toBe(true)
    await advance(150)
    expect(exists("section-placeholder-5")).toBe(true)
    expect(app!.find("section-placeholder-5").props.style).toMatchObject({ height: 900 })
  })

  it("waits for newly painted dimensions instead of accepting old resize bounds", async () => {
    const { geometry } = fixture()
    await advance()
    geometry.viewportWidth = 400
    geometry.heights[5] = 900
    await advance(400)
    // The viewport reports its new width, but these section bounds still
    // belong to the previous frame. Bodies stay mounted until the new frame.
    expect(exists("section-mounted-5")).toBe(true)
    geometry.paintedWidth = 400
    await advance(400)
    expect(app!.find("section-placeholder-5").props.style).toMatchObject({ height: 900 })
  })

  it("restarts uncontrolled demos on revisit while all polling timers clean up", async () => {
    const { app: host, geometry, localMounts } = fixture()
    await advance()
    expect(localMounts.get(0)).toBe(1)
    geometry.offset = -3000; await advance(120)
    geometry.offset = 0; await advance(120)
    expect(localMounts.get(0)).toBe(2)
    expect(vi.getTimerCount()).toBe(3)
    host.unmount()
    expect(vi.getTimerCount()).toBe(0)
    app = undefined
  })
})
