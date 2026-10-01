import { computed, defineComponent, h, shallowRef, watch, type PropType } from "vue"
import { createAnsiParser, parseAnsi, type AnsiOptions } from "../ansi.js"
import type { TextRun, StyleDesc } from "../types.js"
import { VirtualList, type VirtualListInstance } from "./virtual-list.js"

const optionsProp = { type: Object as PropType<AnsiOptions>, default: undefined }

/** Selectable ANSI text for a short output block; creates no scroll parent. */
export const AnsiText = defineComponent({
  name: "AnsiText",
  inheritAttrs: false,
  props: { source: { type: String, required: true }, options: optionsProp },
  setup(props, { attrs }) {
    const runs = computed(() => parseAnsi(props.source, props.options))
    return () => h("text", { ...attrs, runs: runs.value })
  },
})

/** Windowed, selectable log rows. Appends decode only the new source suffix;
 * replacement sources and palette changes reset the parser. */
export const AnsiLog = defineComponent({
  name: "AnsiLog",
  inheritAttrs: false,
  props: {
    source: { type: String, required: true },
    options: optionsProp,
    lineHeight: { type: Number, default: 20 },
    followTail: { type: Boolean, default: true },
    overdraw: { type: Number, default: 240 },
  },
  setup(props, { attrs, expose }) {
    const rows = shallowRef<TextRun[][]>([[]])
    const list = shallowRef<VirtualListInstance | null>(null)
    let parser = createAnsiParser(props.options)
    let previous = ""

    watch(() => [props.source, JSON.stringify(props.options)] as const, ([source, optionsKey], old) => {
      const append = old && optionsKey === old[1] && source.startsWith(previous)
      if (!append) { parser = createAnsiParser(props.options); rows.value = [[]]; previous = "" }
      const decoded = parser.write(source.slice(previous.length))
      previous = source
      if (!decoded.length) return
      const next = rows.value.slice()
      next[next.length - 1] = [...next[next.length - 1]]
      for (const run of decoded) {
        const parts = run.text.split("\n")
        parts.forEach((text, index) => {
          if (index) next.push([])
          if (text) {
            const row = next[next.length - 1]
            const last = row[row.length - 1]
            const { text: _text, ...style } = run
            const { text: _lastText, ...lastStyle } = last ?? { text: "" }
            if (last && JSON.stringify(style) === JSON.stringify(lastStyle)) row[row.length - 1] = { ...last, text: last.text + text }
            else row.push({ ...run, text })
          }
        })
      }
      rows.value = next
    }, { immediate: true, flush: "sync" })

    expose({
      id: computed(() => list.value?.id),
      scrollToItem: (index: number, offset?: number) => list.value?.scrollToItem(index, offset),
      getListScrollTop: () => list.value?.getListScrollTop() ?? null,
    })
    return () => {
      if (!Number.isFinite(props.lineHeight) || props.lineHeight <= 0) throw new Error("AnsiLog lineHeight must be positive and finite")
      const { style: _style, ...listAttrs } = attrs
      const surface: StyleDesc = { height: 240, flexShrink: 0, fontFamily: "Menlo", fontSize: 13,
        color: props.options?.foreground ?? "#d4d4d4", backgroundColor: props.options?.background ?? "#1e1e1e",
        ...(attrs.style as StyleDesc) }
      // The div paints the surface. GPUI list rows are rendered by a processor
      // outside the parent's text-style scope, so set row typography directly.
      return h("div", { style: surface }, h(VirtualList, {
        ...listAttrs,
        ref: list,
        role: "log",
        "aria-label": attrs["aria-label"] ?? "Output log",
        style: { width: "100%", height: "100%", minHeight: 0 },
        itemCount: rows.value.length,
        estimatedItemHeight: props.lineHeight,
        followTail: props.followTail,
        overdraw: props.overdraw,
        renderItem: (index: number) => h("div", { key: index, style: { height: props.lineHeight, flexShrink: 0, overflow: "hidden" } },
          h("text", { runs: rows.value[index], style: { fontFamily: surface.fontFamily, fontSize: surface.fontSize,
            whiteSpace: "nowrap", lineHeight: props.lineHeight } })),
      }))
    }
  },
})
