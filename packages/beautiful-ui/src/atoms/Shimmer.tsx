/** Shimmering label — signals the agent is processing.
 *
 *  The web original sweeps a gradient across clipped text
 *  (`background-clip: text`). GPUIV cannot clip a gradient to glyphs, so the
 *  label breathes instead: opacity oscillates between the dim and full ink
 *  on the same 1.8s cycle. Pure opacity — cheap on the mutation protocol.
 *  Pass `phase` (ms into the cycle) to pin the frame in tests.
 */

import { defineComponent, onBeforeUnmount, ref, watch } from "vue"
import { useTheme } from "../theme.js"
import { fonts } from "../tokens.js"

const PERIOD = 1800
const TICK_MS = 40

export const Shimmer = defineComponent({
  name: "BuiShimmer",
  props: {
    /** Pin the animation at this many ms into the cycle instead of ticking. */
    phase: { type: Number, default: undefined },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    const elapsed = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined
    watch([() => props.phase, theme.reducedMotion], () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      if (props.phase !== undefined || theme.reducedMotion.value) return
      const start = Date.now()
      timer = setInterval(() => {
        elapsed.value = Date.now() - start
      }, TICK_MS)
    }, { immediate: true })
    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer)
    })
    return () => {
      const t = theme.tokens.value
      const phase = props.phase ?? elapsed.value
      const cycle = (((phase % PERIOD) + PERIOD) % PERIOD) / PERIOD
      const opacity = theme.reducedMotion.value ? 1 : 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(2 * Math.PI * cycle))
      return (
        <div style={{ fontFamily: fonts.sans, color: t.ink2, opacity }} role="status">
          {slots.default?.()}
        </div>
      )
    }
  },
})
