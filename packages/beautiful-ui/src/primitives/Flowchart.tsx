/** Draggable workflow editor, ported from beautiful-ui's Flowchart (MIT).
 * Connectors use the native canvas; controls and labels remain GPUI elements.
 */
import { computed, defineComponent, nextTick, onBeforeUnmount, ref, watch, type PropType } from "vue"
import {
  GpuixCanvas,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useElementBounds,
  type EventPayload,
  type GpuixCanvasInstance,
  type HostNode,
} from "@gpuiv/vue"
import { useTheme } from "../theme.js"
import { fonts } from "../tokens.js"
import { mix, toSrgb } from "../colors.js"
import { activationKeys } from "../interaction.js"

export interface StepNode {
  id: string
  row: number
  /** Horizontal center, as a fraction of canvas width. */
  x: number
  w: number
  kind?: { label: string; hue: string }
  hue?: string
  title?: string
  caption?: string
  condition?: boolean
}
export interface FlowchartEdge {
  from: string
  to: string
}
export interface FlowchartOffset {
  dx: number
  dy: number
}
const DEFAULT_STEPS: StepNode[] = [
  {
    id: "trigger",
    row: 0,
    x: 0.5,
    w: 300,
    kind: { label: "Trigger", hue: "#9a5cff" },
    hue: "#9a5cff",
    title: "New order created",
    caption: "Trigger when a new order is created",
  },
  { id: "cond", row: 1, x: 0.5, w: 356, kind: { label: "If / Else", hue: "#f09a2f" }, condition: true },
]
const PROPERTIES = ["flavor", "topping", "size", "scoops"]
const FLAVORS = ["Rocky Road", "Mint Chip", "Pistachio", "Bubblegum"]
const TOPPINGS = ["Brown butter bourbon brittle crunch", "Rainbow sprinkles", "Hot fudge", "Candied pecans"]

export const Flowchart = defineComponent({
  name: "BuiFlowchart",
  props: {
    steps: { type: Array as PropType<StepNode[]>, default: () => DEFAULT_STEPS },
    edges: { type: Array as PropType<FlowchartEdge[]>, default: () => [{ from: "trigger", to: "cond" }] },
    onMove: { type: Function as PropType<(id: string, offset: FlowchartOffset) => void>, default: undefined },
    onConditionChange: {
      type: Function as PropType<(id: string, values: Record<string, string>) => void>,
      default: undefined,
    },
  },
  setup(props) {
    const theme = useTheme()
    const root = ref<HostNode | null>(null)
    const canvas = ref<GpuixCanvasInstance | null>(null)
    const { bounds } = useElementBounds(root)
    const width = computed(() => Math.max(24, Math.round(bounds.value?.width ?? 480)))
    const offsets = ref<Record<string, FlowchartOffset>>({})
    const selected = ref<string | null>(null)
    const openChip = ref<string | null>(null)
    const values = ref<Record<string, Record<string, string>>>({})
    const heightOf = (n: StepNode) => 30 + (n.condition ? 132 : 62)
    const rows = computed(() => [...new Set(props.steps.map((n) => n.row))].sort((a, b) => a - b))
    const rowY = computed(() => {
      let y = 24
      return Object.fromEntries(
        rows.value.map((row) => {
          const entry = [row, y]
          y += Math.max(...props.steps.filter((n) => n.row === row).map(heightOf)) + 64
          return entry
        }),
      ) as Record<number, number>
    })
    const height = computed(() =>
      props.steps.length ? Math.max(...props.steps.map((n) => rowY.value[n.row]! + heightOf(n))) + 24 : 48,
    )
    const place = (n: StepNode) => {
      const w = Math.min(n.w, width.value * 0.92)
      const offset = offsets.value[n.id] ?? { dx: 0, dy: 0 }
      const cx = Math.max(w / 2 + 8, Math.min(width.value - w / 2 - 8, n.x * width.value + offset.dx))
      const top = Math.max(8, Math.min(height.value - heightOf(n) - 8, rowY.value[n.row]! + offset.dy))
      return { w, cx, top }
    }
    const move = (n: StepNode, dx: number, dy: number) => {
      offsets.value = { ...offsets.value, [n.id]: { dx, dy } }
      const p = place(n)
      const offset = { dx: p.cx - n.x * width.value, dy: p.top - rowY.value[n.row]! }
      offsets.value[n.id] = offset
      props.onMove?.(n.id, offset)
    }
    let drag: { node: StepNode; x: number; y: number; base: FlowchartOffset; moved: boolean } | undefined
    const press = (n: StepNode, e: EventPayload) => {
      drag = { node: n, x: e.x ?? 0, y: e.y ?? 0, base: offsets.value[n.id] ?? { dx: 0, dy: 0 }, moved: false }
    }
    const dragMove = (e: EventPayload) => {
      if (!drag) return
      const dx = (e.x ?? 0) - drag.x,
        dy = (e.y ?? 0) - drag.y
      if (Math.hypot(dx, dy) < 3 && !drag.moved) return
      drag.moved = true
      move(drag.node, drag.base.dx + dx, drag.base.dy + dy)
    }
    const release = () => {
      drag = undefined
    }
    const keys = (n: StepNode, e: EventPayload) => {
      const off = offsets.value[n.id] ?? { dx: 0, dy: 0 }
      const step = e.modifiers?.shift ? 10 : 1
      if (e.key === "left") move(n, off.dx - step, off.dy)
      else if (e.key === "right") move(n, off.dx + step, off.dy)
      else if (e.key === "up") move(n, off.dx, off.dy - step)
      else if (e.key === "down") move(n, off.dx, off.dy + step)
      else
        activationKeys(() => {
          selected.value = selected.value === n.id ? null : n.id
        })(e)
    }
    let disposed = false
    onBeforeUnmount(() => {
      disposed = true
      drag = undefined
    })
    watch(
      [width, height, offsets, selected, () => props.steps, () => props.edges, () => theme.tokens.value],
      async () => {
        await nextTick()
        if (disposed) return
        const ctx = canvas.value?.getContext("2d")
        if (!ctx) return
        ctx.clearRect(0, 0, width.value, height.value)
        ctx.fillStyle = toSrgb(theme.tokens.value.lineStrong)
        for (let x = 11; x < width.value; x += 22)
          for (let y = 11; y < height.value; y += 22) {
            ctx.beginPath()
            ctx.arc(x, y, 1, 0, Math.PI * 2)
            ctx.fill()
          }
        for (const edge of props.edges) {
          const from = props.steps.find((n) => n.id === edge.from),
            to = props.steps.find((n) => n.id === edge.to)
          if (!from || !to) continue
          const a = place(from),
            b = place(to)
          const ay = a.top + heightOf(from),
            by = b.top + 30
          const k = Math.min(84, Math.max(24, Math.abs(by - ay) * 0.55))
          ctx.strokeStyle = toSrgb(
            selected.value === from.id || selected.value === to.id
              ? theme.tokens.value.accent
              : theme.tokens.value.lineStrong,
          )
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.moveTo(a.cx, ay)
          ctx.bezierCurveTo(a.cx, ay + k, b.cx, by - k, b.cx, by)
          ctx.stroke()
        }
      },
      { immediate: true, deep: true },
    )
    const chip = (n: StepNode, key: string, options: string[], fallback: string) => {
      const t = theme.tokens.value
      return (
        <Select
          open={openChip.value === `${n.id}:${key}`}
          onOpenChange={(open: boolean) => {
            openChip.value = open ? `${n.id}:${key}` : null
          }}
          value={values.value[n.id]?.[key] ?? fallback}
          onValueChange={(value: string) => {
            values.value = {
              ...values.value,
              [n.id]: {
                prop1: "flavor",
                val1: "Rocky Road",
                prop2: "topping",
                val2: TOPPINGS[0]!,
                ...values.value[n.id],
                [key]: value,
              },
            }
            props.onConditionChange?.(n.id, { ...values.value[n.id] })
          }}
        >
          <SelectTrigger
            {...{
              testId: `flowchart-${n.id}-${key}`,
              role: "combobox",
              "aria-label": `${key} condition`,
              "aria-expanded": openChip.value === `${n.id}:${key}`,
            }}
            style={{
              height: 24,
              borderRadius: 6,
              paddingLeft: 6,
              paddingRight: 6,
              backgroundColor: t.field,
              fontSize: 12,
              color: t.ink,
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            {...{ testId: "flowchart-condition-menu", role: "listbox", "aria-label": "Condition options" }}
            style={{
              width: key.startsWith("val") ? 260 : 144,
              padding: 4,
              borderRadius: 10,
              backgroundColor: t.surface,
              ...theme.shadows.value.raised,
            }}
          >
            {options.map((value) => (
              <SelectItem
                key={value}
                value={value}
                {...{ role: "option", "aria-selected": (values.value[n.id]?.[key] ?? fallback) === value }}
                style={{
                  height: 30,
                  fontSize: 12,
                  color: t.ink,
                  paddingLeft: 8,
                  paddingRight: 8,
                  hover: { backgroundColor: t.hover },
                }}
              >
                <div>{value}</div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    return () => {
      const t = theme.tokens.value
      return (
        <div
          ref={root}
          testId="flowchart"
          style={{
            fontFamily: fonts.sans,
            position: "relative",
            width: "100%",
            height: height.value,
            overflow: "hidden",
            borderRadius: 18,
            backgroundColor: t.page,
            ...theme.shadows.value.hairline,
          }}
        >
          <GpuixCanvas
            ref={canvas}
            width={width.value}
            height={height.value}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: width.value,
              height: height.value,
              pointerEvents: "none",
            }}
          />
          {props.steps.map((n) => {
            const p = place(n),
              active = selected.value === n.id
            return (
              <div
                key={n.id}
                style={{
                  position: "absolute",
                  left: p.cx - p.w / 2,
                  top: p.top,
                  width: p.w,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  testId={`flowchart-drag-${n.id}`}
                  role="button"
                  aria-label={`Move ${n.kind?.label ?? n.title ?? n.id}; arrow keys move the card`}
                  aria-pressed={active}
                  tabIndex={0}
                  onMouseDown={(e: EventPayload) => press(n, e)}
                  onMouseMove={dragMove}
                  onMouseUp={release}
                  onKeyDown={(e: EventPayload) => keys(n, e)}
                  style={{
                    height: 24,
                    alignSelf: "flex-start",
                    paddingLeft: 8,
                    paddingRight: 8,
                    borderRadius: 6,
                    fontSize: 11.5,
                    color: n.kind ? mix(n.kind.hue, t.ink, 20) : t.ink,
                    backgroundColor: n.kind ? mix(n.kind.hue, t.page, 86) : t.field,
                    cursor: "grab",
                  }}
                >
                  {n.kind?.label ?? "Move"}
                </div>
                <div
                  testId={`flowchart-node-${n.id}`}
                  style={{
                    height: n.condition ? 132 : 62,
                    padding: 10,
                    borderRadius: 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    backgroundColor: t.surface,
                    ...(active ? { borderWidth: 1.5, borderColor: t.accent } : theme.shadows.value.card),
                  }}
                >
                  {n.condition ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          height: 26,
                          fontSize: 12.5,
                          color: t.ink2,
                        }}
                      >
                        If order {chip(n, "prop1", PROPERTIES, "flavor")} is {chip(n, "val1", FLAVORS, "Rocky Road")}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          height: 26,
                          fontSize: 12.5,
                          color: t.ink2,
                        }}
                      >
                        and order {chip(n, "prop2", PROPERTIES, "topping")} is
                      </div>
                      <div style={{ alignSelf: "flex-start", marginLeft: 49 }}>
                        {chip(n, "val2", TOPPINGS, TOPPINGS[0]!)}
                      </div>
                    </>
                  ) : (
                    <div
                      role="button"
                      aria-pressed={active}
                      tabIndex={0}
                      testId={`flowchart-select-${n.id}`}
                      onClick={() => {
                        selected.value = active ? null : n.id
                      }}
                      onKeyDown={activationKeys(() => {
                        selected.value = active ? null : n.id
                      })}
                      style={{ display: "flex", flexDirection: "column", gap: 3, cursor: "pointer", color: t.ink }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: t.ink2 }}>{n.caption}</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )
    }
  },
})
