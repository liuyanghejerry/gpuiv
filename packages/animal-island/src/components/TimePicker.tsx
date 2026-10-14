/** TimePicker — ported from animal-island-vue TimePicker.vue (MIT).
 * Retains controlled/default values and open state, pending confirmation,
 * clear, formatting, per-unit steps, keyboard and current-time shortcut.
 * FloatingLayer replaces DOM geometry/outside listeners. Because GPUIV
 * prohibits nested scrollers, each column shows seven rows and pages through
 * all step-filtered values with wheel/buttons/keys; no overflow scroll is
 * created. Rows retain the original 28px height, cream panel and amber state.
 * Native popup dismissal is immediate; content uses a 0.2s opacity entrance.
 */
import { computed, defineComponent, h, reactive, ref, watch, type PropType } from "vue"
import { FloatingLayer, motion, useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fonts } from "../tokens.js"
import { normalizePickerKey, pad2, pickerButton, pickerFooterStyle, pickerIcons, pickerPanelStyle, pickerTriggerStyle, usePickerPopup, type PickerSize, type PickerStatus } from "./picker-utils.js"

export type TimePickerSize = PickerSize
export type TimePickerStatus = PickerStatus
export type TimePart = { h: number; m: number; s: number }
export interface TimePickerProps {
  modelValue?: string | null; defaultValue?: string | null; placeholder?: string
  disabled?: boolean; allowClear?: boolean; size?: TimePickerSize; status?: TimePickerStatus
  format?: string; hourStep?: number; minuteStep?: number; secondStep?: number; open?: boolean
  ariaLabel?: string; ariaLabelledBy?: string; testId?: string
  onChange?: (value: string | null) => void; onOpenChange?: (open: boolean) => void
}

function parseTime(value: string | null | undefined): TimePart | null {
  const match = value && /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value)
  if (!match) return null
  const part = { h: Number(match[1]), m: Number(match[2]), s: Number(match[3] ?? 0) }
  return part.h > 23 || part.m > 59 || part.s > 59 ? null : part
}
const toValue = (part: TimePart) => `${pad2(part.h)}:${pad2(part.m)}:${pad2(part.s)}`
const formatTime = (part: TimePart, format: string) => format.replace(/HH|mm|ss|H|m|s/g, (token) => ({ HH: pad2(part.h), mm: pad2(part.m), ss: pad2(part.s), H: `${part.h}`, m: `${part.m}`, s: `${part.s}` })[token]!)
function options(limit: number, step: number) {
  const stride = Number.isFinite(step) ? Math.max(1, step) : 1
  return Array.from({ length: limit }, (_, i) => i).filter((value) => value % stride === 0)
}
const units: { part: keyof TimePart; label: string }[] = [{ part: "h", label: "时" }, { part: "m", label: "分" }, { part: "s", label: "秒" }]

export const TimePicker = defineComponent({
  name: "AnimalTimePicker", inheritAttrs: false,
  props: {
    modelValue: { type: String as PropType<string | null | undefined>, default: undefined },
    defaultValue: { type: String as PropType<string | null>, default: null },
    placeholder: { type: String, default: "请选择时间" }, disabled: { type: Boolean, default: false },
    allowClear: { type: Boolean, default: false }, size: { type: String as PropType<TimePickerSize>, default: "middle" },
    status: { type: String as PropType<TimePickerStatus>, default: undefined }, format: { type: String, default: "HH:mm:ss" },
    hourStep: { type: Number, default: 1 }, minuteStep: { type: Number, default: 1 }, secondStep: { type: Number, default: 1 },
    open: { type: Boolean, default: undefined }, ariaLabel: { type: String, default: undefined },
    ariaLabelledBy: { type: String, default: undefined }, testId: { type: String, default: undefined },
  },
  emits: ["update:modelValue", "change", "update:open", "openChange"],
  setup(props, { attrs, emit }) {
    const innerValue = ref<string | null>(props.defaultValue)
    const current = computed(() => props.modelValue !== undefined ? props.modelValue : innerValue.value)
    const pending = ref<TimePart>({ h: 0, m: 0, s: 0 })
    const activeUnit = ref<keyof TimePart>("h")
    const starts = reactive<TimePart>({ h: 0, m: 0, s: 0 })
    const panel = ref<HostNode | null>(null)
    const { renderer } = useGpuix()
    const hasSeconds = computed(() => props.format.includes("ss"))
    const values = computed(() => ({ h: options(24, props.hourStep), m: options(60, props.minuteStep), s: hasSeconds.value ? options(60, props.secondStep) : [] }))
    const popup = usePickerPopup(props, emit, () => {
      pending.value = parseTime(current.value) ?? { h: 0, m: 0, s: 0 }
      activeUnit.value = "h"; centerColumns()
    })
    function centerColumns() {
      for (const { part } of units) {
        const list = values.value[part]
        const exact = list.indexOf(pending.value[part])
        const nearest = exact >= 0 ? exact : Math.max(0, list.findIndex((unit) => unit >= pending.value[part]))
        starts[part] = Math.max(0, Math.min(nearest - 3, list.length - 7))
      }
    }
    watch([() => props.format, () => props.hourStep, () => props.minuteStep, () => props.secondStep], () => { if (popup.open.value) centerColumns() })
    function commit(value: string | null) {
      if (props.modelValue === undefined) innerValue.value = value
      emit("update:modelValue", value); emit("change", value)
    }
    function confirm() {
      if (props.disabled) return
      const next = toValue(pending.value)
      if (next !== current.value) commit(next)
      popup.setOpen(false)
    }
    function clear() {
      if (props.disabled) return
      commit(null); pending.value = { h: 0, m: 0, s: 0 }; centerColumns()
    }
    function now() {
      if (props.disabled) return
      const date = new Date()
      pending.value = { h: date.getHours(), m: date.getMinutes(), s: date.getSeconds() }; centerColumns()
    }
    function pick(part: keyof TimePart, value: number) {
      if (props.disabled) return
      activeUnit.value = part; pending.value = { ...pending.value, [part]: value }
    }
    function page(part: keyof TimePart, delta: number) {
      starts[part] = Math.max(0, Math.min(values.value[part].length - 7, starts[part] + delta))
    }
    function move(part: keyof TimePart, delta: number, edge?: "start" | "end") {
      const list = values.value[part]
      const index = list.indexOf(pending.value[part])
      const next = edge === "start" ? 0 : edge === "end" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, Math.max(index, 0) + delta))
      if (list[next] !== undefined) { pick(part, list[next]); centerColumns() }
    }
    function keyDown(event: EventPayload) {
      if (props.disabled) return
      const key = normalizePickerKey(event.key)
      if (popup.open.value && (key === "escape" || key === "tab")) { popup.setOpen(false, key !== "tab"); return }
      const focusId = renderer?.getFocusedElementId?.()
      if (focusId != null && focusId !== popup.trigger.value?.id && focusId !== panel.value?.id) return
      if (!popup.open.value) {
        if (["enter", "space", "down", "up"].includes(key)) popup.setOpen(true)
        return
      }
      if (key === "enter") { confirm(); return }
      if (key === "left" || key === "right") {
        const available = units.filter(({ part }) => part !== "s" || hasSeconds.value)
        const index = available.findIndex(({ part }) => part === activeUnit.value)
        activeUnit.value = available[Math.max(0, Math.min(available.length - 1, index + (key === "left" ? -1 : 1)))].part
      } else if (key === "up" || key === "down") move(activeUnit.value, key === "up" ? -1 : 1)
      else if (key === "pageup" || key === "pagedown") move(activeUnit.value, key === "pageup" ? -7 : 7)
      else if (key === "home" || key === "end") move(activeUnit.value, 0, key === "home" ? "start" : "end")
    }
    const id = (suffix: string) => props.testId ? `${props.testId}-${suffix}` : undefined
    function column(part: keyof TimePart, label: string) {
      const list = values.value[part]
      return <div key={part} style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div style={{ height: 20, display: "flex", justifyContent: "center", alignItems: "center", color: "#a09080", fontSize: 11, fontWeight: 700 }}><text>{label}</text></div>
        {pickerButton("⌃", () => page(part, -7), { testId: id(`${part}-prev`), ariaLabel: `上一页${label}`, disabled: starts[part] === 0,
          style: { height: 18, padding: 0, color: starts[part] === 0 ? colors.textDisabled : colors.warmSoft } })}
        <div testId={id(`${part}-column`)} stopWheelPropagation={true}
          onScroll={(event: EventPayload) => { if (!props.disabled && event.deltaY) page(part, event.deltaY > 0 ? 1 : -1) }}
          style={{ display: "flex", flexDirection: "column", gap: 2, height: 208, padding: 2, pointerEvents: "auto" }}>
          {list.slice(starts[part], starts[part] + 7).map((value) => {
            const selected = pending.value[part] === value
            return pickerButton(pad2(value), () => pick(part, value), {
              testId: id(`${part}-${value}`), ariaLabel: `${value} ${label}`, selected,
              style: { height: 28, padding: 0, flexShrink: 0, borderRadius: 16, fontSize: 13,
                fontWeight: selected ? 700 : 500, color: selected ? "#ffffff" : colors.warmSoft,
                backgroundColor: selected ? "#ffb400" : undefined,
                outline: selected && activeUnit.value === part ? { width: 1, color: "#e5a200", offset: 1 } : undefined,
                hover: { backgroundColor: selected ? "#ffb400" : "#ffd54f", color: selected ? "#ffffff" : colors.warmSoft } },
            })
          })}
        </div>
        {pickerButton("⌄", () => page(part, 7), { testId: id(`${part}-next`), ariaLabel: `下一页${label}`, disabled: starts[part] + 7 >= list.length,
          style: { height: 18, padding: 0, color: starts[part] + 7 >= list.length ? colors.textDisabled : colors.warmSoft } })}
      </div>
    }
    return () => {
      const parsed = parseTime(current.value)
      const display = popup.open.value ? formatTime(pending.value, props.format) : parsed ? formatTime(parsed, props.format) : props.placeholder
      const { style: userStyle, ...forwardAttrs } = attrs
      return <div {...forwardAttrs} style={{ width: "100%", fontFamily: fonts.sans, ...(userStyle as StyleDesc) }}>
        <div ref={popup.trigger} testId={props.testId} role="combobox" aria-label={props.ariaLabel} aria-expanded={popup.open.value}
          tabIndex={props.disabled ? -1 : 0} onMouseDown={popup.onTriggerMouseDown} onClick={popup.onTriggerClick} onKeyDown={keyDown}
          style={pickerTriggerStyle(props.size, props.disabled, popup.open.value, props.status)}>
          <text style={{ flexGrow: 1, color: !props.disabled && (parsed || popup.open.value) ? "#8a7b66" : colors.textDisabled, fontWeight: parsed || popup.open.value ? 500 : 400, whiteSpace: "nowrap", pointerEvents: "none" }}>{display}</text>
          {props.allowClear && parsed && !props.disabled ? pickerButton("×", clear, { testId: id("clear"), ariaLabel: "清除时间", style: { width: 20, height: 20, padding: 0, borderRadius: 999, fontSize: 13, fontWeight: 700, color: colors.textDisabled, pointerEvents: "auto" } }) : null}
          <svg src={pickerIcons.clock} style={{ width: 14, height: 14, flexShrink: 0, color: "#a0936e", pointerEvents: "none" }} />
          {popup.open.value ? h(FloatingLayer, {
            side: "bottom", align: "start", sideOffset: 6, role: "dialog", "aria-label": "选择时间", testId: id("panel"),
            tabIndex: 0, autoFocus: true, onMouseDownOutside: popup.onOutside, onKeyDown: keyDown,
            onFocus: (event: EventPayload) => { panel.value = { id: event.elementId } as HostNode },
            style: { ...pickerPanelStyle, width: hasSeconds.value ? 279 : 203 },
          }, { default: () => <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>{() => <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 8 }}>{units.filter(({ part }) => part !== "s" || hasSeconds.value).map(({ part, label }) => column(part, label))}</div>
            <div style={pickerFooterStyle}>{pickerButton("此刻", now, { testId: id("now") })}
              {pickerButton("确定", confirm, { testId: id("confirm"), style: { backgroundColor: "#ffb400", color: "#ffffff", fontWeight: 700, hover: { backgroundColor: "#e5a200" } } })}
            </div>
          </div>}</motion.div> }) : null}
        </div>
      </div>
    }
  },
})
export default TimePicker
