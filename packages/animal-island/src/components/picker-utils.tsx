/** Shared native presentation for animal-island-vue DatePicker / TimePicker (MIT).
 * Browser viewport measurements become FloatingLayer positioning. Native focus
 * uses the renderer API; no DOM or document listeners are involved.
 */
import { computed, h, ref, watch, type Ref } from "vue"
import { useGpuix, type BoxShadow, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, fonts } from "../tokens.js"
import { ColorSurface } from "./surface-motion.js"

export type PickerSize = "small" | "middle" | "large"
export type PickerStatus = "error" | "warning"

export function normalizePickerKey(key: string | undefined): string {
  const aliases: Record<string, string> = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    PageUp: "pageup", PageDown: "pagedown", Enter: "enter", Escape: "escape", " ": "space",
  }
  return key ? (aliases[key] ?? key.toLowerCase()) : ""
}

export const pad2 = (value: number) => String(value).padStart(2, "0")
export const hardShadow = (color: string): BoxShadow =>
  ({ offsetX: 0, offsetY: 3, blurRadius: 0, spreadRadius: 0, color })

export const pickerPanelStyle: StyleDesc = {
  display: "flex", flexDirection: "column", padding: 14,
  backgroundColor: "#fffdf7", borderWidth: 1.5, borderColor: "#e8dcc8", borderRadius: 20,
  boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: "rgba(61, 52, 40, 0.12)" },
  color: colors.warmSoft, userSelect: "none",
}

export const pickerFooterStyle: StyleDesc = {
  display: "flex", justifyContent: "flex-end", gap: 6,
  marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: "#f0e8d8",
}

export function pickerTriggerStyle(size: PickerSize, disabled: boolean, open: boolean, status?: PickerStatus): StyleDesc {
  const geometry = { small: [32, 14, 12], middle: [40, 18, 14], large: [48, 22, 16] }[size]
  return {
    display: "flex", position: "relative", alignItems: "center", gap: 8, width: "100%",
    height: geometry[0], paddingLeft: geometry[1], paddingRight: geometry[1], fontSize: geometry[2],
    fontFamily: fonts.sans, borderRadius: 50, backgroundColor: disabled ? "#ece8dc" : colors.bgInput,
    cursor: disabled ? "not-allowed" : "pointer", userSelect: "none", opacity: disabled ? 0.6 : 1,
    boxShadow: disabled ? undefined : status ? hardShadow(status === "error" ? colors.errorActive : colors.warningActive)
      : open ? [hardShadow("#e0b800"), { offsetX: 0, offsetY: 0, blurRadius: 0, spreadRadius: 3, color: "rgba(255, 204, 0, 0.15)" }] : undefined,
    hover: disabled || open || status ? undefined : { boxShadow: hardShadow(colors.shadowSoftHover) },
  }
}

export function pickerButton(label: string, onClick: () => void, options: {
  testId?: string; ariaLabel?: string; disabled?: boolean; style?: StyleDesc; selected?: boolean
} = {}) {
  const activate = () => { if (!options.disabled) onClick() }
  return h(ColorSurface, {
    role: "button", "aria-label": options.ariaLabel ?? label,
    "aria-selected": options.selected, testId: options.testId, tabIndex: options.disabled ? -1 : 0,
    "aria-disabled": options.disabled || undefined,
    transition: { duration: 0.15, ease: "ease" },
    onClick: activate,
    onKeyDown: (event: EventPayload) => {
      const key = normalizePickerKey(event.key)
      if (key === "enter" || key === "space") activate()
    },
    style: {
      display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 6, paddingBottom: 6,
      paddingLeft: 14, paddingRight: 14, borderRadius: 10, fontSize: 12, fontWeight: 600,
      color: "#8a7b66", cursor: options.disabled ? "not-allowed" : "pointer", userSelect: "none",
      hover: options.disabled ? undefined : { backgroundColor: "#f0e8d8", color: colors.warmSoft },
      ...options.style,
    },
  }, { default: () => h("text", { style: { pointerEvents: "none" } }, label) })
}

function iconUrl(content: string) {
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">${content}</svg>`).toString("base64")}`
}
export const pickerIcons = {
  calendar: iconUrl('<rect x="1.5" y="2.5" width="11" height="10" rx="2" stroke="#000" stroke-width="1.4"/><path d="M1.5 5.5h11M4.7 1v2.4M9.3 1v2.4" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>'),
  clock: iconUrl('<circle cx="7" cy="7" r="5.5" stroke="#000" stroke-width="1.4"/><path d="M7 4.2V7l2 1.2" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>'),
}

/** Mirrors Select's press bookkeeping so an outside-press notification on
 * the trigger cannot close and reopen the popup in the same click. */
export function usePickerPopup(props: { open?: boolean; disabled: boolean }, emit: (event: "update:open" | "openChange", value: boolean) => void, onOpen: () => void) {
  const innerOpen = ref(false)
  const open = computed(() => props.open !== undefined ? props.open : innerOpen.value)
  const trigger = ref<HostNode | null>(null) as Ref<HostNode | null>
  const { renderer } = useGpuix()
  let pressedWhileOpen = false
  let dismissedByOutsidePress = false
  function setOpen(next: boolean, restoreFocus = true) {
    if (next === open.value) return
    if (props.open === undefined) innerOpen.value = next
    emit("update:open", next)
    emit("openChange", next)
    if (!next && restoreFocus && trigger.value?.id != null) renderer?.focusElement?.(trigger.value.id)
  }
  watch(open, (next) => { if (next) onOpen() }, { immediate: true, flush: "sync" })
  return {
    open, trigger, setOpen,
    onTriggerMouseDown: () => { pressedWhileOpen = open.value },
    onTriggerClick: () => {
      if (props.disabled) return
      if (dismissedByOutsidePress) { dismissedByOutsidePress = false; pressedWhileOpen = false; return }
      if (pressedWhileOpen) { pressedWhileOpen = false; setOpen(false); return }
      setOpen(!open.value)
    },
    onOutside: (event: EventPayload) => {
      // Unlike keyboard dismissal, an outside press keeps focus on its target.
      // Bounds identify a press on the trigger even if GPUI orders the outside listener first.
      const bounds = trigger.value?.id != null ? renderer?.getElementBounds?.(trigger.value.id) : null
      const onTrigger = bounds && event.x !== undefined && event.y !== undefined
        && event.x >= bounds.x && event.x <= bounds.x + bounds.width
        && event.y >= bounds.y && event.y <= bounds.y + bounds.height
      if (onTrigger || pressedWhileOpen) {
        dismissedByOutsidePress = true
        queueMicrotask(() => { dismissedByOutsidePress = false })
      }
      setOpen(false, false)
    },
  }
}
