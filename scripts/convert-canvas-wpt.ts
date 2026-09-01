/// Convert the vendored W3C web-platform-tests canvas YAML into the JSON
/// case table the vitest runner (`packages/vue/src/__tests__/canvas-wpt.test.ts`)
/// consumes. The assertion-comment grammar (`@assert …`, `@nonfinite …`) is the
/// one WPT's gentest.py defines; the rewrite rules below follow the same
/// sequence as Automattic/node-canvas's `test/wpt/generate.js` port.
///
/// Run after dropping updated YAML files into packages/vue/wpt/yaml/:
///
///   bun scripts/convert-canvas-wpt.ts
///
/// The generated JSON is committed so the test suite never needs a YAML
/// parser or network access.

import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const YAML_DIR = path.join(ROOT, "packages/vue/wpt/yaml")
const OUT_FILE = path.join(ROOT, "packages/vue/wpt/generated/canvas-wpt.json")

/** One converted test case, as consumed by the runner. */
interface WptCase {
  /** Stable id: `<yaml stem>/<test name>`. */
  id: string
  name: string
  suite: string
  desc: string
  /** JS body with every `@assert` / `@nonfinite` line rewritten to calls. */
  code: string
  /** Expected whole-canvas color name from the YAML, when present. */
  expected: string | null
  /** Canvas size override from the YAML `size:` field; WPT's default is 100×50. */
  size: [number, number] | null
  /** APIs the case touches that our context does not implement yet. */
  requires: string[]
  /** Why the case could not be converted at all, if it could not. */
  unconvertible: string | null
}

/** API tokens our CanvasRenderingContext2D port does not provide. */
const MISSING_API: Array<[string, RegExp]> = [
  ["Path2D", /\bPath2D\b/],
  ["createPattern", /\.createPattern\b/],
  ["conic gradients", /createConicGradient/],
  [
    "text drawing",
    /\bfillText\b|\bstrokeText\b|\bmeasureText\b|TextMetrics|\.font\b|\.textAlign\b|\.textBaseline\b|\.direction\b|\.letterSpacing\b|\.wordSpacing\b|\.fontKerning\b|\.fontStretch\b|\.fontVariantCaps\b/,
  ],
  ["shadows", /\.shadow(?:Blur|OffsetX|OffsetY|Color)\b/],
  ["filters", /\.filter\b/],
  ["image element sources", /\bnew Image\b|createImageBitmap|decode\(\)/],
  ["getContextAttributes", /\.getContextAttributes\b/],
  ["isPointInStroke", /\.isPointInStroke\b/],
  ["OffscreenCanvas", /OffscreenCanvas|transferControlToOffscreen/],
  ["async test driver", /\basync_test\b|\bpromise_test\b|\bstep_timeout\b|\bsetTimeout\b|\brequestAnimationFrame\b/],
  [
    "HTML canvas attributes",
    /\.(get|set|remove)Attribute\b|getComputedStyle|document\.body|document\.fonts/,
  ],
  // The bitmap is allocated eagerly on resize; a 2^31-1 canvas would OOM the
  // suite where a DOM canvas would defer the allocation.
  ["oversized canvas allocation", /2147483647|4294967295/],
  // CSS Typed OM color values and modern color functions.
  ["CSS color objects (CSSRGB/CSSHSL)", /\bCSSRGB\b|\bCSSHSL\b|\bCSSColor\b/],
  ["color-mix / relative color functions", /color-mix\(|rgb\(from|hsl\(from|lab\(from|oklch\(from|color\(from/],
  ["non-sRGB color spaces", /display-p3|color\((?!srgb)[a-z]/],
  ["float16 pixel format", /rgba-float16|pixelFormat/],
]

/** WPT escapes line folding inside literal blocks with `\-`; the continuation
 *  joins onto the previous line (a comment splitting across two lines would
 *  otherwise turn into a syntax error). */
function unfoldLineEscapes(code: string): string {
  return code.replace(/\\-\s*\n\s*/g, " ")
}

/** `<a b c>, <d e f>` nonfinite-argument lists → one call per combination. */
function expandNonfinite(method: string, argstr: string, tail: string): string {
  const args: string[][] = []
  for (const arg of argstr.split(", ")) {
    const match = arg.match(/<(.*)>/)
    if (!match) throw new Error(`bad nonfinite arg: ${arg}`)
    args.push(match[1]!.split(" "))
  }
  const calls: string[][] = []
  const base: string[] = []
  for (const alternatives of args) base.push(alternatives[0]!)
  for (let i = 0; i < args.length; i++) {
    for (let j = 1; j < args[i]!.length; j++) {
      const call = [...base]
      call[i] = args[i]![j]!
      calls.push(call)
    }
  }
  const combinations = (current: string[], start: number, depth: number): void => {
    for (let i = start; i < args.length; i++) {
      if (args[i]!.length > 1) {
        const next = [...current]
        next[i] = args[i]![1]!
        if (depth > 0) calls.push(next)
        combinations(next, i + 1, depth + 1)
      }
    }
  }
  combinations(base, 0, 0)
  return calls.map((call) => `${method}(${call.join(", ")})${tail}`).join("\n")
}

function escapeForStringLiteral(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

/** Rewrite `@assert` / `@nonfinite` pseudo-lines in a YAML code block into
 * executable assertion calls. Returns null (with a reason) when a construct
 * outside the grammar remains. */
function convertCode(code: string): { code: string; leftover: string | null } {
  let out = unfoldLineEscapes(code).trim().replace(/^/gm, "\t\t")

  out = out.replace(/@nonfinite ([^(]+)\(([^)]+)\)(.*)/g, (_m, method: string, args: string, tail: string) =>
    expandNonfinite(method, args, tail),
  )
  out = out.replace(/@assert pixel (\d+,\d+) == (\d+,\d+,\d+,\d+);/g, "_assertPixel(canvas, $1, $2);")
  out = out.replace(/@assert pixel (\d+,\d+) ==~ (\d+,\d+,\d+,\d+);/g, "_assertPixelApprox(canvas, $1, $2);")
  out = out.replace(/@assert pixel (\d+,\d+) ==~ (\d+,\d+,\d+,\d+) \+\/- (\d+);/g, "_assertPixelApprox(canvas, $1, $2, $3);")
  out = out.replace(/@assert throws (\S+_ERR) (.*);/g, 'assert.throws(function() { $2; }, /$1/);')
  out = out.replace(/@assert throws (\S+Error) (.*);/g, "assert.throws(function() { $2; }, $1);")
  out = out.replace(/@assert (.*) === (.*);/g, (_m, actual: string, expected: string) => {
    return `assert.strictEqual(${actual}, ${expected}, "${escapeForStringLiteral(actual)}", "${escapeForStringLiteral(expected)}")`
  })
  out = out.replace(/@assert (.*) !== (.*);/g, (_m, actual: string, expected: string) => {
    return `assert.notStrictEqual(${actual}, ${expected}, "${escapeForStringLiteral(actual)}", "${escapeForStringLiteral(expected)}");`
  })
  out = out.replace(/@assert (.*) =~ (.*);/g, "assert.match($1, $2);")
  out = out.replace(/@assert (.*);/g, (_m, actual: string) => `assert(${actual}, "${escapeForStringLiteral(actual)}");`)
  out = out.replace(/ @moz-todo/g, "")

  const leftover = out.match(/@[a-zA-Z_.]+/)?.[0] ?? null
  return { code: out, leftover }
}

function missingApis(code: string): string[] {
  const labels = MISSING_API.filter(([, pattern]) => pattern.test(code)).map(([label]) => label)
  for (const match of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] !== "c") {
      labels.push(`extra DOM elements (#${match[1]})`)
      break
    }
  }
  return labels
}

const yamlFiles = fs
  .readdirSync(YAML_DIR)
  .filter((name) => name.endsWith(".yaml"))
  .sort()

const cases: WptCase[] = []
let unconvertible = 0

for (const fileName of yamlFiles) {
  const suite = fileName.replace(/\.yaml$/, "")
  const doc = Bun.YAML.parse(fs.readFileSync(path.join(YAML_DIR, fileName), "utf8"))

  // Every canvas YAML is a top-level array of test entries; a few files also
  // carry a `misc` header before the list.
  const tests: unknown[] = Array.isArray(doc) ? doc : (doc?.tests ?? [])
  if (!Array.isArray(tests)) throw new Error(`${fileName}: unexpected YAML shape`)

  for (const entry of tests) {
    const test = entry as Record<string, unknown>
    const name = typeof test.name === "string" ? test.name : null
    if (!name) continue
    const desc = typeof test.desc === "string" ? test.desc : ""
    const code = typeof test.code === "string" ? test.code : ""
    const expected = typeof test.expected === "string" ? test.expected : null
    const size = Array.isArray(test.size) && test.size.length === 2 ? ([test.size[0], test.size[1]] as [number, number]) : null

    // `canvas_types` restricts a case to canvas kinds; ours behaves like the
    // HTML canvas element, so anything not marked for it stays out.
    const canvasTypes = Array.isArray(test.canvas_types) ? (test.canvas_types as string[]) : null
    const wrongCanvasType = canvasTypes !== null && !canvasTypes.includes("HtmlCanvas")
      ? `canvas_types: ${canvasTypes.join(", ")}`
      : null

    // A few the-canvas cases are Jinja templates expanded per variant by
    // WPT's own tooling; without that expansion they are not JavaScript.
    const jinja = /\{\{|\{%|\{#/.test(code) ? "jinja template, needs variant expansion" : null

    if (!code.trim() || wrongCanvasType || jinja) {
      cases.push({
        id: `${suite}/${name}`,
        name,
        suite,
        desc,
        code: "",
        expected,
        size,
        requires: [],
        unconvertible: !code.trim() ? "no code block" : (wrongCanvasType ?? jinja),
      })
      unconvertible++
      continue
    }

    let converted: { code: string; leftover: string | null }
    try {
      converted = convertCode(code)
    } catch (error) {
      cases.push({
        id: `${suite}/${name}`,
        name,
        suite,
        desc,
        code: "",
        expected,
        size,
        requires: [],
        unconvertible: `conversion error: ${(error as Error).message}`,
      })
      unconvertible++
      continue
    }

    cases.push({
      id: `${suite}/${name}`,
      name,
      suite,
      desc,
      code: converted.code,
      expected,
      size,
      requires: converted.leftover ? [] : missingApis(converted.code),
      unconvertible: converted.leftover ? `unhandled assert syntax: ${converted.leftover}` : null,
    })
    if (converted.leftover) unconvertible++
  }
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify({ source: "w3c/web-platform-tests html/canvas/tools/yaml", cases }, null, 2) + "\n")

const runnable = cases.filter((c) => !c.unconvertible && c.requires.length === 0).length
const needsApi = cases.filter((c) => !c.unconvertible && c.requires.length > 0).length
console.log(
  `${cases.length} cases → ${runnable} runnable, ${needsApi} blocked on unimplemented APIs, ${unconvertible} unconvertible`,
)
