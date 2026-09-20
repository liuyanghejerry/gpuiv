/** Animation helpers for keyframe effects GPUIV has no CSS engine for. */
import { onMounted, onBeforeUnmount, ref, type Ref } from "vue"

export function useShimmer(durationMs = 1800): Ref<number> {
  const progress = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    const start = Date.now()
    timer = setInterval(() => {
      const t = ((Date.now() - start) % durationMs) / durationMs
      progress.value = t < 0.5 ? t * 2 : 2 * (1 - t)
    }, 30)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return progress
}

export interface PixelPattern { delays: (number | null)[]; dur: number; round: boolean }

export function usePixelLoader(pattern: PixelPattern, start = true): Ref<number[]> {
  const phases = ref(pattern.delays.map(() => 0))
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    if (!start) return
    const t0 = Date.now()
    timer = setInterval(() => {
      const elapsed = Date.now() - t0
      phases.value = pattern.delays.map((d) => d === null ? 0 : ((elapsed % pattern.dur) - d + pattern.dur) % pattern.dur)
    }, 30)
  })
  onBeforeUnmount(() => clearInterval(timer))
  return phases
}

export function useCaretBlink(intervalMs = 530): Ref<boolean> {
  const visible = ref(true)
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => { let on = true; timer = setInterval(() => { on = !on; visible.value = on }, intervalMs) })
  onBeforeUnmount(() => clearInterval(timer))
  return visible
}
