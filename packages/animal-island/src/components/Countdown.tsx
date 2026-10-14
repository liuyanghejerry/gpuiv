/** Countdown — GPUIV port of animal-island-vue's `Countdown.vue`（含 DigitRoll.vue）。
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - DigitRoll 里程表滚动（20 面数字条 translateY + transform transition 0.35s）
 *    → GPUIV 无 transform/CSS transition，数字静态切换；为免字宽抖动，数字格
 *    固定宽度（0.62em，代替 `font-variant-numeric: tabular-nums`）+ 居中。
 *  - 数字格 `height: 1.2em; line-height: 1.2` → height/lineHeight 数值。
 *  - 数字块底 `linear-gradient(180deg, #fff 0%, #f8f8f0 100%)`（island: #fffdf4）
 *    → GPUIV 两停 linear-gradient（angle 180）。
 *  - island 根边框 `2px dashed #d4c4a8` → 实线（GPUIV 无 dashed）。
 *  - bordered 数字块 `border: 1.5px solid` → borderWidth 1.5。
 *  - 冒号 `position: relative; top: -0.08em` → relative + top 数值（-0.08 × 字号
 *    ≈ -2/-2/-3）。
 *  - 分隔符 `white-space: pre` → 砍掉：字面量在独立 text 节点按原样渲染（GPUIV
 *    无 HTML 空白折叠）。
 *  - sr-only 视觉隐藏读屏串（clip rect）→ 砍掉；完整格式化串放根节点
 *    aria-valuetext。
 *  - 根 `transition: transform` 无实际 hover 效果 → 砍掉。
 *  - `<480px` 媒体查询 wrap 居中 → useWindowSize 数值判断。
 *  - 定时器照抄：mount/watch(value) 重启、250ms tick、归零 stopTimer、finish
 *    只发一次；emits(`change`/`finish`) → onChange/onFinish props。
 */

import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue"
import { useWindowSize, type StyleDesc } from "@gpuiv/vue"
import { colors, fonts, shadows, spacing } from "../tokens.js"

export type CountdownSize = "small" | "middle" | "large"
export type CountdownVariant = "default" | "island"

/** 数字/冒号/分隔符共用色（原版 Countdown.less 与 DigitRoll.less 的 #8b7355）。 */
const DIGIT_COLOR = "#8b7355"
/** island 面板底色 rgb(247, 243, 223)。 */
const ISLAND_BG = "#f7f3df"
const ISLAND_BORDER = "#d4c4a8"
const UNIT_BORDER = "#d4c9b4"

const sizeStyle: Record<CountdownSize, { minHeight: number; fontSize: number; colon: number; digit: number }> = {
  small: { minHeight: 40, fontSize: 13, colon: 20, digit: 20 },
  middle: { minHeight: 48, fontSize: 14, colon: 26, digit: 26 },
  large: { minHeight: 56, fontSize: 16, colon: 34, digit: 34 },
}

type TimePart = { kind: "token"; token: "DD" | "HH" | "mm" | "ss" } | { kind: "literal"; text: string }

const pad = (value: number) => String(value).padStart(2, "0")

/** 将格式模板解析为 token / 字面量序列，字面量（":"、"天" 等）原样渲染为分隔符 */
function parseFormat(format: string): TimePart[] {
  const parts: TimePart[] = []
  const re = /DD|HH|mm|ss/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(format)) !== null) {
    if (m.index > last) parts.push({ kind: "literal", text: format.slice(last, m.index) })
    parts.push({ kind: "token", token: m[0] as "DD" | "HH" | "mm" | "ss" })
    last = m.index + m[0].length
  }
  if (last < format.length) parts.push({ kind: "literal", text: format.slice(last) })
  return parts
}

function splitRemaining(remaining: number, format: string) {
  const totalSeconds = Math.ceil(remaining / 1_000)
  const days = Math.floor(totalSeconds / 86_400)
  const hasDays = format.includes("DD")
  const hours = hasDays ? Math.floor((totalSeconds % 86_400) / 3_600) : Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return { DD: pad(days), HH: pad(hours), mm: pad(minutes), ss: pad(seconds) } as const
}

interface RenderToken {
  kind: "token"
  token: "DD" | "HH" | "mm" | "ss"
  chars: string[]
}
interface RenderLiteral {
  kind: "literal"
  text: string
  colon: boolean
}

export const Countdown = defineComponent({
  name: "AnimalCountdown",
  inheritAttrs: false,
  props: {
    /** 结束时间，可以传时间戳或 Date */
    value: { type: [Number, Date] as PropType<number | Date>, required: true },
    /** 输出格式，支持 DD、HH、mm、ss，默认 HH:mm:ss */
    format: { type: String, default: "HH:mm:ss" },
    /** 尺寸 */
    size: { type: String as PropType<CountdownSize>, default: "middle" },
    /** 显示风格 */
    variant: { type: String as PropType<CountdownVariant>, default: "default" },
    /** 数字块是否带边框，默认无 */
    bordered: { type: Boolean, default: false },
    /** 每次 tick（含首次）回调剩余毫秒数 */
    onChange: { type: Function as PropType<(remaining: number) => void>, default: undefined },
    /** 归零时回调一次 */
    onFinish: { type: Function as PropType<() => void>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const windowSize = useWindowSize()

    const toTimestamp = (value: number | Date) => (value instanceof Date ? value.getTime() : value)
    const getRemaining = () => Math.max(0, toTimestamp(props.value) - Date.now())

    const remaining = ref(getRemaining())
    let timer: ReturnType<typeof setInterval> | null = null
    let finished = false

    function stopTimer() {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }

    function update(): number {
      const next = getRemaining()
      remaining.value = next
      props.onChange?.(next)

      if (next === 0) {
        if (!finished) {
          finished = true
          props.onFinish?.()
        }
        // 归零后清除定时器，避免 setInterval 空转
        stopTimer()
      }
      return next
    }

    function start() {
      stopTimer()
      finished = false
      if (update() > 0) {
        timer = setInterval(update, 250)
      }
    }

    onMounted(start)
    watch(() => props.value, start)
    onBeforeUnmount(stopTimer)

    const parts = computed(() => parseFormat(props.format))
    const digits = computed(() => splitRemaining(remaining.value, props.format))

    const renderParts = computed<(RenderToken | RenderLiteral)[]>(() =>
      parts.value.map((part) =>
        part.kind === "token"
          ? { kind: "token", token: part.token, chars: digits.value[part.token].split("") }
          : { kind: "literal", text: part.text, colon: /[:：]/.test(part.text) },
      ),
    )

    // 完整格式化串：原版渲染在 sr-only 里给读屏用；GPUIV 放到根节点的 aria-valuetext。
    const readable = computed(() =>
      parts.value.map((part) => (part.kind === "token" ? digits.value[part.token] : part.text)).join(""),
    )

    return () => {
      const sz = sizeStyle[props.size]
      const island = props.variant === "island"
      // 原版 @media (max-width: 480px)：wrap + 居中。
      const narrow = windowSize.value.width <= 480

      const rootStyle: StyleDesc = {
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        minHeight: sz.minHeight,
        borderRadius: 20,
        color: colors.text,
        fontSize: sz.fontSize,
        fontWeight: 700,
        ...(island
          ? {
              paddingTop: 13,
              paddingBottom: 13,
              paddingLeft: 20,
              paddingRight: 20,
              backgroundColor: ISLAND_BG,
              // 原版为 2px dashed；GPUIV 无 dashed，实线近似。
              borderWidth: 2,
              borderColor: ISLAND_BORDER,
            }
          : {
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 18,
              paddingRight: 18,
              backgroundColor: "#ffffff",
              boxShadow: shadows.sm,
            }),
        ...(narrow ? { maxWidth: "100%", flexWrap: "wrap", justifyContent: "center" } : {}),
        ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
        ...(attrs.style as StyleDesc | undefined),
      }

      const unitStyle: StyleDesc = {
        display: "flex",
        alignItems: "center",
        gap: 3,
        paddingTop: 3,
        paddingBottom: 3,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 12,
        background: {
          type: "linear-gradient",
          angle: 180,
          stops: [
            { color: island ? "#fffdf4" : "#ffffff", position: 0 },
            { color: colors.bg, position: 1 },
          ],
        },
        ...(props.bordered ? { borderWidth: 1.5, borderColor: island ? ISLAND_BORDER : UNIT_BORDER } : {}),
      }

      return (
        <div {...attrs} role="timer" aria-valuetext={readable.value} testId={props.testId} style={rootStyle}>
          {slots.prefix ? (
            <div style={{ color: colors.warmSoft, fontWeight: 600, whiteSpace: "nowrap" }}>{slots.prefix()}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {renderParts.value.map((part, i) =>
              part.kind === "token" ? (
                <div key={i} style={unitStyle}>
                  {part.chars.map((char, j) => (
                    <div
                      key={j}
                      style={{
                        // 固定格宽 + 居中，代替 tabular-nums（见文件头）。
                        width: Math.round(sz.digit * 0.62),
                        height: Math.round(sz.digit * 1.2),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: DIGIT_COLOR,
                        fontSize: sz.digit,
                        fontWeight: 900,
                        lineHeight: sz.digit * 1.2,
                      }}
                    >
                      <text>{char}</text>
                    </div>
                  ))}
                </div>
              ) : part.colon ? (
                // 原版 top: -0.08em 的光学上移用 relative + 数值 top 近似。
                <div
                  key={i}
                  style={{
                    position: "relative",
                    top: Math.round(-0.08 * sz.colon),
                    color: DIGIT_COLOR,
                    fontSize: sz.colon,
                    fontWeight: 900,
                  }}
                >
                  <text>{part.text}</text>
                </div>
              ) : (
                <text key={i} style={{ color: DIGIT_COLOR, fontWeight: 700 }}>
                  {part.text}
                </text>
              ),
            )}
          </div>
        </div>
      )
    }
  },
})

export default Countdown
