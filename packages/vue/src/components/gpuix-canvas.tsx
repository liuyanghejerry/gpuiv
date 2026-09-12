/** Native `<canvas>`: a native rasterization core whose buffer GPUI paints
 *  as a GPU texture. */

import { computed, defineComponent, h, onUnmounted, ref, watch, type PropType } from "vue"
import type { HostNode } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"
import { GpuixCanvasRenderingContext2D } from "../canvas/context2d.js"

/** Imperative surface of `<GpuixCanvas>`, reached through a template ref. */
export interface GpuixCanvasInstance {
  /** Host element id — for direct `renderer` calls and automation. */
  readonly id: number | undefined
  /**
   * The 2D drawing context, created on first call and returned on every
   * later one — same identity as a DOM canvas. Drawing records into the
   * native rasterization core and reaches the GPU through the coalesced
   * upload below; the pixel-bridge methods stay available for manual
   * buffer control.
   */
  getContext(type: "2d"): GpuixCanvasRenderingContext2D | null
  /** Upload a full RGBA buffer (row-major, 4 bytes per pixel) and repaint.
   *  `Uint8ClampedArray` — what `ImageData.data` gives — is accepted.
   *  `pixels.length` must be `width * height * 4`; native validates.
   *
   *  Manual pixel control only — the 2D context flushes itself straight
   *  from the native core (`uploadCanvasFromContext`). Pixels ride a
   *  dedicated FFI call, never `applyBatch`: a canvas repaint moves
   *  megabytes, and the batch JSON would escape every byte. */
  uploadPixels(pixels: Uint8Array | Uint8ClampedArray): void
  /** The last uploaded buffer as RGBA, or null before the first upload.
   *  A store round-trip, not a GPU readback. */
  readPixels(): Uint8Array | null
  /** The canvas as a `data:image/png;base64,…` URL, like the DOM method.
   *  Only PNG is produced: any other `type` falls back to PNG, the DOM's
   *  unsupported-type behavior. Returns null before the first upload —
   *  unlike the DOM, which would encode a transparent bitmap. */
  toDataURL(type?: string, quality?: unknown): string | null
  /** The canvas as a PNG `Blob`, like the DOM method (called
   *  synchronously rather than on a task). Any `type` other than PNG
   *  still yields PNG. Calls back with null before the first upload. */
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: unknown): void
}

export const GpuixCanvas = defineComponent({
  inheritAttrs: false,
  props: {
    /** Buffer width in pixels. Size the element box with `style`; the buffer
     *  stretches to it (`objectFit` defaults to `"fill"`, the `drawImage`
     *  stretch). Multiply by `devicePixelRatio` yourself for sharp output. */
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    /** `"fill" | "contain" | "cover" | "scaleDown" | "none"`. Default `"fill"`. */
    objectFit: {
      type: String as PropType<"fill" | "contain" | "cover" | "scaleDown" | "none">,
      default: undefined,
    },
  },
  setup(props, { attrs, expose }) {
    const gpuix = useGpuix()
    const root = ref<HostNode | null>(null)
    let context: GpuixCanvasRenderingContext2D | null = null

    function requireId(): number {
      const id = root.value?.id
      if (id == null) {
        throw new Error("GpuixCanvas method called before the canvas is mounted")
      }
      return id
    }

    function getContext(type: "2d"): GpuixCanvasRenderingContext2D | null {
      if (type !== "2d") return null
      if (!context) {
        context = new GpuixCanvasRenderingContext2D(props.width, props.height, () => {
          const id = root.value?.id
          const renderer = gpuix.renderer
          return id != null && renderer?.uploadCanvasFromContext
            ? { renderer, id }
            : null
        })
      }
      return context
    }

    function uploadPixels(
      pixels: Uint8Array | Uint8ClampedArray,
      dirty?: [number, number, number, number],
    ): void {
      const id = requireId()
      const renderer = gpuix.renderer
      if (!renderer?.uploadCanvasPixels) {
        throw new Error(
          "GpuixCanvas.uploadPixels() requires a renderer with uploadCanvasPixels support",
        )
      }
      // ImageData.data is Uint8ClampedArray; native takes a plain Uint8Array.
      const bytes =
        pixels instanceof Uint8ClampedArray
          ? new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
          : pixels
      renderer.uploadCanvasPixels(id, props.width, props.height, bytes, dirty)
    }

    function readPixels(): Uint8Array | null {
      const renderer = gpuix.renderer
      if (!renderer?.readCanvasPixels) return null
      return renderer.readCanvasPixels(requireId())
    }

    function canvasToPng(): Uint8Array | null {
      const renderer = gpuix.renderer
      if (!renderer?.canvasToPng) {
        throw new Error(
          "GpuixCanvas.toDataURL()/toBlob() requires a renderer with canvasToPng support",
        )
      }
      return renderer.canvasToPng(requireId())
    }

    function toDataURL(_type?: string, _quality?: unknown): string | null {
      const png = canvasToPng()
      if (png == null) return null
      let binary = ""
      // String.fromCharCode spreads cap out around 64k args; chunk so a
      // multi-megabyte canvas cannot blow the stack.
      const chunk = 0x8000
      for (let offset = 0; offset < png.length; offset += chunk) {
        binary += String.fromCharCode(...png.subarray(offset, offset + chunk))
      }
      return `data:image/png;base64,${btoa(binary)}`
    }

    function toBlob(
      callback: (blob: Blob | null) => void,
      _type?: string,
      _quality?: unknown,
    ): void {
      const png = canvasToPng()
      if (png == null) {
        callback(null)
        return
      }
      // The napi Buffer types as Uint8Array<ArrayBufferLike>, which is not a
      // BlobPart; copy into a plain ArrayBuffer-backed view.
      callback(new Blob([new Uint8Array(png)], { type: "image/png" }))
    }

    // A DOM canvas resets its bitmap and state when its width or height is
    // set, even to the same value; we reset only on an actual change so a
    // reactive no-op does not wipe the drawing.
    watch(
      () => [props.width, props.height] as const,
      ([width, height]) => {
        if (
          context &&
          (context.canvas.width !== width || context.canvas.height !== height)
        ) {
          context.resize(width, height)
        }
      },
    )

    onUnmounted(() => {
      context?.dispose()
      context = null
    })

    expose({
      id: computed(() => root.value?.id ?? undefined),
      getContext,
      uploadPixels,
      readPixels,
      toDataURL,
      toBlob,
    })

    return () =>
      h("canvas", {
        ref: root,
        ...attrs,
        width: props.width,
        height: props.height,
        objectFit: props.objectFit,
      })
  },
})
