/** Pagination — ported from animal-island-vue Pagination.vue (MIT), #164.
 * Keeps paging/size/jump events and the original transparent circular buttons.
 * Colour transitions are immediate. Page-size selection reuses the native
 * anchored Select; its popup opens to the right rather than the web menu's top.
 * Native input needs valueRevision when rejecting non-digit edits.
 */

import { computed, defineComponent, ref, type PropType } from "vue"
import { type EventPayload, type StyleDesc } from "@gpuiv/vue"
import { borderWidth, colors, fontSize, fonts, radius, spacing } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { Select } from "./Select.js"

export type PaginationVariant = "orange" | "teal"

export interface PaginationProps {
  /** 数据总数 */
  total: number
  /** 当前页（受控，v-model:current） */
  current?: number
  /** 默认当前页 */
  defaultCurrent?: number
  /** 每页条数（受控，v-model:pageSize） */
  pageSize?: number
  /** 默认每页条数 */
  defaultPageSize?: number
  /** 是否显示每页条数切换器 */
  showSizeChanger?: boolean
  /** 可选的每页条数列表 */
  pageSizeOptions?: number[]
  /** 是否显示快速跳转输入框 */
  showQuickJumper?: boolean
  /** 是否显示总条数文本 */
  showTotal?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 配色：orange 琥珀橘（默认）/ teal 青 */
  variant?: PaginationVariant
}

type PageItem = number | "ellipsis-left" | "ellipsis-right"

/** 生成页码序列：首尾页 + 当前页邻域 + 省略号（照抄原版） */
function getPageItems(current: number, pageCount: number): PageItem[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const items: PageItem[] = [1]
  if (current > 3) items.push("ellipsis-left")
  const start = Math.max(2, current - 1)
  const end = Math.min(pageCount - 1, current + 1)
  for (let i = start; i <= end; i += 1) items.push(i)
  if (current < pageCount - 2) items.push("ellipsis-right")
  items.push(pageCount)
  return items
}

/* 组件局部色（取自原版 Less，tokens 无对应 token） */
const ITEM_BORDER = "#e8dcc8"
const TOTAL_COLOR = "#a09080"
const JUMPER_COLOR = "#8a7b66"
const JUMPER_DISABLED_BG = "#ece8dc"

interface VariantColors {
  /** 当前页实底 */
  activeBg: string
  /** 当前页 hover 实底 */
  activeHoverBg: string
  /** 非当前页 hover 底色 */
  hoverBg: string
  /** 非当前页 hover 描边色 */
  hoverBorder: string
  /** 非当前页 hover 字色 */
  hoverText: string
}

const variantColors: Record<PaginationVariant, VariantColors> = {
  orange: {
    activeBg: "#ffc107",
    activeHoverBg: "#ffb400",
    hoverBg: "#ffd54f",
    hoverBorder: "#ffc107",
    hoverText: colors.warmSoft,
  },
  teal: {
    activeBg: colors.primary,
    activeHoverBg: colors.primaryHover,
    hoverBg: colors.primaryBg,
    hoverBorder: colors.primary,
    hoverText: colors.primary,
  },
}

/** 原版内联的是 stroke=currentColor 的 chevron；GPUIV <svg> 是单色着色
 *  渲染器，笔画烘焙为 #000，墨色由 style.color 提供（同 Select.tsx）。 */
function chevronDataUrl(path: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="${path}" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`
}

const prevChevronUrl = chevronDataUrl("M15 5l-7 7 7 7")
const nextChevronUrl = chevronDataUrl("M9 5l7 7-7 7")

/** A native input only reads `caret` from its theme prop. */
const jumperTheme = { caret: colors.warmSoft }

export const Pagination = defineComponent({
  name: "AnimalPagination",
  inheritAttrs: false,
  props: {
    /** 数据总数 */
    total: { type: Number, required: true },
    /** 当前页（受控，v-model:current） */
    current: { type: Number as PropType<number | undefined>, default: undefined },
    /** 默认当前页（非受控） */
    defaultCurrent: { type: Number, default: 1 },
    /** 每页条数（受控，v-model:pageSize） */
    pageSize: { type: Number as PropType<number | undefined>, default: undefined },
    /** 默认每页条数（非受控） */
    defaultPageSize: { type: Number, default: 10 },
    /** 是否显示每页条数切换器 */
    showSizeChanger: { type: Boolean, default: false },
    /** 可选的每页条数列表 */
    pageSizeOptions: { type: Array as PropType<number[] | undefined>, default: undefined },
    /** 是否显示快速跳转输入框 */
    showQuickJumper: { type: Boolean, default: false },
    /** 是否显示总条数文本 */
    showTotal: { type: Boolean, default: false },
    /** 是否禁用 */
    disabled: { type: Boolean, default: false },
    /** 配色：orange 琥珀橘（默认）/ teal 青 */
    variant: { type: String as PropType<PaginationVariant>, default: "orange" },
    onChange: { type: Function as PropType<(page: number, pageSize: number) => void>, default: undefined },
    onShowSizeChange: { type: Function as PropType<(current: number, size: number) => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    // 内部状态：仅在非受控（未传对应 prop）时生效
    const innerPage = ref(props.defaultCurrent)
    const innerPageSize = ref(props.defaultPageSize)

    const pageSize = computed(() => props.pageSize ?? innerPageSize.value)
    const pageCount = computed(() => Math.max(1, Math.ceil(Math.max(0, props.total) / pageSize.value)))
    const page = computed(() => Math.min(props.current ?? innerPage.value, pageCount.value))
    const items = computed(() => getPageItems(page.value, pageCount.value))
    const sizeOptions = computed(() => props.pageSizeOptions ?? [10, 20, 50, 100])

    function changePage(next: number) {
      if (props.disabled) return
      const target = Math.min(Math.max(1, next), pageCount.value)
      if (target === page.value) return
      if (props.current === undefined) innerPage.value = target
      ;(attrs["onUpdate:current"] as ((page: number) => void) | undefined)?.(target)
      props.onChange?.(target, pageSize.value)
    }

    function changePageSize(size: number) {
      if (props.disabled) return
      const previousPage = page.value
      const previousSize = pageSize.value
      const nextPageCount = Math.max(1, Math.ceil(Math.max(0, props.total) / size))
      const targetPage = Math.min(page.value, nextPageCount)
      if (props.pageSize === undefined) innerPageSize.value = size
      if (props.current === undefined) innerPage.value = targetPage
      ;(attrs["onUpdate:pageSize"] as ((size: number) => void) | undefined)?.(size)
      ;(attrs["onUpdate:current"] as ((page: number) => void) | undefined)?.(targetPage)
      props.onShowSizeChange?.(targetPage, size)
      if (targetPage !== previousPage || size !== previousSize) props.onChange?.(targetPage, size)
    }

    // ---------- 快速跳转输入框：Enter 或失焦跳页 ----------
    const jumperText = ref("")
    /** Bumped whenever digit filtering rewrites the text, so the native editor
     *  takes the filtered value even when it equals the previous prop value. */
    const jumperRevision = ref(0)

    function handleJumperChange(e: EventPayload) {
      if (props.disabled) return
      const raw = e.value ?? ""
      const digits = raw.replace(/[^\d]/g, "")
      if (digits !== raw) jumperRevision.value++
      jumperText.value = digits
    }

    function jump() {
      if (props.disabled) return
      const target = parseInt(jumperText.value, 10)
      if (jumperText.value !== "") {
        jumperText.value = ""
        jumperRevision.value++
      }
      if (!Number.isNaN(target)) changePage(target)
    }

    const focusedKey = ref<string | null>(null)
    const jumperFocused = ref(false)

    return () => {
      const c = colors
      const v = variantColors[props.variant]
      // v-model listeners must not leak onto the host div as event props.
      const {
        "onUpdate:current": _currentListener,
        "onUpdate:pageSize": _pageSizeListener,
        ...forwardAttrs
      } = attrs

      const itemStyle = (opts: { active: boolean; itemDisabled: boolean; focusKey: string }): StyleDesc => {
        const style: StyleDesc = {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          flexShrink: 0,
          borderWidth: 0,
          borderRadius: radius.pill,
          fontSize: 13,
          lineHeight: 13,
          userSelect: "none",
        }
        if (opts.active) {
          style.backgroundColor = v.activeBg
          style.borderColor = v.activeBg
          style.color = "#ffffff"
          style.fontWeight = 700
          style.cursor = "default"
          if (!props.disabled) style.hover = { backgroundColor: v.activeHoverBg, borderColor: v.activeHoverBg }
        } else if (opts.itemDisabled) {
          style.backgroundColor = "transparent"
          // 原版禁用字色 #d4c9b4
          style.color = c.shadowSoft
          style.fontWeight = 500
          style.cursor = "not-allowed"
        } else {
          style.backgroundColor = "transparent"
          style.color = c.warmSoft
          style.fontWeight = 500
          style.cursor = "pointer"
          style.hover = { backgroundColor: v.hoverBg, color: v.hoverText }
        }
        if (focusedKey.value === opts.focusKey && !opts.itemDisabled) {
          style.outline = { width: 2, color: c.warning, offset: 2 }
        }
        return style
      }

      const renderEdgeButton = (dir: "prev" | "next") => {
        const atEdge = dir === "prev" ? page.value <= 1 : page.value >= pageCount.value
        const itemDisabled = props.disabled || atEdge
        const go = () => changePage(page.value + (dir === "prev" ? -1 : 1))
        return (
          <div
            key={dir}
            role="button"
            aria-label={dir === "prev" ? "上一页" : "下一页"}
            aria-disabled={itemDisabled || undefined}
            tabIndex={itemDisabled ? -1 : 0}
            onClick={itemDisabled ? undefined : go}
            onKeyDown={itemDisabled ? undefined : activationKeys(go)}
            onFocus={() => (focusedKey.value = dir)}
            onBlur={() => (focusedKey.value = null)}
            style={itemStyle({ active: false, itemDisabled, focusKey: dir })}
          >
            <svg
              aria-hidden={true}
              src={dir === "prev" ? prevChevronUrl : nextChevronUrl}
              style={{
                width: 14,
                height: 14,
                color: itemDisabled ? c.shadowSoft : c.warmSoft,
                pointerEvents: "none",
              }}
            />
          </div>
        )
      }

      const renderPageButton = (item: number) => {
        const isActive = item === page.value
        const focusKey = `page-${item}`
        const go = () => changePage(item)
        return (
          <div
            key={focusKey}
            role="button"
            aria-disabled={props.disabled || undefined}
            tabIndex={props.disabled ? -1 : 0}
            onClick={props.disabled ? undefined : go}
            onKeyDown={props.disabled ? undefined : activationKeys(go)}
            onFocus={() => (focusedKey.value = focusKey)}
            onBlur={() => (focusedKey.value = null)}
            style={itemStyle({ active: isActive, itemDisabled: props.disabled, focusKey })}
          >
            <text>{String(item)}</text>
          </div>
        )
      }

      const renderEllipsis = (kind: "ellipsis-left" | "ellipsis-right") => (
        <div
          key={kind}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 32,
            flexShrink: 0,
            color: c.textDisabled,
            fontSize: 13,
            fontWeight: 900,
            userSelect: "none",
          }}
        >
          <text>…</text>
        </div>
      )

      const navStyle: StyleDesc = {
        display: "flex",
        alignItems: "center",
        gap: 2,
        fontSize: fontSize.base,
        color: c.warmSoft,
        userSelect: "none",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(props.disabled ? { opacity: 0.6 } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      const jumperWrapStyle: StyleDesc = {
        display: "flex",
        alignItems: "center",
        width: 52,
        height: 32,
        flexShrink: 0,
        borderRadius: 50,
        backgroundColor: c.bgInput,
        ...(props.disabled ? { backgroundColor: JUMPER_DISABLED_BG, opacity: 0.5, cursor: "not-allowed" } : {}),
        ...(jumperFocused.value && !props.disabled ? { outline: { width: 2, color: c.warning, offset: 2 } } : {}),
      }

      const jumperInputStyle: StyleDesc = {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: 700,
        color: c.warmSoft,
        textAlign: "center",
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
      }
      if (props.disabled) jumperInputStyle.pointerEvents = "none"

      return (
        <div {...forwardAttrs} role="navigation" aria-label="分页" testId={props.testId} style={navStyle}>
          {props.showTotal ? (
            <text style={{ marginRight: 10, fontSize: 13, fontWeight: 600, color: TOTAL_COLOR, whiteSpace: "nowrap" }}>
              {`共 ${props.total} 条`}
            </text>
          ) : null}
          {renderEdgeButton("prev")}
          {items.value.map((item) => (typeof item === "number" ? renderPageButton(item) : renderEllipsis(item)))}
          {renderEdgeButton("next")}
          {props.showSizeChanger ? (
            <Select
              size="small"
              value={String(pageSize.value)}
              options={sizeOptions.value.map((n) => ({ key: String(n), label: `${n} 条/页` }))}
              disabled={props.disabled}
              ariaLabel={`每页 ${pageSize.value} 条`}
              onChange={(key: string) => {
                const n = Number(key)
                if (!Number.isNaN(n) && n !== pageSize.value) changePageSize(n)
              }}
              style={{ width: 140, marginLeft: spacing.sm }}
            />
          ) : null}
          {props.showQuickJumper ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginLeft: spacing.sm,
                flexShrink: 0,
                fontSize: 13,
                fontWeight: 500,
                color: JUMPER_COLOR,
                whiteSpace: "nowrap",
              }}
            >
              <text>跳至</text>
              <div style={jumperWrapStyle}>
                <input
                  value={jumperText.value}
                  valueRevision={jumperRevision.value}
                  readOnly={props.disabled}
                  tabIndex={props.disabled ? -1 : 0}
                  aria-label="跳转到指定页"
                  theme={jumperTheme}
                  onChange={handleJumperChange}
                  onSubmit={() => jump()}
                  onFocus={() => (jumperFocused.value = true)}
                  onBlur={() => {
                    jumperFocused.value = false
                    jump()
                  }}
                  style={jumperInputStyle}
                />
              </div>
              <text>页</text>
            </div>
          ) : null}
        </div>
      )
    }
  },
})

export default Pagination
