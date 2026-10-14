/** Image — GPUIV port of animal-island-vue's `Image.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 相框: 原版 `display: inline-flex` 收缩包裹 → GPUIV 无 inline-flex，
 *    `display: flex` + 未设宽高时随父布局（flex 父内收缩，block 父内撑满）。
 *    width/height 给相框（Taffy 默认 border-box，同原版 box-sizing），img 在
 *    单轴为数字/px且另一轴未设时，用解码事件的 naturalWidth/Height 按
 *    intrinsic 比例补齐相框，扣除最终 padding/border；双轴明确时保留拉伸。
 *    未知百分比/auto 不猜尺寸，未设双轴时仍取位图自然尺寸。
 *  - object-fit: 原版相框 img 只设 width/height 100%，未设 object-fit → 默认
 *    fill 拉伸，移植保留 `objectFit="fill"`；预览大图原版 `object-fit: contain`
 *    → `objectFit="contain"`。
 *  - variant=default: 原版三重 box-shadow（13px/27px/-5px 主影 + 两道补影）→
 *    GPUIV 单阴影，保留主影及 -5px spread。卡片大圆角 12px 原样。
 *  - variant=bordered: 白底（或 color 调色板底色）+ padding 12 + 圆角 8 +
 *    柔和阴影 `0 8px 14px 0 rgba(0,0,0,0.08)` 原样（原版注释叫「边框」但
 *    border: none，移植同样无边框）。
 *  - variant=stamp: 四边半圆齿孔使用测量尺寸的 SVG luminance mask；孔半径
 *    5px、间距 16px 随窗口/宽高比变化保持不变。照片上的 4px 半色调纸纹也由
 *    SVG 绘制。底纸 #fbfaf5、padding 14、直角、年份字保留；照片 saturate/
 *    contrast 滤镜、两重 drop-shadow、年份字距/文字阴影仍未表达。
 *  - color 调色板: 原版 variant='bordered' 和 error 态生效，色值同
 *    tokens.cardPattern。
 *  - 加载/失败: 原生 img 解码事件驱动 opacity 0→1 和原版错误图标/文字；
 *    load/error 传递 GPUIV EventPayload，value 为源地址、尺寸或错误的 JSON。
 *  - lazy: 原版 `<img loading="lazy">` → GPUIV img 始终立即加载（远程图也在
 *    后台任务解码），prop 保留但 inert。
 *  - 预览弹层: 原版 `<Teleport to="body">` + `position: fixed; inset: 0` →
 *    窗口尺寸 deferred anchored 层（原点为窗口 0,0，可在普通滚动内容里使用）。遮罩点击关闭、面板
 *    点击不关闭（原版 @click.stop）→ 透明 dialog 明确 pointerEvents:auto，
 *    使 GPUI 命中停在前层，避免穿过图片命中后层遮罩。
 *  - 预览大图尺寸: 原版 `max-width: min(88vw, 1100px)` / `max-height: 86vh`
 *    （replaced-element 比例约束，盒随图收缩）→ `useWindowSize()` 数值设
 *    maxWidth/maxHeight，盒 = min(位图, 上限) 逐轴截断（无 aspect-ratio 盒
 *    可能略大于图），contain 在盒内居中，视觉等价；小图不放大。
 *  - 预览动画: 原版 mask fade 0.2s + 大图 zoom-in（opacity + scale(0.92→1)）
 *    0.25s → AnimatePresence + motion.div 整层 opacity 0→1，0.2s（无 transform）。
 *  - 关闭按钮: 原版两条旋转 45° 白杠（CSS transform）→ 内联 SVG data URL
 *    白叉（无 transform）；hover scale(1.06) 砍掉，hover 背景加深保留。
 *  - 键盘/焦点: 原版预览触发是 <button>（原生 Enter/Space）→ role="button" +
 *    tabIndex + activationKeys；`:focus-visible` 黄框 → focused ref + outline。
 *    预览打开聚焦关闭按钮（autoFocus）、Esc 关闭、Tab 圈定（focusNextWithin
 *    拉回，原生 Tab 不可 preventDefault，焦点可能短暂出层再弹回）、关闭后
 *    焦点还原（getFocusedElementId/focusElement）——全部同 Modal 模式。
 *  - `cursor: zoom-in` → "pointer"（GPUIV 无 zoom-in）。
 */

import { defineComponent, onBeforeUnmount, ref, watch, type PropType } from "vue"
import {
  AnimatePresence,
  motion,
  useGpuix,
  useWindowSize,
  type EventPayload,
  type HostNode,
  type StyleDesc,
} from "@gpuiv/vue"
import { cardPattern, ease, fonts, type CardColor } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { WindowLayer } from "./window-layer.js"
import { imageEventMatches, readImageEvent } from "./image-events.js"
import { StampSurface } from "./image-stamp-decoration.js"

export type ImageColor = "white" | CardColor
export type ImageVariant = "default" | "bordered" | "stamp"

/** 与原版 types.ts 对齐；事件携带原生载荷而非 DOM Event。 */
export interface ImageProps {
  src: string
  alt?: string
  width?: number | string
  height?: number | string
  color?: ImageColor
  lazy?: boolean
  variant?: ImageVariant
  stampYear?: string
  preview?: boolean
  onLoad?: (event: EventPayload) => void
  onError?: (event: EventPayload) => void
}

/** 原版 Less `.animal-image--default` 底色（卡片 pattern-default 同款，无花纹）。 */
const DEFAULT_PALETTE = { bg: "rgb(247, 243, 223)", text: "#725d42" }

function paletteOf(color: ImageColor): { bg: string; text: string } {
  if (color === "white") return { bg: "#ffffff", text: "#725d42" }
  if (color === "default") return DEFAULT_PALETTE
  return cardPattern[color]
}

function pixelDimension(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value !== "string" || !/^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)px\s*$/i.test(value)) return null
  const pixels = Number.parseFloat(value)
  return Number.isFinite(pixels) && pixels >= 0 ? pixels : null
}

function resolvedPixelDimension(value: number | string | undefined, min: number | string | undefined, max: number | string | undefined): number | null {
  const pixels = pixelDimension(value), lower = min === undefined ? 0 : pixelDimension(min), upper = max === undefined ? Infinity : pixelDimension(max)
  if (pixels === null || lower === null || upper === null) return null
  return Math.max(lower, Math.min(pixels, upper))
}

function frameInsets(style: StyleDesc) {
  const padding = style.padding ?? 0, border = style.borderWidth ?? 0
  return {
    x: (style.paddingLeft ?? padding) + (style.paddingRight ?? padding) + (style.borderLeftWidth ?? border) + (style.borderRightWidth ?? border),
    y: (style.paddingTop ?? padding) + (style.paddingBottom ?? padding) + (style.borderTopWidth ?? border) + (style.borderBottomWidth ?? border),
  }
}

/** 原版关闭叉：16×16 两条 2px 圆头白杠旋转 ±45° —— 无 transform，画进 SVG。 */
const CLOSE_MARK_URL = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
    '<path d="M3 3 L13 13 M13 3 L3 13" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/></svg>',
  "utf8",
).toString("base64")}`

const ERROR_MARK_URL = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="#2A2A2A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="6" y="10" width="36" height="28" rx="3" fill="#FAEDCD"/><circle cx="16" cy="20" r="3" fill="#E9C46A"/>' +
  '<path d="M10 36 L20 24 L28 32 L36 22 L42 36 Z" fill="#2A9D8F"/><path d="M10 36 L42 36"/></svg>',
).toString("base64")}`

export const Image = defineComponent({
  name: "AnimalImage",
  inheritAttrs: false,
  emits: {
    load: (_event: EventPayload) => true,
    error: (_event: EventPayload) => true,
  },
  props: {
    /** 图片地址（必填）：fs 路径 / data URL / http(s) URL */
    src: { type: String, required: true },
    /** 图片替代文本（无障碍）；留空表示装饰性图片 */
    alt: { type: String, default: "" },
    /** 图片宽度（数字 px；字符串限 GPUIV 的 px/%/auto 形式） */
    width: { type: [Number, String] as PropType<number | string>, default: undefined },
    /** 图片高度（同 width） */
    height: { type: [Number, String] as PropType<number | string>, default: undefined },
    /** 背景颜色（Card pattern 同款底色；'white' 纯白，默认 white；仅 variant='bordered' 生效） */
    color: { type: String as PropType<ImageColor>, default: "white" },
    /** Inert：GPUIV <img> 始终立即加载（见文件头） */
    lazy: { type: Boolean, default: false },
    /** 相框类型：default 卡片大阴影+大圆角，bordered 衬板柔和阴影+小圆角，stamp 邮票齿孔 */
    variant: { type: String as PropType<ImageVariant>, default: "default" },
    /** 邮票类型下的发行年份，印在右上角照片上；留空不显示 */
    stampYear: { type: String, default: undefined },
    /** 点击图片弹出大图预览（默认开启） */
    preview: { type: Boolean, default: true },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, emit }) {
    const { renderer } = useGpuix()
    const windowSize = useWindowSize()
    const focused = ref(false)
    const previewOpen = ref(false)
    const loaded = ref(false)
    const failed = ref(false)
    const intrinsicRatio = ref<number | null>(null)
    watch(() => props.src, () => {
      loaded.value = false
      failed.value = false
      intrinsicRatio.value = null
    }, { flush: "sync" })
    function handleLoad(event: EventPayload) {
      const details = readImageEvent(event, props.src)
      if (!details) return
      const width = details.naturalWidth, height = details.naturalHeight
      const ratio = typeof width === "number" && Number.isFinite(width) && width > 0 &&
        typeof height === "number" && Number.isFinite(height) && height > 0 ? width / height : null
      intrinsicRatio.value = ratio !== null && Number.isFinite(ratio) && ratio > 0 ? ratio : null
      loaded.value = true
      emit("load", event)
    }
    function handleError(event: EventPayload) {
      if (!imageEventMatches(event, props.src)) return
      loaded.value = true
      failed.value = true
      intrinsicRatio.value = null
      previewOpen.value = false
      emit("error", event)
    }
    const dialog = ref<HostNode | null>(null)
    let previouslyFocused: number | null = null
    onBeforeUnmount(() => {
      if (previouslyFocused != null) renderer?.focusElement?.(previouslyFocused)
    })

    // 对齐原版：打开时记录焦点（关闭后还原）；autoFocus 负责聚焦关闭按钮。
    watch(previewOpen, (open) => {
      if (open) {
        previouslyFocused = renderer?.getFocusedElementId?.() ?? null
      } else if (previouslyFocused != null) {
        renderer?.focusElement?.(previouslyFocused)
        previouslyFocused = null
      }
    })

    function openPreview() {
      if (!failed.value) previewOpen.value = true
    }

    function closePreview() {
      previewOpen.value = false
    }

    function onDialogKeyDown(e: EventPayload) {
      if (e.key === "escape") {
        closePreview()
        return
      }
      // Tab 圈定（同 Modal）：原生 Tab 巡访不可取消，立即拉回弹层子树。
      if (e.key === "tab") {
        const id = dialog.value?.id
        if (id == null) return
        if (e.modifiers?.shift) renderer?.focusPreviousWithin?.(id)
        else renderer?.focusNextWithin?.(id)
      }
    }

    return () => {
      // Props size the border-box frame. Final attribute styles can replace
      // those axes and its padding before any intrinsic ratio is applied.
      const frameSize: StyleDesc = {}
      if (props.width !== undefined) {
        frameSize.width = props.width
      }
      if (props.height !== undefined) {
        frameSize.height = props.height
      }

      let variantStyle: StyleDesc
      switch (props.variant) {
        case "bordered": {
          const palette = paletteOf(props.color)
          variantStyle = {
            padding: 12,
            backgroundColor: palette.bg,
            color: palette.text,
            borderRadius: 8,
            boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 14, spreadRadius: 0, color: "rgba(0, 0, 0, 0.08)" },
          }
          break
        }
        case "stamp":
          // SVG 底纸绘制真实透明齿孔；原生背景保持透明，照片内缩 14px。
          variantStyle = {
            padding: 14,
            backgroundColor: "transparent",
            borderRadius: 0,
          }
          break
        case "default":
        default:
          // 原版三重阴影 → 主影单阴影，保留 GPUI 支持的负 spread。
          variantStyle = {
            padding: 0,
            backgroundColor: "transparent",
            borderRadius: 12,
            boxShadow: { offsetX: 0, offsetY: 13, blurRadius: 27, spreadRadius: -5, color: "rgba(50, 50, 93, 0.25)" },
          }
          break
      }

      if (failed.value) {
        const palette = paletteOf(props.color)
        variantStyle = {
          padding: 12, borderRadius: 8,
          backgroundColor: palette.bg,
          color: props.color === "white" ? "#c4b89e" : palette.text,
          boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 14, spreadRadius: 0, color: "rgba(0, 0, 0, 0.08)" },
          flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 19.5, fontWeight: 500,
        }
      }
      const interactive = props.preview && !failed.value

      const frameStyle: StyleDesc = {
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        ...frameSize,
        ...variantStyle,
        ...(attrs.style as StyleDesc | undefined),
        ...(interactive ? { cursor: "pointer" } : {}),
        ...(focused.value && interactive ? { outline: { width: 2, color: "#ffcc00", offset: 2 } } : {}),
      }
      const insets = frameInsets(frameStyle)
      if (!failed.value && intrinsicRatio.value !== null) {
        const width = resolvedPixelDimension(frameStyle.width, frameStyle.minWidth, frameStyle.maxWidth)
        const height = resolvedPixelDimension(frameStyle.height, frameStyle.minHeight, frameStyle.maxHeight)
        if (width !== null && frameStyle.height === undefined) {
          frameStyle.height = Math.max(0, width - insets.x) / intrinsicRatio.value + insets.y
        } else if (height !== null && frameStyle.width === undefined) {
          frameStyle.width = Math.max(0, height - insets.y) * intrinsicRatio.value + insets.x
        }
      }
      const imgSize: StyleDesc = {
        ...(frameStyle.width !== undefined ? { width: "100%" } : {}),
        ...(frameStyle.height !== undefined ? { height: "100%" } : {}),
      }
      // Definite content dimensions also preserve deliberate non-proportional
      // two-axis boxes: GPUI can otherwise assign the bitmap's aspect ratio
      // to a percentage-sized image instead of stretching the supplied box.
      const imageWidth = resolvedPixelDimension(frameStyle.width, frameStyle.minWidth, frameStyle.maxWidth)
      const imageHeight = resolvedPixelDimension(frameStyle.height, frameStyle.minHeight, frameStyle.maxHeight)
      if (imageWidth !== null && imageHeight !== null) {
        imgSize.width = Math.max(0, imageWidth - insets.x)
        imgSize.height = Math.max(0, imageHeight - insets.y)
      }

      const frame = (
        <div
          {...attrs}
          role={failed.value ? "img" : interactive ? "button" : undefined}
          aria-label={failed.value ? props.alt || "图片加载失败" : interactive ? props.alt || undefined : undefined}
          tabIndex={failed.value ? undefined : (attrs.tabIndex as number | undefined) ?? (interactive ? 0 : undefined)}
          testId={props.testId}
          onFocus={() => (focused.value = true)}
          onBlur={() => (focused.value = false)}
          onClick={interactive ? openPreview : undefined}
          onKeyDown={interactive ? activationKeys(openPreview) : undefined}
          style={{ ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...frameStyle }}
        >
          {!failed.value && props.variant === "stamp" ? <StampSurface /> : null}
          {failed.value ? <div key="image-error" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, pointerEvents: "none" }}>
            <img src={ERROR_MARK_URL} alt="" style={{ width: 32, height: 32, pointerEvents: "none" }} />
            <text style={{ pointerEvents: "none" }}>图片加载失败</text>
          </div> : <img key={props.src} src={props.src} alt={props.alt} objectFit="fill"
            testId={props.testId ? `${props.testId}-img` : undefined}
            onLoad={handleLoad} onError={handleError}
            motion={{ initial: { opacity: 0 }, animate: { opacity: loaded.value ? 1 : 0 }, transition: { duration: 0.25, ease: "ease" } }}
            style={{ ...imgSize, pointerEvents: props.preview ? "none" : undefined }} />}
          {!failed.value && props.variant === "stamp" ? <StampSurface texture /> : null}
          {!failed.value && props.variant === "stamp" && props.stampYear ? (
            <div
              style={{
                position: "absolute",
                top: 18,
                right: 19,
                fontSize: 8,
                color: "rgba(255, 255, 255, 0.88)",
                pointerEvents: "none",
              }}
            >
              <text>{props.stampYear}</text>
            </div>
          ) : null}
        </div>
      )

      // 预览大图：盒 = min(位图, 88vw/1100 × 86vh) 逐轴截断，contain 居中（见文件头）。
      const previewImgStyle: StyleDesc = {
        maxWidth: Math.min(windowSize.value.width * 0.88, 1100),
        maxHeight: windowSize.value.height * 0.86,
        borderRadius: 20,
        boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 40, spreadRadius: 0, color: "rgba(43, 33, 24, 0.55)" },
      }

      return (
        <>
          {frame}
          {props.preview ? (
            <AnimatePresence>
              {previewOpen.value ? (
                <WindowLayer key="animal-image-preview" backgroundColor="rgba(0, 0, 0, 0.55)">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease }}
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    testId={props.testId ? `${props.testId}-preview-mask` : undefined}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      backgroundColor: "transparent",
                    }}
                    onClick={closePreview}
                  />
                  <div
                    ref={dialog}
                    testId={props.testId ? `${props.testId}-preview` : undefined}
                    role="dialog"
                    aria-label={props.alt ? `查看图片：${props.alt}` : "图片预览"}
                    onKeyDown={onDialogKeyDown}
                    style={{ position: "relative", display: "flex", pointerEvents: "auto" }}
                  >
                    <img src={props.src} alt={props.alt} objectFit="contain" style={previewImgStyle} />
                    <div
                      testId={props.testId ? `${props.testId}-preview-close` : undefined}
                      role="button"
                      aria-label="关闭预览"
                      tabIndex={0}
                      autoFocus
                      onClick={closePreview}
                      onKeyDown={activationKeys(closePreview)}
                      style={{
                        position: "absolute",
                        top: 12,
                        right: 12,
                        width: 40,
                        height: 40,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1.5,
                        borderColor: "rgba(255, 255, 255, 0.75)",
                        borderRadius: 20,
                        backgroundColor: "rgba(216, 220, 226, 0.9)",
                        cursor: "pointer",
                        hover: { backgroundColor: "rgba(196, 201, 208, 0.95)" },
                      }}
                    >
                      <img src={CLOSE_MARK_URL} alt="" style={{ width: 16, height: 16, pointerEvents: "none" }} />
                    </div>
                  </div>
                </motion.div>
                </WindowLayer>
              ) : null}
            </AnimatePresence>
          ) : null}
        </>
      )
    }
  },
})

export default Image
