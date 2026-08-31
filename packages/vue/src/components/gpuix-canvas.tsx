/** Native `<canvas>`: a JS-owned RGBA buffer GPUI paints as a GPU texture. */

import { computed, defineComponent, h, ref, type PropType } from "vue"
import type { HostNode } from "../types.js"
import { useGpuix } from "../hooks/use-gpuix.js"

/** Imperative surface of `<GpuixCanvas>`, reached through a template ref. */
export interface GpuixCanvasInstance {
  /** Host element id — for direct `renderer` calls and automation. */
  readonly id: number | undefined
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

    function requireId(): number {
      const id = root.value?.id
      if (id == null) {
        throw new Error("GpuixCanvas method called before the canvas is mounted")
      }
      return id
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

    expose({
      id: computed(() => root.value?.id ?? undefined),
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
