/** Unit tests for the HMR source transform — pure text surgery, no GPU. */

import { describe, expect, it } from "vitest"
import { fnv1a, transformHmrSource } from "../hmr/transform.js"

const FILE = "/repo/examples/app.tsx"

function transform(source: string): string {
  return transformHmrSource(source, FILE)
}

describe("transformHmrSource", () => {
  it("injects preamble and registration around a single component", () => {
    const source = [
      'import { defineComponent, h } from "vue"',
      "",
      "const Counter = defineComponent({",
      "  setup: () => () => h(\"div\", \"hi\"),",
      "})",
      "",
    ].join("\n")
    const out = transform(source)
    expect(out).toContain(
      'import { __gpuivHmrFile, __gpuivHmrComponent } from "@gpuiv/vue/hmr"'
    )
    expect(out).toContain(`;__gpuivHmrFile(${JSON.stringify(FILE)}, `)
    const id = `${fnv1a(FILE)}_Counter`
    expect(out).toContain(`;Counter.__hmrId = ${JSON.stringify(id)}`)
    expect(out).toContain(
      `;__gpuivHmrComponent(${JSON.stringify(FILE)}, ${JSON.stringify(id)}, Counter, `
    )
    // The original statement survives verbatim.
    expect(out).toContain("const Counter = defineComponent({")
  })

  it("handles export const and multiple components", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "export const A = defineComponent({ setup: () => () => null })",
      "const B = defineComponent({ setup: () => () => null })",
    ].join("\n")
    const out = transform(source)
    expect(out).toContain(";A.__hmrId =")
    expect(out).toContain(";B.__hmrId =")
    expect(out.match(/__gpuivHmrComponent\(/g)).toHaveLength(2)
  })

  it("returns the source unchanged when there are no components", () => {
    const source = 'export const answer = 42\n'
    expect(transform(source)).toBe(source)
  })

  it("ignores defineComponent nested in a function", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "function make() {",
      "  return defineComponent({ setup: () => () => null })",
      "}",
    ].join("\n")
    expect(transform(source)).toBe(source)
  })

  it("survives JSX text with apostrophes, quotes, and braces", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const View = defineComponent({",
      "  setup: () => () => (",
      "    <div>",
      "      <text>Don't {notCode} \"quoted\" } (</text>",
      "      <text>{'it works'}</text>",
      "    </div>",
      "  ),",
      "})",
    ].join("\n")
    const out = transform(source)
    expect(out).not.toBe(source)
    expect(out).toContain(";View.__hmrId =")
  })

  it("survives regex literals containing brackets", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const View = defineComponent({",
      "  setup() {",
      "    const re = /[({\\[]/g",
      "    return () => <div>{re.test('x') ? 'y' : 'n'}</div>",
      "  },",
      "})",
    ].join("\n")
    const out = transform(source)
    expect(out).not.toBe(source)
    expect(out).toContain(";View.__hmrId =")
  })

  it("survives nested template literals", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const View = defineComponent({",
      "  setup() {",
      "    const s = `outer ${`inner ${1 + 2}`} { not code }`",
      "    return () => <div>{s}</div>",
      "  },",
      "})",
    ].join("\n")
    const out = transform(source)
    expect(out).not.toBe(source)
    expect(out).toContain(";View.__hmrId =")
  })

  it("survives comments with brackets and defineComponent mentions", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "// const Fake = defineComponent({ (",
      "/* block { ( ) */",
      "const Real = defineComponent({ setup: () => () => null })",
    ].join("\n")
    const out = transform(source)
    expect(out).toContain(";Real.__hmrId =")
    expect(out).not.toContain(";Fake.__hmrId =")
    expect(out.match(/__gpuivHmrComponent\(/g)).toHaveLength(1)
  })

  it("does not treat comparisons as JSX", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const small = a < b",
      "const View = defineComponent({ setup: () => () => null })",
    ].join("\n")
    const out = transform(source)
    expect(out).toContain(";View.__hmrId =")
  })

  it("handles call type arguments on defineComponent", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const View = defineComponent<{ foo: string }>({",
      "  setup: () => () => null,",
      "})",
    ].join("\n")
    const out = transform(source)
    expect(out).toContain(";View.__hmrId =")
  })

  it("returns unbalanced source unchanged", () => {
    const source = "const View = defineComponent({ setup: () => () => null }"
    expect(transform(source)).toBe(source)
  })

  it("declines tails that would leave the injected registration mid-expression", () => {
    const component = "defineComponent({ setup: () => () => null })"
    const tails = [
      `const A = ${component} satisfies unknown`,
      `const A = ${component} as unknown`,
      `const A = ${component}, B = ${component}`,
      `const A = ${component} || fallback`,
      `const A = ${component} ? a : b`,
      `export default ${component} as unknown`,
    ]
    for (const source of tails) {
      expect(transform(source)).toBe(source)
    }
  })

  it("declines the whole file when one statement has an unsupported tail", () => {
    const source = [
      'import { defineComponent } from "vue"',
      "const A = defineComponent({ setup: () => () => null })",
      "const B = defineComponent({ setup: () => () => null }) satisfies unknown",
    ].join("\n")
    expect(transform(source)).toBe(source)
  })

  it("still registers a semicolon-free file, whatever statement follows", () => {
    const statements = [
      "const A = defineComponent({ setup: () => () => null })\n",
      "const A = defineComponent({ setup: () => () => null })\nconst B = 1\n",
      "const A = defineComponent({ setup: () => () => null })\nexport default A\n",
      "const A = defineComponent({ setup: () => () => null })\ntype T = unknown\n",
      "const A = defineComponent({ setup: () => () => null })\nfunction helper() {}\n",
      "const A = defineComponent({ setup: () => () => null })\nif (A) console.log(A)\n",
      "const A = defineComponent({ setup: () => () => null });console.log(A)\n",
      "const A = defineComponent({ setup: () => () => null }).chain()\nconst B = 1\n",
      // The shape every app entry ends with: a call whose callee is an
      // identifier, which only a statement boundary can explain.
      "const A = defineComponent({ setup: () => () => null })\ncreateApp(A, { renderer })\n",
      "const A = defineComponent({ setup: () => () => null })\nconsole.log(A)\n",
    ]
    for (const source of statements) {
      expect(transform(source)).toContain(";A.__hmrId =")
      expect(transform(source)).toContain(";__gpuivHmrComponent(")
    }
  })

  it("declines expression tails that keep the statement open", () => {
    const component = "defineComponent({ setup: () => () => null })"
    const tails = [
      // `(` continues the expression: a call on the component definition.
      `const A = ${component}({})`,
      `const A = ${component}\n({})`,
      `const A = ${component}\n?? fallback`,
      `const A = ${component}\ninstanceof Other`,
    ]
    for (const source of tails) {
      expect(transform(source)).toBe(source)
    }
  })

  it("keeps a shebang first", () => {
    const source = "#!/usr/bin/env bun\nconst View = defineComponent({ setup: () => () => null })\n"
    const out = transform(source)
    expect(out.startsWith("#!/usr/bin/env bun\n")).toBe(true)
    expect(out).toContain(";View.__hmrId =")
  })

  it("changes only the edited component's statement hash", () => {
    const before = [
      'import { defineComponent } from "vue"',
      "const A = defineComponent({ setup: () => () => null })",
      "const B = defineComponent({ setup: () => () => null })",
    ].join("\n")
    const after = [
      'import { defineComponent } from "vue"',
      "const A = defineComponent({ setup: () => () => null })",
      "const B = defineComponent({ setup: () => () => 'edited' })",
    ].join("\n")
    const grab = (source: string) => {
      const out = transform(source)
      const body = /__gpuivHmrFile\("[^"]+", "([0-9a-f]+)"/.exec(out)![1]
      const hashes = [
        ...out.matchAll(/__gpuivHmrComponent\("[^"]+", "([0-9a-f]+_[AB])", [AB], "([0-9a-f]+)"\)/g),
      ].map((match) => [match[1], match[2]] as const)
      return { body, hashes: Object.fromEntries(hashes) }
    }
    const a = grab(before)
    const b = grab(after)
    expect(a.body).toBe(b.body) // module body outside the statements untouched
    expect(a.hashes[`${fnv1a(FILE)}_A`]).toBe(b.hashes[`${fnv1a(FILE)}_A`])
    expect(a.hashes[`${fnv1a(FILE)}_B`]).not.toBe(b.hashes[`${fnv1a(FILE)}_B`])
  })

  it("changes the body hash when module-level code changes", () => {
    const before = 'import { defineComponent } from "vue"\nconst THEME = "a"\nconst A = defineComponent({ setup: () => () => null })\n'
    const after = 'import { defineComponent } from "vue"\nconst THEME = "b"\nconst A = defineComponent({ setup: () => () => null })\n'
    const bodyOf = (source: string) =>
      /__gpuivHmrFile\("[^"]+", "([0-9a-f]+)"/.exec(transform(source))![1]
    expect(bodyOf(before)).not.toBe(bodyOf(after))
  })

  it("produces output that parses and runs end to end", async () => {
    const source = [
      'import { defineComponent, h } from "vue"',
      "",
      "export const Counter = defineComponent({",
      "  setup() {",
      "    return () => h(\"div\", \"hi\")",
      "  },",
      "})",
      "",
    ].join("\n")
    const out = transform(source)
    // Stub both imports (vue and the injected @gpuiv/vue/hmr): the remaining
    // module is plain ESM that must parse and execute.
    const stubbed = out
      .replace(
        'import { __gpuivHmrFile, __gpuivHmrComponent } from "@gpuiv/vue/hmr"',
        "const __gpuivHmrFile = () => {}\nconst __gpuivHmrComponent = () => {}"
      )
      .replace(
        'import { defineComponent, h } from "vue"',
        "const defineComponent = (def) => def\nconst h = () => null"
      )
    const mod = await import(
      `data:text/javascript;base64,${Buffer.from(stubbed).toString("base64")}`
    )
    expect(typeof mod.Counter).toBe("object")
    expect(mod.Counter.__hmrId).toBe(`${fnv1a(FILE)}_Counter`)
  })
})
