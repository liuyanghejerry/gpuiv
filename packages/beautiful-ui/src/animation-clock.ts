import { onBeforeUnmount, onMounted, ref, watch } from "vue"

type Subscriber = (now: number) => void
const clocks = new Map<number, { timer: ReturnType<typeof setInterval>; subscribers: Set<Subscriber> }>()

/** Internal test diagnostic; does not change clock ownership or cadence. */
export function getAnimationClockStatsForTests() {
  return { clocks: clocks.size, subscribers: [...clocks.values()].reduce((sum, clock) => sum + clock.subscribers.size, 0) }
}

function subscribe(intervalMs: number, sample: Subscriber): () => void {
  let clock = clocks.get(intervalMs)
  if (!clock) {
    const subscribers = new Set<Subscriber>()
    const timer = setInterval(() => {
      const now = performance.now()
      for (const subscriber of subscribers) subscriber(now)
    }, intervalMs)
    clock = { timer, subscribers }
    clocks.set(intervalMs, clock)
  }
  clock.subscribers.add(sample)
  return () => {
    clock.subscribers.delete(sample)
    if (clock.subscribers.size === 0) {
      clearInterval(clock.timer)
      clocks.delete(intervalMs)
    }
  }
}

/** Sample decorative motion together so Vue sends one mutation batch per
 * tick. A pinned phase has no timer; false suspends decorative motion. */
export function useAnimationClock(phase: () => number | undefined, cadence: () => number | false) {
  const elapsed = ref(0)
  let release: (() => void) | undefined
  onMounted(() => {
    const started = performance.now()
    watch([phase, cadence], ([pinned, intervalMs]) => {
      release?.()
      release = undefined
      if (pinned !== undefined || intervalMs === false) return
      release = subscribe(intervalMs, now => { elapsed.value = now - started })
    }, { immediate: true })
  })
  onBeforeUnmount(() => { release?.() })
  return elapsed
}
