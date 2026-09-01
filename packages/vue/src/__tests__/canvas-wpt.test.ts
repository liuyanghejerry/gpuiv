/// W3C web-platform-tests canvas conformance cases, run against the pure-TS
/// `CanvasRenderingContext2D` rasterizer — no window, no GPU, the same
/// headless path the pixel suite in `canvas-2d.test.tsx` uses.
///
/// The case table is generated from the vendored YAML in
/// `packages/vue/wpt/yaml/` by `scripts/convert-canvas-wpt.ts`; both the YAML
/// and the generated JSON are committed, so this suite never needs a YAML
/// parser or network access. Pixel assertions use the WPT tolerance of ±2 per
/// channel; cases the context cannot express yet are skipped with the missing
/// API in the test name, and known rendering differences live in
/// `KNOWN_GAPS` below so `it.fails` keeps them honest (a gap that starts
/// passing fails the suite until it is removed).
///
/// Regenerate after updating the YAML:
///
///   bun scripts/convert-canvas-wpt.ts

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"
import { GpuixCanvasRenderingContext2D as Context2D, GpuixImageData } from "../canvas/context2d.js"
import { parseColor } from "../canvas/color.js"

interface WptCase {
  id: string
  name: string
  suite: string
  desc: string
  code: string
  expected: string | null
  size: [number, number] | null
  requires: string[]
  unconvertible: string | null
}

/** Cases that run but render observably differently from a browser, with the
 * reason. `it.fails` inverts them: the suite goes red the day one of these
 * actually passes, so a stale entry cannot hide a fixed gap. */
const KNOWN_GAPS: Record<string, string> = {
  // filled during triage — every entry needs a concrete reason
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CASES: WptCase[] = (
  JSON.parse(fs.readFileSync(path.resolve(HERE, "../../wpt/generated/canvas-wpt.json"), "utf8")) as {
    cases: WptCase[]
  }
).cases

/** WPT's canvas-tests.js allows ±2 per channel on pixel assertions. */
const PIXEL_TOLERANCE = 2

const REPORT = process.env.WPT_REPORT ? path.resolve(process.env.WPT_REPORT) : null
if (REPORT) fs.writeFileSync(REPORT, "")
function report(id: string, message: string): void {
  if (REPORT) fs.appendFileSync(REPORT, `${JSON.stringify({ id, message })}\n`)
}

/** A headless DOM-flavoured canvas: settable width/height (which resets the
 * bitmap, like a DOM canvas) and `getContext` returning the live context.
 * 100×50 is the size WPT's generated harness gives its canvas. */
function makeCanvas(width = 100, height = 50) {
  const uploads: Array<{ width: number; height: number }> = []
  const renderer = {
    uploadCanvasPixels(_id: number, w: number, h: number, _pixels: Uint8Array) {
      uploads.push({ width: w, height: h })
    },
  }
  const ctx = new Context2D(width, height, () => ({ id: 7, renderer }))
  // Keep the context's original backing object for reads: after the swap
  // below, `ctx.canvas` is the stub, so the stub must not read through it.
  const backing = ctx.canvas
  const canvas = {
    get width() {
      return backing.width
    },
    set width(value: number) {
      ctx.resize(hostDimension(value), backing.height)
    },
    get height() {
      return backing.height
    },
    set height(value: number) {
      ctx.resize(backing.width, hostDimension(value))
    },
    getContext(type?: string) {
      if (arguments.length === 0) {
        throw new TypeError("getContext requires a contextId argument")
      }
      return type === "2d" ? ctx : null
    },
    [Symbol.toStringTag]: "HTMLCanvasElement",
  }
  ;(ctx as unknown as { canvas: unknown }).canvas = canvas
  return { ctx, canvas, uploads }
}

/** `canvas.width = v` per the HTML element: ToNumber, truncate, then wrap
 *  modulo 2³² (the IDL `unsigned long` conversion — the OffscreenCanvas
 *  flavour throws instead, but the element never does). A failed string
 *  conversion reads as zero. */
function hostDimension(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const truncated = Math.trunc(n)
  const wrapped = ((truncated % 2 ** 32) + 2 ** 32) % 2 ** 32
  return wrapped
}

function getPixel(canvas: { getContext(type: string): Context2D | null }, x: number, y: number) {
  const ctx = canvas.getContext("2d")!
  const data = ctx.getImageData(x, y, 1, 1).data
  return [data[0]!, data[1]!, data[2]!, data[3]!] as [number, number, number, number]
}

function assertPixel(
  canvas: ReturnType<typeof makeCanvas>["canvas"],
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
  tolerance = PIXEL_TOLERANCE,
): void {
  const [pr, pg, pb, pa] = getPixel(canvas, x, y)
  const channel = (actual: number, expected: number, name: string) => {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(
        `pixel (${x}, ${y}) ${name}: got ${actual}, expected ${expected} ±${tolerance} — ` +
          `actual rgba(${pr},${pg},${pb},${pa})`,
      )
    }
  }
  channel(pr, r, "red")
  channel(pg, g, "green")
  channel(pb, b, "blue")
  channel(pa, a, "alpha")
}

/** The whole-canvas `expected: <color>` check, only for cases whose code has
 * no per-pixel assertions of its own (otherwise the YAML authors already
 * asserted the interesting pixels and a solid-colour compare would only add
 * anti-aliasing false positives). */
function assertExpectedColor(
  ctx: Context2D,
  expected: string,
): void {
  const color = parseColor(expected)
  if (!color) return
  const [r, g, b, a] = [color.r, color.g, color.b, Math.round(color.a * 255)]
  const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
  for (let i = 0; i < data.length; i += 4) {
    const channels: Array<[number, number, string]> = [
      [data[i]!, r, "red"],
      [data[i + 1]!, g, "green"],
      [data[i + 2]!, b, "blue"],
      [data[i + 3]!, a, "alpha"],
    ]
    for (const [actual, wanted, name] of channels) {
      if (Math.abs(actual - wanted) > PIXEL_TOLERANCE) {
        const p = i / 4
        throw new Error(
          `expected whole canvas ${expected}, but pixel (${p % ctx.canvas.width}, ` +
            `${Math.floor(p / ctx.canvas.width)}) ${name} is ${actual} (rgba(${data[i]},${data[i + 1]},` +
            `${data[i + 2]},${data[i + 3]}))`,
        )
      }
    }
  }
}

/** Legacy DOM error codes the YAML still asserts with, mapped to the
 *  DOMException names our implementation throws — the same translation WPT's
 *  canvas-tests.js harness performs. */
const LEGACY_ERROR_CODES: Record<string, string> = {
  INDEX_SIZE_ERR: "IndexSizeError",
  DOMSTRING_SIZE_ERR: "DomstringSizeError",
  HIERARCHY_REQUEST_ERR: "HierarchyRequestError",
  WRONG_DOCUMENT_ERR: "WrongDocumentError",
  INVALID_CHARACTER_ERR: "InvalidCharacterError",
  NO_DATA_ALLOWED_ERR: "NoDataAllowedError",
  NO_MODIFICATION_ALLOWED_ERR: "NoModificationAllowedError",
  NOT_FOUND_ERR: "NotFoundError",
  NOT_SUPPORTED_ERR: "NotSupportedError",
  INUSE_ATTRIBUTE_ERR: "InUseAttributeError",
  INVALID_STATE_ERR: "InvalidStateError",
  SYNTAX_ERR: "SyntaxError",
  INVALID_MODIFICATION_ERR: "InvalidModificationError",
  NAMESPACE_ERR: "NamespaceError",
  INVALID_ACCESS_ERR: "InvalidAccessError",
  VALIDATION_ERR: "ValidationError",
  TYPE_MISMATCH_ERR: "TypeMismatchError",
  SECURITY_ERR: "SecurityError",
  NETWORK_ERR: "NetworkError",
  ABORT_ERR: "AbortError",
  URL_MISMATCH_ERR: "UrlMismatchError",
  TIMEOUT_ERR: "TimeoutError",
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "Error" ? error.message : `${error.name}: ${error.message}`
  }
  return String(error)
}

/** The `assert` surface the generated code calls, mapped onto plain throws so
 * vitest reports one failure per case. */
function makeAssert() {
  function assert(actual: unknown, ...messages: string[]): void {
    if (!actual) throw new Error(`assert(${messages.join(" ")}) failed`)
  }
  return Object.assign(assert, {
    strictEqual(actual: unknown, expected: unknown, ...messages: string[]) {
      if (!Object.is(actual, expected)) {
        throw new Error(`${messages.join(" ") || "assert.strictEqual"}: got ${String(actual)}, expected ${String(expected)}`)
      }
    },
    notStrictEqual(actual: unknown, expected: unknown, ...messages: string[]) {
      if (Object.is(actual, expected)) {
        throw new Error(`${messages.join(" ") || "assert.notStrictEqual"}: both are ${String(actual)}`)
      }
    },
    match(actual: string, pattern: RegExp, ...messages: string[]) {
      if (!pattern.test(actual)) {
        throw new Error(`${messages.join(" ") || "assert.match"}: ${actual} does not match ${pattern}`)
      }
    },
    throws(body: () => unknown, expected?: RegExp | (new () => Error)) {
      let thrown: unknown = null
      try {
        body()
      } catch (error) {
        thrown = error
      }
      if (thrown === null) throw new Error("assert.throws: did not throw")
      if (!expected) return
      if (typeof expected === "function") {
        if (!(thrown instanceof expected)) {
          // A DOMException never satisfies `instanceof RangeError`; accept a
          // matching name so legacy-style expectations still hold.
          const name = (thrown as { name?: string }).name
          if (name !== expected.name) {
            throw new Error(`assert.throws: expected ${expected.name}, got ${messageOf(thrown)}`)
          }
        }
      } else if (!expected.test(messageOf(thrown))) {
        const legacy = LEGACY_ERROR_CODES[expected.source]
        const name = (thrown as { name?: string }).name
        if (!legacy || name !== legacy) {
          throw new Error(`assert.throws: ${messageOf(thrown)} does not match ${expected}`)
        }
      }
    },
  })
}

type AssertApi = ReturnType<typeof makeAssert>

function same(actual: unknown, expected: unknown, actualExpr: string, expectedExpr: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${actualExpr} === ${expectedExpr}: got ${String(actual)}, expected ${String(expected)}`)
  }
}

function different(actual: unknown, expected: unknown, actualExpr: string, expectedExpr: string): void {
  if (Object.is(actual, expected)) {
    throw new Error(`${actualExpr} !== ${expectedExpr}: both are ${String(actual)}`)
  }
}

/** The geometry value objects WPT reaches for; only the x/y members matter
 *  to the cases in this suite. */
class DOMPoint {
  x: number
  y: number
  z: number
  w: number
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }
}

function notEquals(actual: unknown, expected: unknown, ...messages: string[]): void {
  if (Object.is(actual, expected)) {
    throw new Error(`assert_not_equals(${messages.join(" ")}): both are ${String(actual)}`)
  }
}

function approxEquals(actual: number, expected: number, epsilon: number, ...messages: string[]): void {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(
      `assert_approx_equals(${messages.join(" ")}): got ${actual}, expected ${expected} ±${epsilon}`,
    )
  }
}

function runCase(testCase: WptCase): void {
  const { ctx, canvas } = makeCanvas(testCase.size?.[0] ?? 100, testCase.size?.[1] ?? 50)
  const document = {
    getElementById(id: string) {
      if (id === "c") return canvas
      throw new Error(`no element #${id} in the headless harness`)
    },
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`createElement(${tag}) not supported in the headless harness`)
      return makeCanvas().canvas
    },
  }
  const window = {
    CanvasRenderingContext2D: Context2D,
    ImageData: GpuixImageData,
    DOMPoint,
    Uint8ClampedArray,
  }
  const t = {
    done() {},
    step_func(fn: () => void) {
      return fn
    },
    step_func_done(fn?: () => void) {
      return () => fn?.()
    },
  }
  const assert = makeAssert()
  const body = new Function(
    "canvas",
    "ctx",
    "window",
    "document",
    "t",
    "defer_test",
    "step_timeout",
    "assert",
    "_assertPixel",
    "_assertPixelApprox",
    "assert_throws_js",
    "_assertSame",
    "_assertDifferent",
    "CanvasRenderingContext2D",
    "ImageData",
    "DOMPoint",
    "assert_not_equals",
    "assert_approx_equals",
    "self",
    testCase.code,
  )
  body(
    canvas,
    ctx,
    window,
    document,
    t,
    () => {},
    () => {},
    assert,
    (c: typeof canvas, x: number, y: number, ...rgba: number[]) =>
      assertPixel(c, x, y, rgba[0]!, rgba[1]!, rgba[2]!, rgba[3]!),
    (c: typeof canvas, x: number, y: number, ...rest: number[]) => {
      const tol = rest.length > 4 ? rest[4]! : PIXEL_TOLERANCE
      assertPixel(c, x, y, rest[0]!, rest[1]!, rest[2]!, rest[3]!, tol)
    },
    (type: new () => Error, fn: () => unknown) => assert.throws(fn, type),
    same,
    different,
    Context2D,
    GpuixImageData,
    DOMPoint,
    notEquals,
    approxEquals,
    window,
  )
  if (testCase.expected && !/_assertPixel/.test(testCase.code) && ctx.stats.drawCount > 0) {
    assertExpectedColor(ctx, testCase.expected)
  }
}

describe("WPT canvas conformance (pure rasterizer)", () => {
  for (const testCase of CASES) {
    const testName = `${testCase.suite}/${testCase.name}`

    if (testCase.unconvertible) {
      it.skip(`${testName} — unconverted: ${testCase.unconvertible}`)
      continue
    }
    if (testCase.requires.length > 0) {
      it.skip(`${testName} — needs ${testCase.requires.join(", ")}`)
      continue
    }

    const gap = KNOWN_GAPS[testCase.id]
    const define = gap ? it.fails : it
    define(testName, () => {
      try {
        runCase(testCase)
      } catch (error) {
        report(testCase.id, gap ? `known gap: ${gap}` : messageOf(error))
        throw error
      }
    })
  }
})
