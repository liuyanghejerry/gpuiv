/** DatePicker — ported from animal-island-vue DatePicker.vue (MIT).
 * Keeps controlled/default values, pending confirmation, date/month/year
 * navigation, adjacent range calendars, formatting, disabledDate and shortcuts.
 * Native adaptations: FloatingLayer replaces DOM geometry/outside listeners;
 * flex rows replace CSS grids; a border replaces today's inset ring. Popup
 * dismissal is immediate, while content fades in with native opacity motion.
 * The native renderer supports no aria-controls/labelledby/disabled mapping.
 */
import { computed, defineComponent, h, ref, type PropType } from "vue"
import { FloatingLayer, motion, useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fonts } from "../tokens.js"
import { normalizePickerKey, pad2, pickerButton, pickerFooterStyle, pickerIcons, pickerPanelStyle, pickerTriggerStyle, usePickerPopup, type PickerSize, type PickerStatus } from "./picker-utils.js"
import { ColorSurface } from "./surface-motion.js"

export type DatePickerSize = PickerSize
export type DatePickerStatus = PickerStatus
export type DatePickerValue = string | [string, string] | null
export interface DatePickerProps {
  range?: boolean; picker?: "date" | "month"; value?: DatePickerValue; modelValue?: DatePickerValue
  defaultValue?: string | [string, string]; placeholder?: string; disabled?: boolean
  allowClear?: boolean; size?: DatePickerSize; status?: DatePickerStatus; format?: string
  disabledDate?: (date: Date) => boolean; open?: boolean; showToday?: boolean
  ariaLabel?: string; ariaLabelledBy?: string; testId?: string
  onChange?: (value: DatePickerValue) => void; onOpenChange?: (open: boolean) => void
}

function parseDate(value: string | null | undefined): Date | null {
  const match = value && /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 1)]
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
const toValue = (date: Date, monthOnly = false) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}${monthOnly ? "" : `-${pad2(date.getDate())}`}`
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
const formatDate = (date: Date, format: string) => format.replace(/YYYY|MM|DD|M|D/g, (token) => ({ YYYY: `${date.getFullYear()}`, MM: pad2(date.getMonth() + 1), DD: pad2(date.getDate()), M: `${date.getMonth() + 1}`, D: `${date.getDate()}` })[token]!)
function parseRange(value: DatePickerValue): [Date, Date] | null {
  if (!Array.isArray(value)) return null
  const start = parseDate(value[0]), end = parseDate(value[1])
  return start && end ? [start, end] : null
}
function cells(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  return Array.from({ length: 42 }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index - first.getDay() + 1))
}
const weekdays = ["日", "一", "二", "三", "四", "五", "六"]
const months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]

export const DatePicker = defineComponent({
  name: "AnimalDatePicker", inheritAttrs: false,
  props: {
    range: { type: Boolean, default: false }, picker: { type: String as PropType<"date" | "month">, default: "date" },
    value: { type: [String, Array] as PropType<DatePickerValue>, default: undefined },
    modelValue: { type: [String, Array] as PropType<DatePickerValue>, default: undefined },
    defaultValue: { type: [String, Array] as PropType<string | [string, string]>, default: undefined },
    placeholder: { type: String, default: "请选择日期" }, disabled: { type: Boolean, default: false },
    allowClear: { type: Boolean, default: false }, size: { type: String as PropType<DatePickerSize>, default: "middle" },
    status: { type: String as PropType<DatePickerStatus>, default: undefined }, format: { type: String, default: undefined },
    disabledDate: { type: Function as PropType<(date: Date) => boolean>, default: undefined },
    open: { type: Boolean, default: undefined }, showToday: { type: Boolean, default: true },
    ariaLabel: { type: String, default: undefined }, ariaLabelledBy: { type: String, default: undefined },
    testId: { type: String, default: undefined },
  },
  emits: ["update:modelValue", "change", "update:open", "openChange"],
  setup(props, { attrs, emit }) {
    const innerValue = ref<DatePickerValue>(props.defaultValue ?? null)
    const current = computed(() => props.value !== undefined ? props.value : props.modelValue !== undefined ? props.modelValue : innerValue.value)
    const selected = computed(() => typeof current.value === "string" ? parseDate(current.value) : null)
    const selectedRange = computed(() => props.range ? parseRange(current.value) : null)
    const format = computed(() => props.format ?? (props.picker === "month" ? "YYYY-MM" : "YYYY-MM-DD"))
    const view = ref(new Date()), focused = ref(new Date())
    const mode = ref<"date" | "month" | "year">("date")
    const pending = ref<Date | null>(null), rangeStart = ref<Date | null>(null), rangeEnd = ref<Date | null>(null), hovered = ref<Date | null>(null)
    const panel = ref<HostNode | null>(null)
    const { renderer } = useGpuix()
    const popup = usePickerPopup(props, emit, () => {
      const base = (props.range ? selectedRange.value?.[0] : selected.value) ?? new Date()
      view.value = base; focused.value = base
      mode.value = props.picker === "month" && !props.range ? "month" : "date"
      resetSelection()
    })
    function resetSelection() { pending.value = null; rangeStart.value = null; rangeEnd.value = null; hovered.value = null }
    function commit(value: DatePickerValue) {
      if (props.value === undefined && props.modelValue === undefined) innerValue.value = value
      emit("update:modelValue", value); emit("change", value)
    }
    function disabled(date: Date) { return props.disabled || props.disabledDate?.(date) === true }
    function selectDate(date: Date) {
      if (disabled(date)) return
      focused.value = date
      if (!props.range) { pending.value = date; return }
      if (!rangeStart.value || date < rangeStart.value) {
        rangeStart.value = date; rangeEnd.value = null
      } else rangeEnd.value = date
    }
    function confirm() {
      if (props.disabled) return
      if (!props.range && pending.value && !disabled(pending.value)) commit(toValue(pending.value, props.picker === "month"))
      else if (props.range && rangeStart.value && rangeEnd.value && !disabled(rangeStart.value) && !disabled(rangeEnd.value)) commit([toValue(rangeStart.value), toValue(rangeEnd.value)])
      popup.setOpen(false); resetSelection()
    }
    function clear() { if (!props.disabled) { commit(null); resetSelection() } }
    function today() {
      const now = new Date()
      view.value = new Date(now.getFullYear(), now.getMonth(), 1); focused.value = now
      if (props.range) resetSelection()
      else { mode.value = props.picker === "month" ? "month" : "date"; if (!disabled(now)) pending.value = now }
    }
    function shift(years: number, monthDelta = 0) {
      view.value = new Date(view.value.getFullYear() + years, view.value.getMonth() + monthDelta, 1)
      focused.value = view.value
    }
    function monthClick(month: number) {
      const date = new Date(view.value.getFullYear(), month, 1)
      if (props.picker === "month" && !props.range) { if (!disabled(date)) pending.value = date }
      else { view.value = date; focused.value = date; mode.value = "date" }
    }
    function yearClick(year: number) {
      view.value = new Date(year, view.value.getMonth(), 1); focused.value = view.value; mode.value = "month"
    }
    function keyDown(event: EventPayload) {
      if (props.disabled) return
      const key = normalizePickerKey(event.key)
      if (popup.open.value && (key === "escape" || key === "tab")) { popup.setOpen(false, key !== "tab"); return }
      // A cell/footer button owns its own Enter/Space activation. Handle grid
      // navigation only while focus belongs to the trigger or popup surface.
      const focusId = renderer?.getFocusedElementId?.()
      if (focusId != null && focusId !== popup.trigger.value?.id && focusId !== panel.value?.id) return
      if (!popup.open.value) {
        if (["enter", "space", "down", "up"].includes(key)) popup.setOpen(true)
        return
      }
      if (key === "enter" || key === "space") {
        if (mode.value === "date") selectDate(focused.value)
        else if (mode.value === "month") monthClick(view.value.getMonth())
        else yearClick(view.value.getFullYear())
        return
      }
      if (["left", "right", "up", "down"].includes(key)) {
        const delta = key === "left" ? -1 : key === "right" ? 1 : key === "up" ? -7 : 7
        if (mode.value === "date") {
          focused.value = new Date(focused.value.getFullYear(), focused.value.getMonth(), focused.value.getDate() + delta)
          if (!sameMonth(focused.value, view.value)) view.value = new Date(focused.value.getFullYear(), focused.value.getMonth(), 1)
        } else if (mode.value === "month") { shift(0, delta); focused.value = view.value }
        else shift(delta)
      } else if (key === "pageup" || key === "pagedown") {
        const delta = key === "pageup" ? -1 : 1
        if (mode.value === "date") {
          const day = focused.value.getDate(); shift(0, delta)
          const last = new Date(view.value.getFullYear(), view.value.getMonth() + 1, 0).getDate()
          focused.value = new Date(view.value.getFullYear(), view.value.getMonth(), Math.min(day, last))
        } else shift(delta * (mode.value === "year" ? 10 : 1))
      }
    }
    const id = (suffix: string) => props.testId ? `${props.testId}-${suffix}` : undefined
    const labelStyle: StyleDesc = { fontWeight: 700, fontSize: 14, color: colors.warmSoft }
    function nav(label: string, glyph: string, action: () => void) {
      return pickerButton(glyph, action, { ariaLabel: label, testId: id(label), style: { width: 26, height: 26, padding: 0, borderRadius: 8, color: "#a0936e" } })
    }
    function header(date: Date, index = -1) {
      const decade = Math.floor(date.getFullYear() / 10) * 10
      const label = props.range || mode.value === "date" ? `${date.getFullYear()}年${date.getMonth() + 1}月` : mode.value === "month" ? `${date.getFullYear()}年` : `${decade} - ${decade + 9}年`
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 2, minWidth: 26 }}>
          {index !== 1 ? nav("上一年", "«", () => shift(mode.value === "year" ? -10 : -1)) : null}
          {index !== 1 && (props.range || mode.value === "date") ? nav("上个月", "‹", () => shift(0, -1)) : null}
        </div>
        {props.range || mode.value === "year" ? <text style={{ ...labelStyle, pointerEvents: "none" }}>{label}</text> : pickerButton(label, () => { mode.value = "year" }, { testId: id("header"), style: { ...labelStyle, paddingTop: 4, paddingBottom: 4, paddingLeft: 10, paddingRight: 10, hover: { color: colors.primary, backgroundColor: colors.primaryBg } } })}
        <div style={{ display: "flex", gap: 2, minWidth: 26 }}>
          {index !== 0 && (props.range || mode.value === "date") ? nav("下个月", "›", () => shift(0, 1)) : null}
          {index !== 0 ? nav("下一年", "»", () => shift(mode.value === "year" ? 10 : 1)) : null}
        </div>
      </div>
    }
    function dayCell(date: Date, panelDate: Date, panelIndex: number) {
      const endpoint = props.range ? rangeStart.value ?? selectedRange.value?.[0] : null
      const endpointEnd = props.range ? rangeStart.value ? rangeEnd.value ?? hovered.value ?? rangeStart.value : selectedRange.value?.[1] : null
      const active = pending.value ?? selected.value
      const selectedCell = !props.range && !!active && sameDay(date, active)
      const edge = !!endpoint && !!endpointEnd && (sameDay(date, endpoint) || sameDay(date, endpointEnd))
      const inRange = !!endpoint && !!endpointEnd && date > new Date(Math.min(endpoint.getTime(), endpointEnd.getTime())) && date < new Date(Math.max(endpoint.getTime(), endpointEnd.getTime()))
      const unavailable = disabled(date)
      const isToday = sameDay(date, new Date()) && !props.range
      const isFocused = sameDay(date, focused.value)
      return <ColorSurface key={toValue(date)} testId={id(`day-${panelIndex}-${toValue(date)}`)} role="button" aria-disabled={unavailable || undefined}
        aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`} aria-selected={selectedCell || edge || undefined}
        tabIndex={-1} onClick={() => selectDate(date)}
        onMouseEnter={() => { if (props.range && !unavailable) hovered.value = date }} onMouseLeave={() => { hovered.value = null }}
        transition={{ duration: 0.15, ease: "ease" }}
        style={{
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          borderRadius: 999, fontSize: 13, fontWeight: selectedCell || edge || isToday ? 700 : 500,
          backgroundColor: unavailable ? undefined : selectedCell ? colors.primary : edge || inRange ? "#ffc107" : undefined,
          color: unavailable ? "#d4c9b4" : selectedCell || edge || inRange ? "#ffffff" : isToday ? colors.primary : sameMonth(date, panelDate) ? colors.warmSoft : colors.textDisabled,
          borderWidth: edge || isToday ? 1.5 : undefined, borderColor: edge ? "#ffffff" : colors.primary,
          cursor: unavailable ? "not-allowed" : "pointer",
          outline: isFocused && !unavailable ? { width: 1, color: colors.primary, offset: 1 } : undefined,
          hover: unavailable ? undefined : { backgroundColor: selectedCell ? colors.primaryHover : props.range ? "#ffd54f" : colors.primaryBg, color: selectedCell ? "#ffffff" : props.range ? colors.warmSoft : colors.primary },
        }}>{() => <text style={{ pointerEvents: "none" }}>{date.getDate()}</text>}</ColorSurface>
    }
    function calendar(date: Date, panelIndex: number) {
      const days = cells(date)
      return <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 4 }}>{weekdays.map((day) => <div key={day} style={{ width: 32, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#a09080", fontSize: 11, fontWeight: 700 }}><text>{day}</text></div>)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{Array.from({ length: 6 }, (_, row) => <div key={row} style={{ display: "flex", justifyContent: "space-around", gap: 2 }}>{days.slice(row * 7, row * 7 + 7).map((day) => dayCell(day, date, panelIndex))}</div>)}</div>
      </div>
    }
    function monthYearGrid() {
      const decade = Math.floor(view.value.getFullYear() / 10) * 10
      const years = Array.from({ length: 12 }, (_, i) => decade - 1 + i)
      return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {Array.from({ length: 4 }, (_, row) => <div key={row} style={{ display: "flex", gap: 4 }}>
          {Array.from({ length: 3 }, (_, column) => {
            const i = row * 3 + column, year = years[i], date = new Date(view.value.getFullYear(), i, 1)
            const selectedDate = pending.value ?? selected.value
            const selectedCell = !!selectedDate && (mode.value === "month" ? sameMonth(date, selectedDate) : selectedDate.getFullYear() === year)
            const unavailable = mode.value === "month" && props.picker === "month" && disabled(date)
            return pickerButton(mode.value === "month" ? months[i] : String(year), () => mode.value === "month" ? monthClick(i) : yearClick(year), {
              testId: id(mode.value === "month" ? `month-${i + 1}` : `year-${year}`), ariaLabel: mode.value === "month" ? `${i + 1}月` : `${year}年`, disabled: unavailable, selected: selectedCell,
              style: { flexGrow: 1, flexBasis: 0, height: 36, padding: 0, borderRadius: 12, fontSize: 13,
                color: unavailable ? colors.textDisabled : selectedCell ? "#ffffff" : colors.warmSoft,
                backgroundColor: selectedCell ? colors.primary : undefined,
                hover: unavailable ? undefined : { backgroundColor: selectedCell ? colors.primaryHover : colors.primaryBg, color: selectedCell ? "#ffffff" : colors.primary } },
            })
          })}
        </div>)}
      </div>
    }
    return () => {
      const { style: userStyle, ...forwardAttrs } = attrs
      let display = props.placeholder
      let rangeDisplay: [string, string | null] | undefined
      if (props.range) {
        const start = popup.open.value && rangeStart.value ? rangeStart.value : selectedRange.value?.[0]
        const end = popup.open.value && rangeStart.value ? rangeEnd.value : selectedRange.value?.[1]
        if (start) rangeDisplay = [formatDate(start, format.value), end ? formatDate(end, format.value) : null]
      } else {
        const date = popup.open.value && pending.value ? pending.value : selected.value
        if (date) display = formatDate(date, format.value)
      }
      const hasValue = props.range ? !!selectedRange.value : !!selected.value
      return <div {...forwardAttrs} style={{ width: "100%", fontFamily: fonts.sans, ...(userStyle as StyleDesc) }}>
        <ColorSurface hostRef={popup.trigger} testId={props.testId} role="combobox" aria-label={props.ariaLabel} aria-expanded={popup.open.value} aria-disabled={props.disabled || undefined}
          transition={{ duration: 0.2, ease }}
          tabIndex={props.disabled ? -1 : 0} onMouseDown={popup.onTriggerMouseDown} onClick={popup.onTriggerClick} onKeyDown={keyDown}
          style={pickerTriggerStyle(props.size, props.disabled, popup.open.value, props.status)}>{() => <>
          {rangeDisplay ? <div style={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
            <text style={{ flexGrow: 1, color: props.disabled ? colors.textDisabled : "#8a7b66", fontWeight: 500, whiteSpace: "nowrap", pointerEvents: "none" }}>{rangeDisplay[0]}</text>
            <div style={{ width: 1, height: 16, marginLeft: 2, marginRight: 2, backgroundColor: "#e8dcc8", flexShrink: 0, pointerEvents: "none" }} />
            <text style={{ flexGrow: 1, color: !props.disabled && rangeDisplay[1] ? "#8a7b66" : colors.textDisabled, fontWeight: rangeDisplay[1] ? 500 : 400, whiteSpace: "nowrap", pointerEvents: "none" }}>{rangeDisplay[1] ?? props.placeholder}</text>
          </div> : <text style={{ flexGrow: 1, color: !props.disabled && (hasValue || pending.value || rangeStart.value) ? "#8a7b66" : colors.textDisabled, fontWeight: hasValue || pending.value ? 500 : 400, whiteSpace: "nowrap", pointerEvents: "none" }}>{display}</text>}
          {props.allowClear && hasValue && !props.disabled ? pickerButton("×", clear, { testId: id("clear"), ariaLabel: "清除日期", style: { width: 20, height: 20, padding: 0, borderRadius: 999, fontSize: 13, fontWeight: 700, color: colors.textDisabled, pointerEvents: "auto" } }) : null}
          <svg src={pickerIcons.calendar} style={{ width: 14, height: 14, flexShrink: 0, color: "#a0936e", pointerEvents: "none" }} />
          {popup.open.value ? h(FloatingLayer, {
            side: "bottom", align: "start", sideOffset: 6, role: "dialog", "aria-label": props.range ? "选择日期范围" : "选择日期",
            testId: id("panel"), ref: undefined, tabIndex: 0, autoFocus: true, onMouseDownOutside: popup.onOutside,
            onKeyDown: keyDown, style: { ...pickerPanelStyle, width: props.range ? 628 : 310 },
            // Host refs belong to the content div, not the component wrapper.
            onFocus: (event: EventPayload) => { panel.value = { id: event.elementId } as HostNode },
          }, { default: () => <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }}>{() => <div style={{ display: "flex", flexDirection: "column" }}>
            {props.range ? <div style={{ display: "flex", gap: 12 }}>{[view.value, new Date(view.value.getFullYear(), view.value.getMonth() + 1, 1)].map((date, index) => <div key={index} testId={id(`calendar-${index}`)} style={{ width: 280, flexShrink: 0 }}>{header(date, index)}{calendar(date, index)}</div>)}</div>
              : <div>{header(view.value)}{mode.value === "date" ? calendar(view.value, 0) : monthYearGrid()}</div>}
            {props.range || mode.value === "date" || props.picker === "month" && mode.value === "month" ? <div style={pickerFooterStyle}>
              {props.showToday && !props.range ? pickerButton("今天", today, { testId: id("today") }) : null}
              {pickerButton("确定", confirm, { testId: id("confirm"), style: { backgroundColor: "#ffb400", color: "#ffffff", fontWeight: 700, hover: { backgroundColor: "#e5a200" } } })}
            </div> : null}
          </div>}</motion.div> }) : null}
        </>}</ColorSurface>
      </div>
    }
  },
})
export default DatePicker
