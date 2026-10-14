import { isVNode, type VNodeChild } from "vue"

/** React's node-valued props accept text, elements and lists. Preserve that
 * flexibility while routing plain strings through GPUIV's text element. */
export function renderContent(value: VNodeChild): VNodeChild {
  if (value == null || typeof value === "boolean") return null
  if (typeof value === "string" || typeof value === "number") return <text>{String(value)}</text>
  if (Array.isArray(value)) return value.map(renderContent)
  return value
}

/** Native ARIA labels are strings. Derive plain text from rich node-valued
 * titles where possible; custom component slots can supply an explicit label. */
export function contentLabel(value: VNodeChild): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(contentLabel).filter(part => part !== undefined).join("") || undefined
  if (isVNode(value) && (typeof value.children === "string" || Array.isArray(value.children))) return contentLabel(value.children as VNodeChild)
  return undefined
}
