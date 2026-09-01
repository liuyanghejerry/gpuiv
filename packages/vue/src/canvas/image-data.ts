/**
 * `ImageData` for the GPUIV 2D context — the DOM-observable constructor and
 * the objects `createImageData`/`getImageData` return. Dimensions and the
 * byte buffer follow the WebIDL conversions the HTML spec spells out:
 * numbers are truncated then taken as absolute magnitudes, non-numeric
 * strings become zero sizes, and every zero dimension is an IndexSizeError.
 */

const MAX_DIMENSION = 0x7fffffff

/** WebIDL `unsigned long`-ish conversion for a size argument: strings become
 *  numbers, a failed conversion reads as zero, and magnitudes are what count. */
function toSize(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0
    return Math.trunc(value)
  }
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

export class GpuixImageData {
  #width: number
  #height: number
  #data: Uint8ClampedArray
  readonly colorSpace: "srgb" | "display-p3"
  readonly pixelFormat: "rgba-8bit"

  /** Dimensions are exposed through getters so assignments from script are
   *  silently ignored, exactly like the DOM's readonly IDL attributes. */
  get width(): number {
    return this.#width
  }

  get height(): number {
    return this.#height
  }

  get data(): Uint8ClampedArray {
    return this.#data
  }

  constructor(
    sw: number | Uint8ClampedArray,
    sh?: number | { colorSpace?: string },
    maybeHeight?: number | { colorSpace?: string },
    maybeSettings?: { colorSpace?: string },
  ) {
    // Both overloads allow settings to trail the size arguments; normalize
    // per branch: (sw, sh[, settings]) and (data, sw[, sh[, settings]]).
    let settings: { colorSpace?: string } | undefined
    if (!(sw instanceof Uint8ClampedArray)) {
      // Union member matching: numbers/bigints/strings coerce as sizes, an
      // alien typed array coerces too when no height argument forces the
      // three-argument data overload, and everything else is a TypeError.
      const looksNumeric =
        typeof sw === "number" || typeof sw === "bigint" || typeof sw === "string"
      if (!looksNumeric) {
        const alienView = typeof sw === "object" && sw !== null && ArrayBuffer.isView(sw)
        const heightGiven = typeof maybeHeight === "number"
        if (!alienView || heightGiven) {
          throw new TypeError("GpuixImageData: expected dimensions or pixel data")
        }
      }
      if (typeof sh !== "number" && typeof sh !== "string" && typeof sh !== "bigint") {
        throw new TypeError("GpuixImageData: constructor needs (sw, sh) or (data, sw[, sh])")
      }
      const w = Math.abs(toSize(sw))
      const h = Math.abs(toSize(sh))
      if (w === 0 || h === 0 || w > MAX_DIMENSION || h > MAX_DIMENSION) {
        throw new DOMException("GpuixImageData: dimensions must be positive", "IndexSizeError")
      }
      this.#width = w
      this.#height = h
      this.#data = new Uint8ClampedArray(w * h * 4)
      settings = typeof maybeHeight === "object" ? maybeHeight : maybeSettings
    } else {
      let width = 0
      let explicitHeight: number | undefined
      if (typeof sh === "number") {
        width = sh
        if (typeof maybeHeight === "number") explicitHeight = maybeHeight
        else if (typeof maybeHeight === "object") settings = maybeHeight
      } else if (sh === undefined) {
        throw new TypeError("GpuixImageData: constructor needs a width with pixel data")
      } else if (typeof sh === "object") {
        settings = sh
      } else {
        width = toSize(sh)
      }
      if (sw.length === 0 || sw.length % 4 !== 0) {
        throw new DOMException(
          "GpuixImageData: data length must be a positive multiple of four",
          "InvalidStateError",
        )
      }
      const w = Math.abs(toSize(width))
      if (w === 0 || w > MAX_DIMENSION) {
        throw new DOMException("GpuixImageData: width must be positive", "IndexSizeError")
      }
      const pixels = sw.length / 4
      if (pixels % w !== 0) {
        throw new DOMException(
          `GpuixImageData: data does not hold whole rows of width ${w}`,
          "IndexSizeError",
        )
      }
      const impliedHeight = pixels / w
      if (explicitHeight !== undefined && Math.abs(toSize(explicitHeight)) !== impliedHeight) {
        throw new DOMException("GpuixImageData: data length does not match sw × sh", "IndexSizeError")
      }
      if (impliedHeight > MAX_DIMENSION) {
        throw new DOMException("GpuixImageData: dimensions out of range", "IndexSizeError")
      }
      this.#width = w
      this.#height = impliedHeight
      this.#data = sw
    }
    this.colorSpace = settings?.colorSpace === "display-p3" ? "display-p3" : "srgb"
    this.pixelFormat = "rgba-8bit"
  }
}
