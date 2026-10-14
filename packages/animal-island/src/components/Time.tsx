/** Time — GPUIV port of animal-island-vue's `Time.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 原版无 props（`TimeProps = HTMLAttributes`，纯 attrs 透传到根节点）→ 保持
 *    attrs 透传，仅加 testId。
 *  - 定时器：原版 setInterval(1000) 更新 now → tick 改为 500ms（同时驱动冒号
 *    闪烁，见下）；onBeforeUnmount 清理照抄。
 *  - 冒号闪烁：原版 `animation: blink 1s step-end infinite`（每秒前 500ms 可见、
 *    后 500ms 透明）→ GPUIV 无 CSS animation，500ms tick 里按
 *    `Date#getMilliseconds() < 500` 切 opacity，同周期同相位。
 *  - 冒号光学上移 `transform: translateY(-0.11em)` → 砍掉（GPUIV 无 transform）；
 *    `margin: 0 -0.08em` → marginLeft/Right -3.5（44px × 0.08 ≈ 3.5）。
 *  - 入场 `fade-in @motion-duration-slow` keyframes → motion.div opacity 0→1，
 *    duration.slow（0.35s）。
 *  - `font-variant-numeric: tabular-nums` / `letter-spacing: 1px` → 砍掉（GPUIV
 *    不支持）；`text-transform: uppercase` → JS toUpperCase()。
 *  - `aria-live="off"` → GPUIV 无障碍表无此项，砍掉；role="timer" 保留。
 */

import { defineComponent, onBeforeUnmount, onMounted, ref } from "vue"
import { motion, type StyleDesc } from "@gpuiv/vue"
import { colors, duration, ease, fontSize, fonts, radius, shadows, spacing } from "../tokens.js"

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const pad = (n: number) => n.toString().padStart(2, "0")

export const Time = defineComponent({
  name: "AnimalTime",
  inheritAttrs: false,
  props: {
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs }) {
    const now = ref(new Date())
    // Blink state for the colon (see header): visible during the first 500ms
    // of each wall-clock second.
    const colonOn = ref(true)
    let timer: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
      timer = setInterval(() => {
        const d = new Date()
        now.value = d
        colonOn.value = d.getMilliseconds() < 500
      }, 500)
    })
    onBeforeUnmount(() => {
      if (timer) clearInterval(timer)
    })

    return () => {
      const d = now.value
      // motion.div forwards attrs to its underlying div but only types its own
      // props — spread a11y props from an object so tsc does not reject them.
      const a11y = { role: "timer", testId: props.testId }
      return (
        <motion.div
          {...a11y}
          {...attrs}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: duration.slow, ease }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: spacing.md,
            paddingTop: 20,
            paddingBottom: 15,
            paddingLeft: 32,
            paddingRight: 32,
            borderRadius: radius.card,
            backgroundColor: colors.bg,
            boxShadow: shadows.sm,
            ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
            ...(attrs.style as StyleDesc | undefined),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: colors.text,
              fontSize: 44,
              fontWeight: 900,
              lineHeight: 44,
              whiteSpace: "nowrap",
            }}
          >
            <text>{pad(d.getHours())}</text>
            {/* Box wrapper: adjacent <text> siblings merge into one run line, so
                the blinking colon needs its own box for a reliable opacity. */}
            <div style={{ opacity: colonOn.value ? 1 : 0, marginLeft: -3.5, marginRight: -3.5 }}>
              <text>:</text>
            </div>
            <text>{pad(d.getMinutes())}</text>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.xs,
              paddingTop: spacing.xs,
              paddingBottom: spacing.xs,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: radius.pill,
              backgroundColor: colors.primaryBg,
              fontSize: fontSize.sm,
              fontWeight: 700,
              color: colors.textSecondary,
              whiteSpace: "nowrap",
            }}
          >
            <text style={{ color: colors.primary, fontWeight: 800 }}>{weekdays[d.getDay()].toUpperCase()}</text>
            <text style={{ color: colors.textDisabled }}>·</text>
            <text>{`${months[d.getMonth()]} ${d.getDate()}`}</text>
          </div>
        </motion.div>
      )
    }
  },
})

export default Time
