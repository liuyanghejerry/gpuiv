/// Headless logic tests for the ANSI output components: row splitting and
/// run merging on append, parser reset on replacement or palette change, the
/// painted surface style, prop validation, and the exposed list API.
/// Runs against the mock renderer (see headless.ts) so it works on Linux.

import { defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AnsiLog, AnsiText } from "../components/ansi-log.js"
import { mountHeadless, HeadlessRenderer } from "./headless.js"
import { createGpuivRendererHost } from "../reconciler/vue-renderer.js"
import { handleGpuixEvent, idAllocatorFor } from "../reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "../hooks/use-gpuix.js"
import type { EventPayload } from "@gpuiv/native"
import type { TextRun } from "../types.js"

type HeadlessApp = ReturnType<typeof mountHeadless>

function customProp<T = unknown>(
  renderer: HeadlessRenderer,
  id: number,
  key: string
): T | undefined {
  const ops = renderer.opsOf("setCustomProp").filter((op) => op[1] === id && op[2] === key)
  return ops.length ? (ops[ops.length - 1]![3] as T) : undefined
}

/** The windowed text elements the log currently keeps mounted, with their runs. */
function mountedRows(renderer: HeadlessRenderer): TextRun[][] {
  return renderer
    .opsOf("createElement")
    .filter((op) => op[2] === "text" && !renderer.destroyedIds.has(op[1] as number))
    .map((op) => customProp<TextRun[]>(renderer, op[1] as number, "runs") ?? [])
}

function listIdOf(renderer: HeadlessRenderer): number {
  const op = renderer.opsOf("createElement").find((o) => o[2] === "virtual-list")
  if (!op) throw new Error("no virtual-list element")
  return op[1] as number
}

function mountAnsiLog(props: Record<string, unknown>): HeadlessApp {
  return mountHeadless(
    defineComponent({
      setup: () => () => h(AnsiLog, { ...props }),
    })
  )
}

/** mountHeadless with an injected renderer subclass. */
function mountWithRenderer(
  component: unknown,
  renderer: HeadlessRenderer
): { renderer: HeadlessRenderer; settle: () => Promise<void>; unmount: () => void } {
  const host = createGpuivRendererHost(renderer, idAllocatorFor(renderer))
  const app = host.vue.createApp(component as never)
  app.provide(GPUIV_CONTEXT, { renderer })
  app.mount(host.container)
  host.flushMutations()
  return {
    renderer,
    settle: async () => {
      await nextTick()
      host.flushMutations()
    },
    unmount: () => {
      app.unmount()
      host.flushMutations()
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe("AnsiLog (headless)", () => {
  it("splits the source into rows and wires the virtual list", () => {
    const app = mountAnsiLog({ source: "first\nsecond" })
    const rows = mountedRows(app.renderer)
    expect(rows.map((runs) => runs[0]!.text)).toEqual(["first", "second"])

    const list = listIdOf(app.renderer)
    expect(customProp(app.renderer, list, "itemCount")).toBe(2)
    expect(customProp(app.renderer, list, "estimatedItemHeight")).toBe(20)
    expect(customProp(app.renderer, list, "overdraw")).toBe(240)
    expect(customProp(app.renderer, list, "followTail")).toBe(true)
    expect(customProp(app.renderer, list, "role")).toBe("log")
    expect(customProp(app.renderer, list, "aria-label")).toBe("Output log")

    // The row div clips at lineHeight; the row text carries the typography.
    const surface = app.renderer.parentOf(list)!
    const rowDiv = app.renderer.childrenOf(list)[0]!
    const rowText = app.renderer.childrenOf(rowDiv)[0]!
    expect(app.renderer.lastStyle(rowDiv)).toMatchObject({
      height: 20,
      overflow: "hidden",
      flexShrink: 0,
    })
    expect(app.renderer.lastStyle(rowText)).toMatchObject({
      fontFamily: "Menlo",
      fontSize: 13,
      lineHeight: 20,
      whiteSpace: "nowrap",
    })
    expect(app.renderer.lastStyle(surface)).toMatchObject({
      height: 240,
      flexShrink: 0,
      backgroundColor: "#1e1e1e",
      color: "#d4d4d4",
      fontFamily: "Menlo",
      fontSize: 13,
    })
    app.unmount()
  })

  it("decodes styled runs into separate text runs per row", () => {
    const app = mountAnsiLog({ source: "\x1b[31mred\x1b[0m plain" })
    const rows = mountedRows(app.renderer)
    expect(rows).toHaveLength(1)
    const [red, plain] = rows[0]!
    expect(red!.text).toBe("red")
    expect(red!.color).toBe("#cd0000")
    expect(plain!.text).toBe(" plain")
    expect(plain!.color).toBe("#d4d4d4")
    app.unmount()
  })

  it("appends decode only the new suffix and merge same-style runs", async () => {
    const source = ref("abc")
    const app = mountHeadless(
      defineComponent({ setup: () => () => h(AnsiLog, { source: source.value }) })
    )
    expect(mountedRows(app.renderer).map((runs) => runs[0]!.text)).toEqual(["abc"])

    source.value += "def"
    await app.settle()
    expect(mountedRows(app.renderer)).toHaveLength(1)
    expect(mountedRows(app.renderer)[0]).toHaveLength(1)
    expect(mountedRows(app.renderer)[0]![0]!.text).toBe("abcdef")

    // A differently-styled suffix never merges with the previous run.
    source.value += "\x1b[31mR\x1b[0m"
    await app.settle()
    const runs = mountedRows(app.renderer)[0]!
    expect(runs.map((run) => run.text)).toEqual(["abcdef", "R"])

    // A newline suffix opens a fresh row.
    source.value += "\nnext"
    await app.settle()
    expect(mountedRows(app.renderer).map((runs) => runs.map((run) => run.text).join(""))).toEqual([
      "abcdefR",
      "next",
    ])

    // A suffix that only opens a control sequence decodes nothing yet.
    source.value += "\x1b]"
    await app.settle()
    expect(mountedRows(app.renderer).map((runs) => runs.map((run) => run.text).join(""))).toEqual([
      "abcdefR",
      "next",
    ])
    app.unmount()
  })

  it("completes escape fragments split across appends", async () => {
    const source = ref("first\n\x1b[3")
    const app = mountHeadless(
      defineComponent({ setup: () => () => h(AnsiLog, { source: source.value }) })
    )
    source.value += "1mred\x1b[0m\nlast"
    await app.settle()
    const rows = mountedRows(app.renderer)
    expect(rows.map((runs) => runs.map((run) => run.text).join(""))).toEqual([
      "first",
      "red",
      "last",
    ])
    expect(rows[1]![0]!.color).toBe("#cd0000")
    expect(rows[1]![0]!.fontStyle).toBe("normal")
    app.unmount()
  })

  it("resets the parser when the source is replaced", async () => {
    const source = ref("hello world")
    const app = mountHeadless(
      defineComponent({ setup: () => () => h(AnsiLog, { source: source.value }) })
    )
    source.value = "xhello world"
    await app.settle()
    const rows = mountedRows(app.renderer)
    expect(rows).toHaveLength(1)
    expect(rows[0]![0]!.text).toBe("xhello world")
    app.unmount()
  })

  it("resets the parser when the palette options change", async () => {
    const source = ref("tinted")
    const options = ref<Record<string, unknown> | undefined>(undefined)
    const app = mountHeadless(
      defineComponent({
        setup: () => () => h(AnsiLog, { source: source.value, options: options.value }),
      })
    )
    expect(app.renderer.lastStyle(app.renderer.parentOf(listIdOf(app.renderer))!)).toMatchObject({
      backgroundColor: "#1e1e1e",
      color: "#d4d4d4",
    })

    options.value = { foreground: "#ffffff", background: "#000000" }
    await app.settle()
    const surface = app.renderer.parentOf(listIdOf(app.renderer))!
    expect(app.renderer.lastStyle(surface)).toMatchObject({
      backgroundColor: "#000000",
      color: "#ffffff",
    })
    // The reset re-decoded the whole source into the fresh parser.
    const rows = mountedRows(app.renderer)
    expect(rows[0]![0]!.text).toBe("tinted")
    expect(rows[0]![0]!.color).toBe("#ffffff")
    app.unmount()
  })

  it("lets attrs override the surface style and the aria label", () => {
    const app = mountAnsiLog({
      source: "x",
      style: { height: 100, backgroundColor: "#0a0a0a" },
      "aria-label": "Build output",
    })
    expect(app.renderer.lastStyle(app.renderer.parentOf(listIdOf(app.renderer))!)).toMatchObject({
      height: 100,
      backgroundColor: "#0a0a0a",
    })
    expect(customProp(app.renderer, listIdOf(app.renderer), "aria-label")).toBe("Build output")
    app.unmount()
  })

  it("windows from the tail by default and from the top with followTail off", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `l${index}`).join("\n")
    const tail = mountAnsiLog({ source: lines })
    expect(customProp(tail.renderer, listIdOf(tail.renderer), "windowStart")).toBe(36)
    const texts = mountedRows(tail.renderer).map((runs) => runs[0]!.text)
    expect(texts[0]).toBe("l36")
    expect(texts.at(-1)).toBe("l99")
    tail.unmount()

    const head = mountAnsiLog({ source: lines, followTail: false })
    expect(customProp(head.renderer, listIdOf(head.renderer), "followTail")).toBe(false)
    expect(mountedRows(head.renderer).map((runs) => runs[0]!.text)[0]).toBe("l0")
    head.unmount()
  })

  it("rejects a zero or non-finite lineHeight", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => mountAnsiLog({ source: "x", lineHeight: 0 })).toThrow(
      /lineHeight must be positive and finite/
    )
    expect(() => mountAnsiLog({ source: "x", lineHeight: Number.NaN })).toThrow(
      /lineHeight must be positive and finite/
    )
    consoleWarn.mockRestore()
    consoleError.mockRestore()
  })

  it("exposes the list id, scroll anchor, and scrollToItem delegation", async () => {
    class ScrollRecorder extends HeadlessRenderer {
      scrolls: Array<[number, number, number | undefined]> = []
      scrollToItem(elementId: number, index: number, offsetInItem?: number): void {
        this.scrolls.push([elementId, index, offsetInItem])
      }
    }
    const renderer = new ScrollRecorder()
    const list = ref<unknown>(null)
    const mounted = mountWithRenderer(
      defineComponent({
        setup: () => () => h(AnsiLog, { ref: list, source: "a\nb\nc" }),
      }),
      renderer
    )
    const instance = list.value as {
      id: number | undefined
      getListScrollTop: () => unknown
      scrollToItem: (index: number, offset?: number) => void
    }
    expect(instance.id).toBe(listIdOf(renderer))
    expect(instance.getListScrollTop()).toBeNull()

    renderer.scrollOffsets.set(instance.id!, [0, 0, 800])
    expect(instance.getListScrollTop()).toEqual({
      itemIndex: 0,
      offsetInItem: 0,
      viewportHeight: 800,
      atEnd: false,
    })

    instance.scrollToItem(2, -12)
    expect(renderer.scrolls).toEqual([[instance.id!, 2, -12]])
    mounted.unmount()
  })
})

describe("AnsiText (headless)", () => {
  it("renders the whole decoded string as runs on one text element", () => {
    const app = mountHeadless(
      defineComponent({
        setup: () => () => (
          <AnsiText source={"\x1b[1;31mError\x1b[0m: 你好"} style={{ fontSize: 16 }} />
        ),
      })
    )
    const textElement = app.renderer.opsOf("createElement").find((op) => op[2] === "text")
    expect(textElement).toBeDefined()
    const id = textElement![1] as number
    const runs = customProp<TextRun[]>(app.renderer, id, "runs")!
    expect(runs.map((run) => run.text)).toEqual(["Error", ": 你好"])
    expect(runs[0]).toMatchObject({ color: "#cd0000", fontWeight: 700 })
    expect(runs[1]).toMatchObject({ color: "#d4d4d4", fontWeight: 400 })
    expect(app.renderer.lastStyle(id)).toMatchObject({ fontSize: 16 })
    app.unmount()
  })

  it("re-parses when the source prop changes", async () => {
    const source = ref("one")
    const app = mountHeadless(
      defineComponent({ setup: () => () => <AnsiText source={source.value} /> })
    )
    const runsOf = () => {
      const op = app.renderer.opsOf("createElement").find((o) => o[2] === "text")
      return customProp<TextRun[]>(app.renderer, op![1] as number, "runs")!
    }
    expect(runsOf().map((run) => run.text)).toEqual(["one"])
    source.value = "\x1b[32mtwo\x1b[0m"
    await app.settle()
    expect(runsOf().map((run) => run.text)).toEqual(["two"])
    expect(runsOf()[0]!.color).toBe("#00cd00")
    app.unmount()
  })
})
