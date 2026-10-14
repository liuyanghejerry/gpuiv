/** Cursor — adapted from animal-island-vue (MIT).
 * GPUI cannot set cursor:url(...) or cursor:none. This is a local decorative
 * pointer follower; the OS pointer remains visible. The original arrow/drop
 * SVG is preserved, with a press ring and point. `forceAll` sets the wrapper's
 * default system pointer only: descendant component cursor styles still win.
 * It never modifies native GPUI cursor state or arbitrary child vnodes.
 */
import { defineComponent, ref, type PropType } from "vue"
import { motion, useElementBounds, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors } from "../tokens.js"

export type CursorType = "default" | "raindrop"
export interface CursorProps { type?: CursorType; forceAll?: boolean; testId?: string }
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
const ARROW = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M6 4 L6 21 L10.5 16.5 L13.5 23 L16.8 21.5 L13.8 15.2 L20.5 15.2 Z" fill="#fff7e6" stroke="#794f27" stroke-width="2.2" stroke-linejoin="round"/></svg>')
const RAINDROP = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 6s-9 12-9 16a9 9 0 0 0 18 0c0-4-9-16-9-16z" fill="#74ccff" stroke="#2e86ab" stroke-width="1.5"/><ellipse cx="12.5" cy="19" rx="2" ry="3.2" fill="#dff4ff" transform="rotate(-18 12.5 19)"/></svg>')

export const Cursor = defineComponent({
  name: "AnimalCursor",
  inheritAttrs: false,
  props: {
    type: { type: String as PropType<CursorType>, default: "default" },
    forceAll: { type: Boolean, default: true },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const root = ref<HostNode | null>(null)
    const { measure } = useElementBounds(root, { intervalMs: false })
    const point = ref<{ x: number; y: number } | null>(null)
    const pressed = ref(false)
    function move(event: EventPayload) {
      const box = measure()
      if (!box || event.x == null || event.y == null) return
      const x = event.x - box.x, y = event.y - box.y
      point.value = x >= 0 && y >= 0 && x <= box.width && y <= box.height ? { x, y } : null
    }
    const forward = (name: string, event: EventPayload) => (attrs[name] as ((event: EventPayload) => void) | undefined)?.(event)
    return () => {
      const drop = props.type === "raindrop"
      const ringSize = pressed.value ? 20 : 30
      const ink = drop ? "#2e86ab" : colors.warm
      return <div {...attrs} ref={root} testId={props.testId}
        onMouseEnter={(e: EventPayload) => { move(e); forward("onMouseEnter", e) }}
        onMouseMove={(e: EventPayload) => { move(e); pressed.value = e.pressedButton != null; forward("onMouseMove", e) }}
        onMouseLeave={(e: EventPayload) => { point.value = null; pressed.value = false; forward("onMouseLeave", e) }}
        onMouseDown={(e: EventPayload) => { move(e); pressed.value = true; forward("onMouseDown", e) }}
        onMouseUp={(e: EventPayload) => { move(e); pressed.value = false; forward("onMouseUp", e) }}
        style={{ position: "relative", ...(props.forceAll ? { cursor: "default" } : {}), ...(attrs.style as StyleDesc | undefined) }}>
        {slots.default?.()}
        {point.value ? <>
          <motion.div aria-hidden={true} initial={false} animate={{ width: ringSize, height: ringSize, opacity: pressed.value ? 0.75 : 0.4 }}
            transition={{ duration: 0.12 }} {...{ testId: props.testId ? `${props.testId}-ring` : undefined }}
            style={{ position: "absolute", left: point.value.x - ringSize / 2, top: point.value.y - ringSize / 2,
              borderRadius: 999, borderWidth: 1.5, borderColor: ink, pointerEvents: "none" }} />
          <div aria-hidden={true} testId={props.testId ? `${props.testId}-point` : undefined}
            style={{ position: "absolute", left: point.value.x - 2, top: point.value.y - 2, width: 4, height: 4,
              borderRadius: 999, backgroundColor: ink, pointerEvents: "none" }} />
          <img aria-hidden={true} src={drop ? RAINDROP : ARROW} objectFit="contain" testId={props.testId ? `${props.testId}-follower` : undefined}
            style={{ position: "absolute", left: point.value.x - (drop ? 16 : 6), top: point.value.y - (drop ? 6 : 4),
              width: drop ? 32 : 28, height: drop ? 32 : 28, pointerEvents: "none" }} />
        </> : null}
      </div>
    }
  },
})
export default Cursor
