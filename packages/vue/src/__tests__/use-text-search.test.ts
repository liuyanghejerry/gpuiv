/// Unit tests for the find-bar hook: reported vs supplied match counts, the
/// read-time clamped cursor, and wrap-around navigation. The hook owns only
/// refs and computeds, so it runs standalone without a component or renderer.
/// The matcher half mirrors the same contract the native `matches_in` carries.

import { describe, expect, it } from "vitest"
import type { EventPayload } from "@gpuiv/native"
import { findRanges, useTextSearch } from "../hooks/use-text-search.js"

function reportCount(search: ReturnType<typeof useTextSearch>, matchCount: number): void {
  search.props.value.onHighlight({ matchCount } as EventPayload)
}

describe("useTextSearch", () => {
  it("starts empty: no highlight spec, zero total, zero cursor", () => {
    const search = useTextSearch({ query: "" })
    expect(search.props.value.highlight).toBeNull()
    expect(search.total.value).toBe(0)
    expect(search.active.value).toBe(0)
    search.next()
    search.previous()
    search.goTo(0)
    expect(search.active.value).toBe(0)
  })

  it("counts what native reports through onHighlight and moves the cursor", () => {
    const search = useTextSearch({ query: "needle" })
    expect(search.props.value.highlight).toEqual({
      query: "needle",
      caseSensitive: undefined,
      wholeWord: undefined,
      color: undefined,
      activeColor: undefined,
      radius: undefined,
      activeIndex: 0,
      matchIndexOffset: undefined,
    })

    reportCount(search, 3)
    expect(search.total.value).toBe(3)

    search.next()
    expect(search.active.value).toBe(1)
    search.next()
    expect(search.active.value).toBe(2)
    // Wraps past the last match.
    search.next()
    expect(search.active.value).toBe(0)
    // And backwards past the first.
    search.previous()
    expect(search.active.value).toBe(2)

    search.goTo(1)
    expect(search.active.value).toBe(1)
    // Out-of-range jumps are ignored.
    search.goTo(3)
    search.goTo(-1)
    expect(search.active.value).toBe(1)
  })

  it("clamps a stale cursor at read time instead of painting a wrong match", () => {
    const search = useTextSearch({ query: "n" })
    reportCount(search, 5)
    search.goTo(4)
    expect(search.active.value).toBe(4)

    // The count shrinks below the cursor; the cursor itself is untouched.
    reportCount(search, 2)
    expect(search.active.value).toBe(1)
    expect(search.props.value.highlight!.activeIndex).toBe(1)

    // Navigation resumes from the clamped position, not the stale one.
    search.next()
    expect(search.active.value).toBe(0)
    search.previous()
    expect(search.active.value).toBe(1)
  })

  it("prefers supplied window bookkeeping over the reported window count", () => {
    const search = useTextSearch({
      query: "n",
      caseSensitive: true,
      wholeWord: true,
      color: "#ff0",
      activeColor: "#f80",
      radius: 2,
      matches: { total: 10, indexOffset: 4 },
    })
    reportCount(search, 3)
    expect(search.total.value).toBe(10)
    expect(search.active.value).toBe(0)

    search.goTo(9)
    expect(search.active.value).toBe(9)
    // The spec carries both the options and the offset above the window.
    expect(search.props.value.highlight).toEqual({
      query: "n",
      caseSensitive: true,
      wholeWord: true,
      color: "#ff0",
      activeColor: "#f80",
      radius: 2,
      activeIndex: 9,
      matchIndexOffset: 4,
    })

    // An empty query paints nothing, even with matches supplied.
    const emptied = useTextSearch({ query: "", matches: { total: 10, indexOffset: 4 } })
    expect(emptied.total.value).toBe(0)
    expect(emptied.props.value.highlight).toBeNull()
  })

  it("drops to zero when the query empties after matches were reported", () => {
    const search = useTextSearch({ query: "needle" })
    reportCount(search, 3)
    search.goTo(2)
    expect(search.total.value).toBe(3)

    const cleared = useTextSearch({ query: "" })
    expect(cleared.total.value).toBe(0)
    expect(cleared.active.value).toBe(0)
  })
})

describe("findRanges", () => {
  it("returns nothing for an empty query and matches leftmost, non-overlapping", () => {
    expect(findRanges({ text: "anything", query: "" })).toEqual([])
    expect(findRanges({ text: "aaa", query: "aa" })).toEqual([[0, 2]])
    expect(findRanges({ text: "abcabc", query: "bc" })).toEqual([
      [1, 3],
      [4, 6],
    ])
  })

  it("lowercases by default and honors case sensitivity when asked", () => {
    expect(findRanges({ text: "Hello hello", query: "hello" })).toEqual([
      [0, 5],
      [6, 11],
    ])
    expect(findRanges({ text: "Hello hello", query: "hello", caseSensitive: true })).toEqual([
      [6, 11],
    ])
  })

  it("treats letters, digits, marks, and underscore as word characters for wholeWord", () => {
    expect(findRanges({ text: "cat category cats", query: "cat", wholeWord: true })).toEqual([
      [0, 3],
    ])
    // Underscores and digits extend the word on both sides.
    expect(findRanges({ text: "_cat cat1 cat", query: "cat", wholeWord: true })).toEqual([
      [10, 13],
    ])
    // Without wholeWord every occurrence matches.
    expect(findRanges({ text: "cat category cats", query: "cat" })).toEqual([
      [0, 3],
      [4, 7],
      [13, 16],
    ])
  })

  it("maps a hit inside a lowercase expansion back to its whole source character", () => {
    // "İ" (U+0130) lowercases to two units ("i" + combining dot), shifting
    // folded indices; the match still reports the single source character.
    expect(findRanges({ text: "\u0130stanbul", query: "i" })).toEqual([[0, 1]])
    expect(findRanges({ text: "\u0130\u0130", query: "i" })).toEqual([
      [0, 1],
      [1, 2],
    ])
  })

  it("reads whole code points at word boundaries, including astral ones", () => {
    // Astral letters are single word characters on both sides.
    expect(findRanges({ text: "\ud835\udc00b", query: "b", wholeWord: true })).toEqual([])
    expect(findRanges({ text: "b\ud835\udc00", query: "b", wholeWord: true })).toEqual([])
    // A combining mark keeps a decomposed letter inside the word: "e" alone is
    // no longer a whole word in "é" written as e + U+0301.
    expect(findRanges({ text: "e\u0301", query: "e", wholeWord: true })).toEqual([])
    expect(findRanges({ text: "e\u0301", query: "e" })).toEqual([[0, 1]])
    // Plain boundaries at both ends of the text still match.
    expect(findRanges({ text: "ab", query: "ab", wholeWord: true })).toEqual([[0, 2]])
  })

  it("returns UTF-16 ranges for astral needles", () => {
    expect(findRanges({ text: "x\ud835\udc00y\ud835\udc00", query: "\ud835\udc00" })).toEqual([
      [1, 3],
      [4, 6],
    ])
  })
})
