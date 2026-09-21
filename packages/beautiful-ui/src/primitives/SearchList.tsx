/** SEARCH LIST — command search with live filtering.
 *
 *  Ported from beautiful-ui `components/primitives/SearchList.tsx`.
 *
 *  Platform degradations:
 *  - The web original hovers rows through GlideMenu, a getBoundingClientRect-
 *    driven highlight that glides between rows. GPUIV has no bounds query, so
 *    the highlight is per-row instead: a native `hover` background on every
 *    row, plus a component-state `activeIndex` (set by pointer enter and the
 *    arrow keys) that keeps the last-touched row tinted. The persistence
 *    matches GlideMenu; the glide itself is gone.
 *  - Keyboard navigation is added (the web original has none): ArrowUp /
 *    ArrowDown move the active row, Enter chooses it. GPUIV's single-line
 *    input consumes Enter as a native keybinding before `keyDown` reaches JS,
 *    so Enter is wired through `onSubmit`; the arrows are unbound natively on
 *    single-line inputs and arrive via `onKeyDown`.
 *  - CSS `transition-colors` on the input row is dropped (no CSS
 *    transitions); the hover background swaps instantly.
 *  - The clear button's `hover:text-ink` cannot tint the `<svg>` glyph from a
 *    parent — an `svg` element colours itself from its own `color` style — so
 *    the X stays `ink3` on hover.
 *  - The input placeholder colour is the native fixed grey; there is no
 *    `placeholder:text-ink-3` hook.
 *  - The original's unused `variant` prop is dropped.
 *
 *  Choosing a row (click or Enter) fills the query with the item — same as
 *  the original — and emits `select` with the item.
 */

import { computed, defineComponent, ref, watch, type PropType } from "vue"
import { motion, type EventPayload } from "@gpuiv/vue"
import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { withAlpha } from "../colors.js"
import { Icon } from "../atoms/Icon.js"

export type SearchItem = string

export interface SearchListLabels {
  placeholder: string
  ariaLabel: string
  emptyTitle: string
  emptyHint: string
}

const DEFAULT_ITEMS: SearchItem[] = [
  "Forecast summer demand",
  "Find waffle cone suppliers",
  "Compare seasonal flavors",
  "Draft flavor launch plan",
  "Check cold-chain status",
  "Audit sugar costs",
  "Retire low sellers",
]

const DEFAULT_LABELS: SearchListLabels = {
  placeholder: "Search flavors…",
  ariaLabel: "Search flavors",
  emptyTitle: "No results found",
  emptyHint: "Adjust your search to try again",
}

export const SearchList = defineComponent({
  name: "BuiSearchList",
  props: {
    items: { type: Array as PropType<SearchItem[]>, default: () => DEFAULT_ITEMS },
    labels: { type: Object as PropType<Partial<SearchListLabels>>, default: undefined },
  },
  emits: {
    /** A row was chosen, by click or by Enter on the active row. */
    select: (_item: SearchItem) => true,
  },
  setup(props, { emit }) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))
    const query = ref("")
    /** Keyboard/pointer-active row; -1 = none, the original's idle look. */
    const activeIndex = ref(-1)

    const results = computed(() =>
      query.value
        ? props.items.filter((item) => item.toLowerCase().includes(query.value.toLowerCase()))
        : props.items.slice(0, 5),
    )
    const empty = computed(() => query.value.length > 2 && results.value.length === 0)

    // A new result set drops the highlight; the next ArrowDown starts at the top.
    watch(results, () => {
      activeIndex.value = -1
    })

    function choose(item: SearchItem) {
      query.value = item
      emit("select", item)
    }

    function moveActive(delta: number) {
      const count = results.value.length
      if (count === 0) return
      activeIndex.value = Math.min(Math.max(activeIndex.value + delta, 0), count - 1)
    }

    function chooseActive() {
      const item = results.value[activeIndex.value >= 0 ? activeIndex.value : 0]
      if (item !== undefined) choose(item)
    }

    function onInputKeyDown(event: EventPayload) {
      if (event.key === "down") moveActive(1)
      else if (event.key === "up") moveActive(-1)
    }

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            minHeight: 248,
            width: "100%",
            maxWidth: 288,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              alignSelf: "flex-start",
              overflow: "hidden",
              borderRadius: radius.card,
              backgroundColor: t.surface,
              ...shadows.raised,
            }}
          >
            {/* input row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                flexShrink: 0,
                paddingLeft: 12,
                paddingRight: 12,
                borderBottomWidth: 1,
                borderColor: t.line,
                hover: { backgroundColor: t.hover },
              }}
            >
              <Icon name="search" size={14} color={t.ink3} />
              <input
                value={query.value}
                placeholder={copy.value.placeholder}
                aria-label={copy.value.ariaLabel}
                style={{ minWidth: 0, flexGrow: 1, height: 20, fontSize: 13, color: t.ink }}
                onChange={(event: EventPayload) => {
                  query.value = event.value ?? ""
                }}
                onKeyDown={onInputKeyDown}
                onSubmit={chooseActive}
              />
              {query.value.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: ease.outStrong }}
                >
                  <div
                    onClick={() => {
                      query.value = ""
                    }}
                    aria-label="Clear search"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: radius.pill,
                      cursor: "pointer",
                      hover: { backgroundColor: withAlpha(t.line, 0.7) },
                    }}
                  >
                    <Icon name="x" size={11} color={t.ink3} />
                  </div>
                </motion.div>
              )}
            </div>

            {/* results / empty state */}
            {empty.value ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: ease.outStrong }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  paddingLeft: 16,
                  paddingRight: 16,
                  paddingTop: 32,
                  paddingBottom: 32,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    marginBottom: 6,
                    borderRadius: radius.control,
                    backgroundColor: t.inset,
                    ...shadows.hairline,
                  }}
                >
                  <Icon name="search" size={15} color={t.ink3} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: t.ink }}>{copy.value.emptyTitle}</div>
                <div style={{ fontSize: 12, color: t.ink3 }}>{copy.value.emptyHint}</div>
              </motion.div>
            ) : (
              <div style={{ padding: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {results.value.map((item, i) => (
                    <motion.div
                      key={item}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: ease.outStrong }}
                    >
                      <div
                        onClick={() => choose(item)}
                        onMouseEnter={() => {
                          activeIndex.value = i
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: 32,
                          width: "100%",
                          borderRadius: 6,
                          paddingLeft: 8,
                          paddingRight: 8,
                          fontSize: 13,
                          color: t.ink,
                          cursor: "pointer",
                          backgroundColor: i === activeIndex.value ? t.hover : undefined,
                          hover: { backgroundColor: t.hover },
                        }}
                      >
                        {item}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )
    }
  },
})
