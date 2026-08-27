import type { EventPayload } from "@gpuiv/native"

export type DimensionValue = number | string

export interface MotionStyle {
  width?: number
  height?: number
  opacity?: number
  top?: number
  right?: number
  bottom?: number
  left?: number
  borderRadius?: number
}

export type MotionEase =
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | [number, number, number, number]

export interface MotionTransition {
  /** Duration in seconds. */
  duration?: number
  /** Delay in seconds. */
  delay?: number
  ease?: MotionEase
}

export interface MotionProps {
  initial?: MotionStyle | false
  animate: MotionStyle
  transition?: MotionTransition
}

export interface BoxShadow {
  offsetX: number
  offsetY: number
  blurRadius: number
  spreadRadius: number
  color: string
}

export interface StyleDesc {
  display?: string
  visibility?: string
  flexDirection?: string
  flexWrap?: string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number
  alignItems?: string
  alignSelf?: string
  alignContent?: string
  justifyContent?: string
  gap?: number
  rowGap?: number
  columnGap?: number
  gridTemplateColumns?: number
  gridTemplateRows?: number
  gridColumnMin?: "zero" | "min-content" | "max-content"
  gridRowMin?: "zero" | "min-content" | "max-content"

  width?: DimensionValue
  height?: DimensionValue
  minWidth?: DimensionValue
  minHeight?: DimensionValue
  maxWidth?: DimensionValue
  maxHeight?: DimensionValue

  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number

  margin?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number

  position?: string
  top?: number
  right?: number
  bottom?: number
  left?: number

  background?: string
  backgroundColor?: string
  color?: string
  opacity?: number

  borderWidth?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderColor?: string
  borderRadius?: number
  borderTopLeftRadius?: number
  borderTopRightRadius?: number
  borderBottomLeftRadius?: number
  borderBottomRightRadius?: number
  boxShadow?: BoxShadow

  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  textAlign?: string
  lineHeight?: number
  whiteSpace?: "normal" | "nowrap"
  textOverflow?: "ellipsis" | "ellipsis-start"
  lineClamp?: number

  overflow?: string
  overflowX?: string
  overflowY?: string

  cursor?: string
  /** `"auto"` blocks hits behind this element. `"none"` never does. Unset blocks when the element paints a fill or is absolutely positioned. */
  pointerEvents?: "auto" | "none"

  /** "none" opts this element and its subtree out of text selection.
   *  Inherited like the CSS property, so a toolbar can disable it once. */
  userSelect?: "text" | "none" | "auto"
  /** Selection wash colour for this subtree. Defaults to the theme accent at 35%. */
  selectionColor?: string

  // Pseudo-selector styles — applied by GPUI natively (no JS round-trip).
  // Nesting is one level deep: hover/active cannot contain hover/active.
  hover?: Omit<StyleDesc, "hover" | "active">
  active?: Omit<StyleDesc, "hover" | "active">
}

// Element types supported by GPUIX
export type ElementType =
  | "div"
  | "text"
  | "img"
  | "svg"
  | "canvas"
  | "input"
  | "textarea"
  | "anchored"
  | "code"
  | "diff"
  | "markdown"
  | "virtual-list"

// ── Theme ────────────────────────────────────────────────────────────

/** Colours for one syntax capture class each. Every field is a CSS colour. */
export interface SyntaxTheme {
  comment?: string
  keyword?: string
  string?: string
  stringSpecial?: string
  escape?: string
  number?: string
  boolean?: string
  typeName?: string
  typeBuiltin?: string
  constructor?: string
  function?: string
  functionBuiltin?: string
  macroName?: string
  property?: string
  constant?: string
  variable?: string
  variableSpecial?: string
  parameter?: string
  operator?: string
  punctuation?: string
  tag?: string
  attribute?: string
  label?: string
  invalid?: string
}

/**
 * Every number that decides layout in the native text components.
 *
 * These live in the theme, not in Rust constants, so tuning a row height or a
 * heading scale is a re-render and needs no native rebuild.
 */
export interface GpuixMetrics {
  // Code blocks. Shared by <code> and the markdown fenced block.
  codeTextSize?: number
  codeLineHeight?: number
  codeGutterDigitWidth?: number
  codeGutterPaddingRight?: number
  codeGutterMinWidth?: number

  /**
   * The fenced-block card. `<code>` paints no card, so these are
   * markdown-only: style a `<code>` block with its own `style` prop instead.
   */
  mdCodePaddingX?: number
  mdCodePaddingY?: number
  mdCodeRadius?: number
  mdCodeHeaderPaddingY?: number
  mdCodeHeaderTextSize?: number

  // Diffs
  diffTextSize?: number
  diffLineHeight?: number
  diffFileHeaderHeight?: number
  diffHunkHeaderHeight?: number
  diffNoticeHeight?: number
  diffBodyBottomPad?: number
  diffGutterWidth?: number
  diffMarkerWidth?: number
  diffAccentBarWidth?: number
  diffRowPaddingX?: number

  // Markdown
  mdTextSize?: number
  mdLineHeight?: number
  mdBlockGap?: number
  /** `[h1, h2, h3, h4to6]`. A shorter array leaves the rest at their defaults. */
  mdHeadingSizes?: number[]
  mdHeadingLineHeights?: number[]
  mdTableCellPadding?: number
  mdTableMinColumnWidth?: number
  mdTableMinColumnContent?: number
  mdInlineCodeRadius?: number
}

/**
 * Theme tokens for the native text components. Every field is optional and
 * layers on top of the built-in dark theme (or light, via `appearance`).
 */
export interface GpuixTheme {
  appearance?: "dark" | "light"
  bg?: string
  border?: string
  text?: string
  textMuted?: string
  textFaint?: string
  textDim?: string
  accent?: string
  caret?: string
  codeText?: string
  codeWash?: string
  diffAdd?: string
  diffDel?: string
  diffHunkBg?: string
  fontSans?: string
  fontMono?: string
  syntax?: SyntaxTheme
  metrics?: GpuixMetrics
}

// ── Text search highlight ────────────────────────────────────────────

/** One `highlight` entry. Spread from `useTextSearch().props` or hand-written. */
export interface HighlightSpec {
  /**
   * Substring to match. Case-insensitive unless `caseSensitive` is set.
   *
   * A match never crosses a line, exactly like browser find. It DOES cross the
   * several host nodes the renderer makes for one interpolated line, so
   * `<text>Hello {name}!</text>` matches `Hello Tommy`.
   */
  query?: string
  caseSensitive?: boolean
  /** Only match when neither neighbour is alphanumeric or `_`. */
  wholeWord?: boolean
  /**
   * Explicit `[start, end)` pairs in UTF-16 code units, the units `indexOf` and
   * `RegExp.exec` return. They index the declaring subtree's text, with a
   * newline between lines.
   *
   * A pair that splits a surrogate pair is rejected, not snapped. Native text
   * (`<code>`, `<markdown>`, `<diff>`) is not part of that text; use `query`.
   */
  ranges?: Array<[number, number]>
  /** Any CSS colour. Defaults to the theme accent at 30% alpha. */
  color?: string
  /** Colour for the match at `activeIndex`. Defaults to accent at 65%. */
  activeColor?: string
  /** Index of the match to highlight differently, for a find-bar cursor. */
  activeIndex?: number
  /**
   * How many MATCHES come before this subtree in your document, so `activeIndex`
   * is compared against `matchIndexOffset + n` for the nth match here.
   *
   * It is a match count, not a row index. Rows hold different numbers of
   * matches, so a row index cannot stand in for it.
   *
   * Only needed for virtualized content: a `<virtual-list>` mounts a window of
   * its rows, so native can only number what that window contains. Sum
   * `findRanges` over the rows before `windowStart`. Defaults to 0.
   *
   * A negative or fractional value is refused and the whole spec is dropped,
   * because a bad offset silently marks the wrong match.
   */
  matchIndexOffset?: number
  /** Corner radius of the wash. Defaults to 2. */
  radius?: number
}

// ── Element props ────────────────────────────────────────────────────

// Props that are handled by the renderer directly (not forwarded as custom props).
export interface ElementProps {
  style?: StyleDesc | Record<string, unknown>
  children?: unknown

  // ── Mouse events ───────────────────────────────────────────────
  /** Primary button only, like the DOM. Use `onAuxClick` for the others. */
  onClick?: (event: EventPayload) => void
  /** Non-primary click, like the DOM `auxclick`. `isRightClick` says which. */
  onAuxClick?: (event: EventPayload) => void
  onMouseDown?: (event: EventPayload) => void
  onMouseUp?: (event: EventPayload) => void
  onMouseEnter?: (event: EventPayload) => void
  onMouseLeave?: (event: EventPayload) => void
  onMouseMove?: (event: EventPayload) => void
  /** Fires when user clicks OUTSIDE this element. Use for "click outside to close". */
  onMouseDownOutside?: (event: EventPayload) => void

  // ── Text search ────────────────────────────────────────────────────
  /**
   * Wash matches under this subtree. Scoped by tree position: the nearest
   * declaration wins and nested declarations are skipped by the resolver.
   * Usually spread from `useTextSearch().props`.
   */
  highlight?: HighlightSpec | null
  /** Fires after the build that resolved `highlight`, with `matchCount`. */
  onHighlight?: (event: EventPayload) => void

  // ── Keyboard events (need focus: autoFocus, or a click on the element) ──
  onKeyDown?: (event: EventPayload) => void
  onKeyUp?: (event: EventPayload) => void

  // ── Focus events ───────────────────────────────────────────────
  onFocus?: (event: EventPayload) => void
  onBlur?: (event: EventPayload) => void

  // ── Scroll events ──────────────────────────────────────────────
  onScroll?: (event: EventPayload) => void

  // ── Text editor events ─────────────────────────────────────────
  onChange?: (event: EventPayload) => void
  /** `onInput` is an alias for `onChange` in Vue (`v-model` friendly). */
  onInput?: (event: EventPayload) => void
  onSubmit?: (event: EventPayload) => void

  // ── Native component events ─────────────────────────────────────
  onToggleFile?: (event: EventPayload) => void
  onShowMore?: (event: EventPayload) => void
  onLineClick?: (event: EventPayload) => void
  onLinkClick?: (event: EventPayload) => void
  onVisibleRange?: (event: EventPayload) => void

  // ── Focus props ────────────────────────────────────────────────
  /** Take keyboard focus when the element first mounts. Required for `<input>`:
   *  without it, or a click, the field never receives key events. */
  autoFocus?: boolean
  /** Native GPUI tab order. Use 0 for normal keyboard focus. */
  tabIndex?: number
  /** Stable locator id for automation. */
  testId?: string
  /** Internal native animation description used by motion components. */
  motion?: MotionProps
}

// ── Virtual list props ───────────────────────────────────────────────

type VirtualListShared = {
  style?: StyleDesc | Record<string, unknown>
  children?: unknown
  alignment?: "top" | "bottom"
  followTail?: boolean
  overdraw?: number
  onVisibleRange?: (event: EventPayload) => void
}

/** A variable-height list that builds only rows near its viewport.
 * `estimatedItemHeight` is required with `itemCount`: windowed mode needs a
 * height hint for rows Vue has not mounted. Native ignores `itemCount` when
 * the estimate is missing, so the list stays on mounted children only. */
export type VirtualListProps =
  | (VirtualListShared & {
      estimatedItemHeight?: number
      itemCount?: never
      windowStart?: never
    })
  | (VirtualListShared & {
      itemCount: number
      estimatedItemHeight: number
      windowStart?: number
    })

// ── Host node type ───────────────────────────────────────────────────

/**
 * The "DOM node" of the GPUIX host — a lightweight JS handle whose real
 * element state lives in Rust's RetainedTree.
 *
 * `id` is null only for comment nodes (used as anchors by Vue) and the
 * container sentinel; those never reach Rust.
 */
export interface HostNode {
  id: number | null
  /** Element type ("div", "svg", ...) or "#text" / "#comment" / "#container". */
  type: string
  text: string
  props: Record<string, unknown>
  parent: HostNode | null
  children: HostNode[]
  /** Whether createElement has been sent to Rust for this node. */
  created: boolean
}

/// Interface for the renderer that receives mutations from the Vue renderer.
/// Implemented by the real napi GpuixRenderer and by TestRenderer (which
/// delegates to native TestGpuixRenderer for tests).
export interface NativeRenderer {
  createElement(id: number, elementType: string): void
  destroyElement(id: number): Array<number>
  appendChild(parentId: number, childId: number): void
  removeChild(parentId: number, childId: number): void
  insertBefore(parentId: number, childId: number, beforeId: number): void
  setStyle(id: number, styleJson: string | object): void
  setText(id: number, content: string): void
  setEventListener(id: number, eventType: string, hasHandler: boolean): void
  setRoot(id: number): void
  commitMutations(): void
  setCustomProp(id: number, key: string, valueJson: string | object | number | boolean | null): void
  /** Apply a batch of mutations in a single FFI call. Returns destroyed IDs. */
  applyBatch?(json: string): Array<number>

  // ── Focus API ──────────────────────────────────────────────────
  focusElement?(elementId: number): void
  blur?(): void

  // ── Scroll API ─────────────────────────────────────────────────
  /** Set the scroll offset of a scrollable element (overflow: "scroll").
   *  x and y are negative pixel values (scroll down = more negative y). */
  scrollTo?(elementId: number, x: number, y: number): void
  /** Scroll a child into view by its index in the children list. */
  scrollToItem?(elementId: number, index: number): void
  /** Get the current scroll offset [x, y] or null if element is not scrollable. */
  getScrollOffset?(elementId: number): Array<number> | null

  // ── Selection API ──────────────────────────────────────────────
  /** The current text selection joined in document order, or null. */
  getSelectedText?(): string | null
  /** Drop the current selection. */
  clearSelection?(): void

  // ── Window API ─────────────────────────────────────────────────
  getWindowSize?(): { width: number; height: number }
  getWindowInsets?(): NativeWindowInsets
  setWindowTitle?(title: string): void
  setDebugFrameOverlay?(mode: DebugFrameOverlayMode): string
  getDebugFrameOverlay?(): string
  cycleDebugFrameOverlay?(): string
  resetDebugFrameOverlayStats?(): void
  getDebugFrameOverlayStats?(): DebugFrameOverlayStats
}

export type DebugFrameOverlayMode = "hidden" | "minimal" | "full"

export interface EdgeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface NativeWindowInsets {
  safeArea: EdgeInsets
  ime: EdgeInsets
  effective: EdgeInsets
}

export interface DebugFrameOverlayStats {
  currentMs?: number
  p90Ms?: number
  p99Ms?: number
  maxMs?: number
  frames: number
  samples: number
}

export type EventHandlerMap = Map<
  number,
  Map<string, (event: EventPayload) => void>
>

export interface ElementIdAllocator {
  nextElementId: number
}

// One renderer root. Event handlers stay on this object so two live roots
// can both use id 1. Ids come from an allocator that lives with the
// NativeRenderer, so a remount on the same renderer cannot reuse them.
export interface Container {
  renderer: NativeRenderer
  ids: ElementIdAllocator
  eventHandlers: EventHandlerMap
}
