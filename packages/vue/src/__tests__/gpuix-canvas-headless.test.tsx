/// Headless logic tests for the GpuixCanvas component: buffer wiring through
/// the mutation protocol, 2d context acquisition and identity, the coalesced
/// context→renderer upload, resize semantics, the pixel/PNG bridge methods
/// (recording stubs on a HeadlessRenderer subclass — headless.ts itself stays
/// untouched, the injection goes through custom-renderer-mount.ts), and
/// unmount cleanup. The rasterization core is pure TS, so everything below
/// runs on Linux without a GPU.

import { defineComponent, h, ref } from "vue"
import { describe, expect, it } from "vitest"
import { GpuixCanvas } from "../components/gpuix-canvas.js"
import type { GpuixCanvasInstance } from "../components/gpuix-canvas.js"
import { HeadlessRenderer, mountHeadless } from "./headless.js"
import { mountWithRenderer } from "./custom-renderer-mount.js"

/** HeadlessRenderer plus recording stubs for the canvas pixel bridge. */
class CanvasHeadlessRenderer extends HeadlessRenderer {
  pixelUploads: Array<{
    id: number
    width: number
    height: number
    pixels: Uint8Array
    dirty?: [number, number, number, number]
  }> = []
  contextUploads: Array<{ id: number; core: unknown }> = []
  storedPixels: Uint8Array | null = null
  pngBytes: Uint8Array | null = null

  uploadCanvasPixels(
    id: number,
    width: number,
    height: number,
    pixels: Uint8Array,
    dirty?: [number, number, number, number]
  ): void {
    this.pixelUploads.push({ id, width, height, pixels, dirty })
  }
  uploadCanvasFromContext(id: number, core: unknown): void {
    this.contextUploads.push({ id, core })
  }
  readCanvasPixels(): Uint8Array | null {
    return this.storedPixels
  }
  canvasToPng(): Uint8Array | null {
    return this.pngBytes
  }
}

interface CanvasMount {
  renderer: HeadlessRenderer
  instance: GpuixCanvasInstance
  canvasId: number
  settle: () => Promise<void>
  unmount: () => void
}

function mountCanvas(
  props: Record<string, unknown>,
  rendererArg?: HeadlessRenderer
): CanvasMount {
  const renderer = rendererArg ?? new CanvasHeadlessRenderer()
  const canvas = ref<GpuixCanvasInstance | null>(null)
  const mounted = mountWithRenderer(
    defineComponent({
      setup: () => () => h(GpuixCanvas, { ref: canvas, ...props }),
    }),
    renderer
  )
  const canvasId = (() => {
    const op = renderer.opsOf("createElement").find((o) => o[2] === "canvas")
    if (!op) throw new Error("no canvas element")
    return op[1] as number
  })()
  return {
    renderer,
    instance: canvas.value!,
    canvasId,
    settle: mounted.settle,
    unmount: mounted.unmount,
  }
}

/** Let the context's coalescing upload microtask run. */
const flushUploads = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function decodeDataUrl(url: string): Uint8Array {
  const base64 = url.slice(url.indexOf(",") + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

describe("GpuixCanvas (headless)", () => {
  it("mounts a canvas element carrying its buffer props and style", () => {
    const mounted = mountCanvas({
      width: 32,
      height: 24,
      objectFit: "contain",
      style: { width: 160, height: 120 },
    })
    const custom = (key: string) => {
      const ops = mounted.renderer
        .opsOf("setCustomProp")
        .filter((op) => op[1] === mounted.canvasId && op[2] === key)
      return ops[0]?.[3]
    }
    expect(custom("width")).toBe(32)
    expect(custom("height")).toBe(24)
    expect(custom("objectFit")).toBe("contain")
    expect(mounted.renderer.lastStyle(mounted.canvasId)).toMatchObject({ width: 160, height: 120 })
    expect(mounted.instance.id).toBe(mounted.canvasId)
    mounted.unmount()
  })

  it("returns one 2d context per canvas and null for other types", () => {
    const mounted = mountCanvas({ width: 8, height: 8 })
    const context = mounted.instance.getContext("2d")
    expect(context).not.toBeNull()
    expect(mounted.instance.getContext("2d")).toBe(context)
    expect(mounted.instance.getContext("webgl")).toBeNull()
    mounted.unmount()
  })

  it("flushes 2d draws to the renderer's context upload once per microtask", async () => {
    const mounted = mountCanvas({ width: 16, height: 16 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer
    const context = mounted.instance.getContext("2d")!

    context.fillStyle = "#ff0000"
    context.fillRect(0, 0, 4, 4)
    context.fillRect(8, 8, 4, 4)
    await flushUploads()
    expect(recorder.contextUploads).toHaveLength(1)
    expect(recorder.contextUploads[0]!.id).toBe(mounted.canvasId)
    const core = recorder.contextUploads[0]!.core as { getWidth(): number; getHeight(): number }
    expect(core.getWidth()).toBe(16)
    expect(core.getHeight()).toBe(16)

    context.fillRect(1, 1, 2, 2)
    await flushUploads()
    expect(recorder.contextUploads).toHaveLength(2)
    mounted.unmount()
  })

  it("draws without a renderer-side upload hook", async () => {
    const mounted = mountCanvas({ width: 8, height: 8 }, new HeadlessRenderer())
    const context = mounted.instance.getContext("2d")!
    expect(() => context.fillRect(0, 0, 4, 4)).not.toThrow()
    await flushUploads()
    mounted.unmount()
  })

  it("uploads pixel buffers, unwrapping clamped arrays and forwarding dirty rects", () => {
    const mounted = mountCanvas({ width: 2, height: 2 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer

    const plain = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    mounted.instance.uploadPixels(plain)
    expect(recorder.pixelUploads[0]).toMatchObject({
      id: mounted.canvasId,
      width: 2,
      height: 2,
      dirty: undefined,
    })
    expect(recorder.pixelUploads[0]!.pixels).toBe(plain)

    const clamped = new Uint8ClampedArray(plain)
    mounted.instance.uploadPixels(clamped, [0, 0, 1, 1])
    const second = recorder.pixelUploads[1]!
    expect(second.dirty).toEqual([0, 0, 1, 1])
    expect(second.pixels).toBeInstanceOf(Uint8Array)
    expect(second.pixels).not.toBeInstanceOf(Uint8ClampedArray)
    expect(Array.from(second.pixels)).toEqual(Array.from(plain))
    mounted.unmount()
  })

  it("refuses manual uploads without renderer support or after unmount", () => {
    const unsupported = mountCanvas({ width: 2, height: 2 }, new HeadlessRenderer())
    expect(() => unsupported.instance.uploadPixels(new Uint8Array(16))).toThrow(
      /uploadCanvasPixels support/
    )
    unsupported.unmount()

    const mounted = mountCanvas({ width: 2, height: 2 })
    mounted.unmount()
    expect(() => mounted.instance.uploadPixels(new Uint8Array(16))).toThrow(
      /before the canvas is mounted/
    )
  })

  it("reads pixels through the store when the renderer supports it", () => {
    const unsupported = mountCanvas({ width: 2, height: 2 }, new HeadlessRenderer())
    expect(unsupported.instance.readPixels()).toBeNull()
    unsupported.unmount()

    const mounted = mountCanvas({ width: 2, height: 2 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer
    expect(mounted.instance.readPixels()).toBeNull()
    recorder.storedPixels = new Uint8Array([9, 9, 9, 9])
    expect(mounted.instance.readPixels()).toEqual(new Uint8Array([9, 9, 9, 9]))
    mounted.unmount()
    expect(() => mounted.instance.readPixels()).toThrow(/before the canvas is mounted/)
  })

  it("encodes toDataURL across chunk boundaries and returns null before any upload", () => {
    const mounted = mountCanvas({ width: 4, height: 4 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer
    expect(mounted.instance.toDataURL()).toBeNull()

    const small = new Uint8Array([0, 1, 2, 250])
    recorder.pngBytes = small
    const url = mounted.instance.toDataURL("image/jpeg")!
    expect(url.startsWith("data:image/png;base64,")).toBe(true)
    expect(decodeDataUrl(url)).toEqual(small)

    // Two full 0x8000 chunks plus a tail exercises the chunked accumulation.
    const large = new Uint8Array(0x8000 * 2 + 7)
    for (let index = 0; index < large.length; index++) large[index] = (index * 7 + 13) & 0xff
    recorder.pngBytes = large
    expect(decodeDataUrl(mounted.instance.toDataURL()!)).toEqual(large)
    mounted.unmount()
  })

  it("toBlob hands back a PNG blob synchronously, or null before any upload", async () => {
    const mounted = mountCanvas({ width: 4, height: 4 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer
    let blob: Blob | null = new Blob()
    mounted.instance.toBlob((result) => (blob = result))
    expect(blob).toBeNull()

    const bytes = new Uint8Array([137, 80, 78, 71])
    recorder.pngBytes = bytes
    mounted.instance.toBlob((result) => (blob = result), "image/webp")
    expect(blob).toBeInstanceOf(Blob)
    expect(blob!.type).toBe("image/png")
    expect(blob!.size).toBe(4)
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes)
    mounted.unmount()
  })

  it("toDataURL and toBlob require a renderer with PNG support", () => {
    const mounted = mountCanvas({ width: 2, height: 2 }, new HeadlessRenderer())
    expect(() => mounted.instance.toDataURL()).toThrow(/canvasToPng support/)
    let blob: Blob | null | undefined
    expect(() => mounted.instance.toBlob((result) => (blob = result))).toThrow(
      /canvasToPng support/
    )
    expect(blob).toBeUndefined()
    mounted.unmount()
  })

  it("resizes and resets the context when buffer dimensions change", async () => {
    const width = ref(16)
    const height = ref(16)
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const renderer = new CanvasHeadlessRenderer()
    const mounted = mountWithRenderer(
      defineComponent({
        setup: () => () =>
          h(GpuixCanvas, { ref: canvas, width: width.value, height: height.value }),
      }),
      renderer
    )
    const context = canvas.value!.getContext("2d")!
    context.fillStyle = "#ff0000"
    context.fillRect(0, 0, 4, 4)
    await flushUploads()
    const uploadsBefore = renderer.contextUploads.length

    width.value = 32
    await mounted.settle()
    expect(context.canvas.width).toBe(32)
    expect(context.canvas.height).toBe(16)
    // A DOM canvas reset: state back to defaults, resize uploads scheduled.
    expect(context.fillStyle).toBe("#000000")
    await flushUploads()
    expect(renderer.contextUploads.length).toBe(uploadsBefore + 1)

    height.value = 24
    await mounted.settle()
    expect(context.canvas.height).toBe(24)
    mounted.unmount()
  })

  it("a context created after a resize picks up the new dimensions", async () => {
    const width = ref(16)
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const renderer = new CanvasHeadlessRenderer()
    const mounted = mountWithRenderer(
      defineComponent({
        setup: () => () => h(GpuixCanvas, { ref: canvas, width: width.value, height: 8 }),
      }),
      renderer
    )
    width.value = 24
    await mounted.settle()
    const context = canvas.value!.getContext("2d")!
    expect(context.canvas.width).toBe(24)
    expect(context.canvas.height).toBe(8)
    mounted.unmount()
  })

  it("disposes the context on unmount: later draws schedule no uploads", async () => {
    const mounted = mountCanvas({ width: 8, height: 8 })
    const recorder = mounted.renderer as CanvasHeadlessRenderer
    const context = mounted.instance.getContext("2d")!
    context.fillRect(0, 0, 8, 8)
    await flushUploads()
    const before = recorder.contextUploads.length
    expect(before).toBeGreaterThan(0)

    mounted.unmount()
    context.fillRect(0, 0, 8, 8)
    await flushUploads()
    expect(recorder.contextUploads.length).toBe(before)
  })
})

/// A plain mountHeadless smoke: the component renders through the shared
/// harness too, keeping the headless.ts path exercised.
describe("GpuixCanvas via mountHeadless", () => {
  it("mounts and unmounts without any canvas bridge support", () => {
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const app = mountHeadless(
      defineComponent({
        setup: () => () => <GpuixCanvas ref={canvas} width={4} height={4} />,
      })
    )
    const created = app.renderer.opsOf("createElement").find((op) => op[2] === "canvas")
    expect(created).toBeDefined()
    expect(canvas.value?.getContext("2d")).not.toBeNull()
    app.unmount()
  })
})
