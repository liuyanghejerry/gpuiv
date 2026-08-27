/// GPU-backed tests for the text-search highlight: query resolution, paint
/// order, the find cursor, native elements, and the JS matcher parity.

import { defineComponent, ref } from "vue"
import { describe, expect, it } from "vitest"
import { findRanges, useTextSearch } from "../hooks/use-text-search.js"
import { createTestApp, hasNativeTestRenderer } from "../testing.js"
import type { EventPayload, HighlightMatch } from "@gpuiv/native"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

function textsOf(matches: HighlightMatch[]): string[] {
  return matches.map((m) => m.text.slice(m.start, m.end))
}

describeNative("text search highlight (vue)", () => {
  it("paints a wash per query match and reports the count", async () => {
    const counts = ref<number[]>([])
    const App = defineComponent({
      setup() {
        const search = useTextSearch({ query: "needle" })
        return () => (
          <div
            {...search.props.value}
            onHighlight={(event: EventPayload) => counts.value.push(event.matchCount ?? -1)}
            style={{ display: "flex", flexDirection: "column", padding: 20 }}
          >
            <text>one needle here</text>
            <text>no match at all</text>
            <text>another needle</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(textsOf(app.renderer.getPaintedHighlights())).toEqual(["needle", "needle"])
    expect(counts.value[counts.value.length - 1]).toBe(2)
    app.unmount()
  })

  it("moves the find cursor through next/previous", async () => {
    // The hook uses no lifecycle callbacks, so it can live at test scope and
    // the component closes over the same instance the test drives.
    const search = useTextSearch({ query: "needle" })
    const App = defineComponent({
      setup() {
        return () => (
          <div {...search.props.value} style={{ display: "flex", flexDirection: "column", padding: 20 }}>
            <text>needle one</text>
            <text>needle two</text>
            <text>needle three</text>
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    const matches = () => app.renderer.getPaintedHighlights()

    expect(matches().filter((m) => m.active)).toHaveLength(1)
    const firstActive = matches().find((m) => m.active)!
    expect(firstActive.text.slice(firstActive.start, firstActive.end)).toBe("needle")
    expect(firstActive.text.startsWith("needle one")).toBe(true)

    search.next()
    await app.settle()
    const secondActive = matches().find((m) => m.active)!
    expect(secondActive.text.startsWith("needle two")).toBe(true)

    search.previous()
    await app.settle()
    const back = matches().find((m) => m.active)!
    expect(back.text.startsWith("needle one")).toBe(true)
    app.unmount()
  })

  it("matches inside native <code> by query", async () => {
    // `<code>` builds its lines inside render(), so they never reach the
    // retained tree and onHighlight's count stays 0 — it counts retained text
    // only. The washes are matched against the exact painted string instead.
    const App = defineComponent({
      setup() {
        const search = useTextSearch({ query: "greet" })
        return () => (
          <div {...search.props.value} style={{ display: "flex", padding: 20 }}>
            <code code={"export function greet(name) {\n  return greet_inner(name)\n}"} language="ts" />
          </div>
        )
      },
    })
    const app = createTestApp(App)
    await app.settle()
    expect(textsOf(app.renderer.getPaintedHighlights())).toEqual(["greet", "greet"])
    app.unmount()
  })

  it("keeps the JS matcher in parity with the native one", () => {
    const text = "Needle nest: néedle here, NEEDLE there. one_needle_two"
    // é is not e, so "néedle" is not a match; the rest are.
    expect(findRanges({ text, query: "needle" })).toEqual([
      [0, 6],
      [26, 32],
      [44, 50],
    ])
    // wholeWord drops the underscore neighbours.
    expect(findRanges({ text, query: "needle", wholeWord: true })).toEqual([
      [0, 6],
      [26, 32],
    ])
    // Case-sensitive narrows to exact.
    expect(findRanges({ text, query: "NEEDLE", caseSensitive: true })).toEqual([[26, 32]])
  })
})
