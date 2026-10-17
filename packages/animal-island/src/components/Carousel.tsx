/** Carousel — ported from animal-island-vue (MIT).
 * Native adaptation: CSS translateX becomes a native left/opacity tween; controls keep
 * their original geometry and colours. All slides stay mounted and preserve
 * their local state. Natural layout skips `display: none` pages, so hidden
 * slides cannot affect size, hit-testing or tab order; the outgoing page
 * remains visible for the crossfade window like React's visibility transition.
 * Native focus does not bubble as DOM focusin does, so subtree focus is checked
 * every 100 ms as well as immediately for this component's controls. A focus
 * handle inside a hidden slide no longer counts as focus inside the carousel.
 * GPUIV supports role/label but ignores aria-roledescription, aria-hidden,
 * aria-current and aria-disabled; `display: none` removes hidden pages from
 * layout and input. Hover listeners
 * also cover the viewport, controls and direct slide root, since filled native
 * children can block ancestor hitboxes. A custom slide's deeper filled
 * descendants must forward hover events to its root for pauseOnHover to cover
 * their areas.
 */
import { Comment, Fragment, cloneVNode, computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType, type VNode } from "vue"
import { motion, useElementBounds, useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fonts, radius, shadows } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { ColorSurface } from "./surface-motion.js"

export interface CarouselProps {
  modelValue?: number
  activeIndex?: number
  defaultActiveIndex?: number
  autoplay?: boolean
  interval?: number
  loop?: boolean
  showArrows?: boolean
  showDots?: boolean
  pauseOnHover?: boolean
  ariaLabel?: string
  /** Set zero to disable the native opacity transition. */
  duration?: number
  testId?: string
}

export interface CarouselExpose {
  goTo(index: number): void
  next(): void
  prev(): void
  pause(): void
  play(): void
  readonly currentIndex: number
}

function flatten(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => node.type === Fragment
    ? flatten((node.children as VNode[] | null) ?? [])
    : node.type === Comment ? [] : [node])
}
const clamp = (value: number, last: number) => Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value) : 0, 0), Math.max(last, 0))

export const Carousel = defineComponent({
  name: "AnimalCarousel",
  inheritAttrs: false,
  props: {
    modelValue: { type: Number, default: undefined },
    activeIndex: { type: Number, default: undefined },
    defaultActiveIndex: { type: Number, default: 0 },
    autoplay: { type: Boolean, default: false },
    interval: { type: Number, default: 3000 },
    loop: { type: Boolean, default: true },
    showArrows: { type: Boolean, default: true },
    showDots: { type: Boolean, default: true },
    pauseOnHover: { type: Boolean, default: true },
    ariaLabel: { type: String, default: "轮播图" },
    duration: { type: Number, default: 0.3 },
    testId: { type: String, default: undefined },
    onChange: { type: Function as PropType<(index: number) => void>, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const root = ref<HostNode | null>(null)
    const viewport = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(viewport)
    // Controls need dimensions, not the viewport's moving scroll coordinates.
    const viewportWidth = computed(() => bounds.value?.width ?? 600)
    const viewportHeight = computed(() => bounds.value?.height ?? 180)
    const { renderer } = useGpuix()
    const count = ref(0)
    const internalIndex = ref(props.defaultActiveIndex)
    const previousIndex = ref<number | null>(null)
    const hoverPaused = ref(false)
    const focusPaused = ref(false)
    const rotationPaused = ref(false)
    const focusedControl = ref<string | null>(null)
    const currentIndex = computed(() => clamp(props.activeIndex ?? props.modelValue ?? internalIndex.value, count.value - 1))
    const paused = computed(() => hoverPaused.value || focusPaused.value || rotationPaused.value)
    let timer: ReturnType<typeof setInterval> | undefined
    let focusTimer: ReturnType<typeof setInterval> | undefined
    let leaveTimer: ReturnType<typeof setTimeout> | undefined
    // Explicit Play is allowed while focus remains inside, as in the original.
    let focusedId: number | null | undefined

    function goTo(index: number) {
      if (count.value === 0 || !Number.isFinite(index)) return
      const normalized = props.loop
        ? ((Math.trunc(index) % count.value) + count.value) % count.value
        : clamp(index, count.value - 1)
      if (normalized === currentIndex.value) return
      if (props.modelValue === undefined && props.activeIndex === undefined) internalIndex.value = normalized
      ;(attrs["onUpdate:modelValue"] as ((value: number) => void) | undefined)?.(normalized)
      props.onChange?.(normalized)
    }
    function play() {
      rotationPaused.value = false
      hoverPaused.value = false
      focusPaused.value = false
    }
    function pause() { rotationPaused.value = true }
    const next = () => goTo(currentIndex.value + 1)
    const prev = () => goTo(currentIndex.value - 1)
    expose({ goTo, next, prev, pause, play, get currentIndex() { return currentIndex.value } } satisfies CarouselExpose)

    function syncTimer() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      if (!props.autoplay || paused.value || count.value < 2) return
      const interval = Number.isFinite(props.interval) ? Math.max(props.interval, 1000) : 3000
      timer = setInterval(next, interval)
    }
    watch([() => props.autoplay, () => props.interval, paused, count, currentIndex], syncTimer, { flush: "post" })

    function containsVisible(node: HostNode | null, id: number): boolean {
      if (!node) return false
      const style = node.props.style as StyleDesc | undefined
      if (style?.display === "none") return false
      return node.id === id || node.children.some((child) => containsVisible(child, id))
    }
    function syncFocus(force = false) {
      if (!renderer?.getFocusedElementId) return
      const id = renderer.getFocusedElementId()
      if (!force && id === focusedId) return
      const previous = focusedId
      focusedId = id
      if (id == null) {
        // No native focus id is not the same as a blur. Keep an explicit
        // onFocus pause until focus actually moves from an element to none.
        if (previous != null) focusPaused.value = false
        return
      }
      // A focused descendant of a hidden slide is no longer on screen; React's
      // visibility transition loses that focus too. Do not let a stale native
      // focus handle keep autoplay paused.
      focusPaused.value = containsVisible(root.value, id)
    }
    watch(currentIndex, (nextIndex, previous) => {
      if (leaveTimer !== undefined) {
        clearTimeout(leaveTimer)
        leaveTimer = undefined
      }
      previousIndex.value = null
      if (props.duration > 0 && previous !== undefined && previous !== nextIndex && count.value > 1) {
        previousIndex.value = previous
        leaveTimer = setTimeout(() => {
          previousIndex.value = null
          leaveTimer = undefined
        }, Math.max(0, props.duration) * 1000)
      }
    }, { flush: "pre" })
    // Re-evaluate after the render that applies display:none, not before it.
    watch([currentIndex, previousIndex], () => syncFocus(true), { flush: "post" })
    onMounted(() => { syncTimer(); focusTimer = setInterval(syncFocus, 100) })
    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer)
      if (focusTimer !== undefined) clearInterval(focusTimer)
      if (leaveTimer !== undefined) clearTimeout(leaveTimer)
    })
    function onFocus(name: string) {
      focusedControl.value = name
      focusPaused.value = true
      focusedId = renderer?.getFocusedElementId?.()
    }
    function onBlur() {
      focusedControl.value = null
      if (!renderer?.getFocusedElementId) {
        focusPaused.value = false
        return
      }
      focusedId = renderer.getFocusedElementId()
      focusPaused.value = focusedId != null && containsVisible(root.value, focusedId)
    }
    function keyDown(event: EventPayload) {
      if (event.key === "left") prev()
      else if (event.key === "right") next()
      else if (event.key === "home") goTo(0)
      else if (event.key === "end") goTo(count.value - 1)
    }
    const hoverEnter = () => { if (props.pauseOnHover) hoverPaused.value = true }
    const hoverLeave = () => { hoverPaused.value = false }
    function control(name: string, label: string, action: () => void, style: StyleDesc, disabled = false, content: unknown = null, selected?: boolean) {
      return <ColorSurface role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined} aria-selected={selected}
        testId={props.testId ? `${props.testId}-${name}` : undefined}
        onClick={disabled ? undefined : action} onKeyDown={disabled ? undefined : activationKeys(action)}
        onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}
        onFocus={() => onFocus(name)} onBlur={onBlur}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none", cursor: disabled ? "not-allowed" : "pointer",
          ...(disabled ? { opacity: 0.4 } : {}), ...style,
          ...(focusedControl.value === name ? { outline: { width: 2, color: colors.primary, offset: 2 } } : {}) }} transition={{ duration: 0.25, ease }}>
        {{ default: () => [
          content
        ] }}
      </ColorSurface>
    }
    return () => {
      // Read the slot only inside render so reactive slot children track correctly.
      const slides = flatten(slots.default?.() ?? [])
      count.value = slides.length
      const index = currentIndex.value
      const leaving = previousIndex.value
      const hasControls = slides.length > 1
      const compact = viewportWidth.value <= 480
      const arrowSize = compact ? 36 : 42
      const arrowStyle: StyleDesc = { position: "absolute", top: Math.max(0, (viewportHeight.value - arrowSize) / 2),
        width: arrowSize, height: arrowSize, borderWidth: 1.5, borderColor: "rgba(121,79,39,0.16)", borderRadius: radius.pill,
        backgroundColor: "rgba(255,255,255,0.92)", color: colors.text, boxShadow: shadows.sm,
        hover: { color: colors.primaryActive } }
      return <div {...attrs} ref={root} role="region" aria-description="轮播图" aria-label={props.ariaLabel} tabIndex={0} testId={props.testId}
        onKeyDown={keyDown} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave} onFocus={() => onFocus("region")} onBlur={onBlur}
        style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", minWidth: 0, borderRadius: 20, ...(fonts.sans ? { fontFamily: fonts.sans } : {}),
          ...(attrs.style as StyleDesc | undefined), ...(focusedControl.value === "region" ? { outline: { width: 2, color: colors.primary, offset: 3 } } : {}) }}>
        <div ref={viewport} testId={props.testId ? `${props.testId}-viewport` : undefined} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}
          style={{ position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 180, borderRadius: 20, backgroundColor: "rgb(247,243,223)" }}>
          {slides.map((slide, slideIndex) => {
            const active = slideIndex === index
            const visible = active || slideIndex === leaving
            const slideStyle: StyleDesc = {
              ...(active
                ? { position: "relative" as const, left: 0 }
                : { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 }),
              width: "100%",
              minHeight: 180,
              display: visible ? "flex" : "none",
              flexDirection: "column",
              pointerEvents: active ? "auto" : "none",
              userSelect: active ? "auto" : "none",
            }
            return <motion.div key={slide.key ?? slideIndex} initial={false}
              animate={{ opacity: active ? 1 : 0, left: active ? 0 : 18 }}
              transition={{ duration: Math.max(0, props.duration), ease }}
              {...{ role: "group", "aria-roledescription": "slide", "aria-label": `第 ${slideIndex + 1} 张，共 ${slides.length} 张`,
                "aria-hidden": active ? undefined : true,
                testId: props.testId ? `${props.testId}-slide-${slideIndex}` : undefined,
                onMouseEnter: hoverEnter, onMouseLeave: hoverLeave }}
              style={slideStyle}>
              {{ default: () => [cloneVNode(slide, { onMouseEnter: hoverEnter, onMouseLeave: hoverLeave })] }}
            </motion.div>
          })}
        </div>
        {hasControls && props.autoplay ? control("rotation", paused.value ? "继续自动播放" : "暂停自动播放", () => paused.value ? play() : pause(),
          { position: "absolute", top: 14, right: 14, minWidth: 58, height: 32, paddingLeft: 12, paddingRight: 12,
            backgroundColor: "rgba(255,255,255,0.92)", borderWidth: 1.5, borderColor: "rgba(121,79,39,0.16)", borderRadius: radius.pill, color: colors.text, fontSize: 12, fontWeight: 700 },
          false, <text>{paused.value ? "播放" : "暂停"}</text>) : null}
        {hasControls && props.showArrows ? control("prev", "上一张", prev, { ...arrowStyle, left: compact ? 8 : 14 }, !props.loop && currentIndex.value === 0, <text style={{ fontSize: 26, lineHeight: 26 }}>‹</text>) : null}
        {hasControls && props.showArrows ? control("next", "下一张", next, { ...arrowStyle, right: compact ? 8 : 14 }, !props.loop && currentIndex.value === slides.length - 1, <text style={{ fontSize: 26, lineHeight: 26 }}>›</text>) : null}
        {hasControls && props.showDots ? <div style={{ position: "absolute", bottom: 14, width: "100%", display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div role="group" aria-label="选择轮播页" onMouseEnter={hoverEnter} onMouseLeave={hoverLeave} style={{ display: "flex", gap: 2, paddingTop: 7, paddingBottom: 7, paddingLeft: 10, paddingRight: 10,
            borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.85)", pointerEvents: "auto" }}>
            {slides.map((_, index) => control(`dot-${index}`, `转到第 ${index + 1} 张`, () => goTo(index), { width: 30, height: 30, borderRadius: radius.pill }, false,
              <ColorSurface geometry={["width"]} aria-current={index === currentIndex.value ? "true" : undefined} style={{ width: index === currentIndex.value ? 24 : 10, height: 10, borderRadius: radius.pill,
                backgroundColor: index === currentIndex.value ? colors.primary : colors.shadowSoft, pointerEvents: "none" }} transition={{ duration: 0.25, ease }} />, index === currentIndex.value))}
          </div>
        </div> : null}
      </div>
    }
  },
})
export default Carousel
