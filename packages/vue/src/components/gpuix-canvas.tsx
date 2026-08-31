/** Native `<canvas>`: a JS-owned RGBA buffer GPUI paints as a GPU texture. */

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
   * later one — same identity as a DOM canvas. Drawing goes through the
   * pure-TypeScript rasterizer and reaches the GPU through the coalesced
   * upload below; the pixel-bridge methods stay available for manual
   * buffer control.
   */
  getContext(type: "2d"): GpuixCanvasRenderingContext2D | null
  /**
   * Upload a full RGBA buffer (row-major, 4 bytes per pixel) and repaint.
   * `Uint8ClampedArray` — what `ImageData.data` gives — is accepted.
   * `pixels.length` must be `width * height * 4`; native validates.
   *
   * Pixels ride a dedicated FFI call, never `applyBatch`: a canvas repaint
   * moves megabytes, and the batch JSON would escape every byte. JS keeps its
   * own copy as the source of truth, exactly like a DOM canvas.
   */
  uploadPixels(pixels: Uint8Array | Uint8ClampedArray): void
  /** The last uploaded buffer as RGBA, or null before the first upload.
   *  A bridge round-trip, not a GPU readback — JS owns the drawing state. */
  readPixels(): Uint8Array | null
}

export const GpuixCanvas = defineComponent({
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
          return id != null && renderer?.uploadCanvasPixels
            ? { renderer, id }
            : null
        })
      }
      return context
    }

    function uploadPixels(pixels: Uint8Array | Uint8ClampedArray): void {
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
      renderer.uploadCanvasPixels(id, props.width, props.height, bytes)
    }

    function readPixels(): Uint8Array | null {
      const renderer = gpuix.renderer
      if (!renderer?.readCanvasPixels) return null
      return renderer.readCanvasPixels(requireId())
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
