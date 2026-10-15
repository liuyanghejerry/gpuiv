/** Upload — ported from animal-island-vue (MIT).
 * Native adaptation: file input -> promptForPaths; drop -> onFileDrop paths;
 * files are real node:buffer File instances, not fabricated browser objects.
 * MIME is inferred from common filename extensions (unknown types remain "").
 * Images use data URLs because GPUI does not resolve browser ObjectURLs.
 * action uses fetch/FormData with abort cleanup; it reports 0 -> 100 because
 * fetch has no XHR upload-progress events. customRequest retains real progress.
 * withCredentials maps to fetch credentials; desktop fetch has no browser cookie
 * jar, so cookie/auth headers remain app-owned. Dashed borders become solid;
 * drag-enter highlighting is unavailable (only drop delivery exists natively).
 * The built-in image preview uses a full-window deferred anchored layer.
 */
import { Blob, File } from "node:buffer"
import { computed, defineComponent, onBeforeUnmount, ref, watch, type PropType, type VNodeChild } from "vue"
import { promptForPaths, Spinner, useGpuix, useWindowSize, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"
import { colors, ease, fonts, radius, shadows } from "../tokens.js"
import { activationKeys } from "../interaction.js"
import { Icon } from "./Icon.js"
import { renderContent } from "./content.js"
import { matchUploadAccept, readUploadPaths, type UploadNativeFile } from "./upload-files.js"
import { ColorSurface } from "./surface-motion.js"

export type { UploadNativeFile } from "./upload-files.js"
export type UploadFileStatus = "uploading" | "done" | "error" | "removed"
export type UploadListType = "text" | "picture" | "picture-card"
export interface UploadFile {
  uid: string
  name: string
  size?: number
  type?: string
  status?: UploadFileStatus
  percent?: number
  url?: string
  thumbUrl?: string
  originFileObj?: UploadNativeFile
  response?: unknown
  error?: unknown
}
export interface UploadCustomRequestOptions {
  file: UploadNativeFile
  onProgress(percent: number): void
  onSuccess(response?: unknown): void
  onError(error?: unknown): void
}
export interface UploadChangeParam { file: UploadFile; fileList: UploadFile[] }
export type UploadOnChange = (info: UploadChangeParam) => void
export interface UploadShowUploadList { showPreviewIcon?: boolean; showRemoveIcon?: boolean }
export interface UploadProps {
  accept?: string
  multiple?: boolean
  maxCount?: number
  disabled?: boolean
  directory?: boolean
  modelValue?: UploadFile[]
  fileList?: UploadFile[]
  defaultFileList?: UploadFile[]
  listType?: UploadListType
  showUploadList?: boolean | UploadShowUploadList
  drag?: boolean
  tip?: VNodeChild
  ariaLabel?: string
  beforeUpload?: (file: UploadNativeFile, files: UploadNativeFile[]) => boolean | UploadNativeFile | Promise<boolean | UploadNativeFile>
  /** Returning an abort handle is a native extension for request cleanup. */
  customRequest?: (options: UploadCustomRequestOptions) => void | { abort(): void }
  action?: string | ((file: UploadNativeFile) => string | Promise<string>)
  method?: "POST" | "PUT" | "PATCH"
  headers?: Record<string, string>
  data?: Record<string, unknown> | ((file: UploadNativeFile) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>)
  name?: string
  withCredentials?: boolean
  onRemove?: (file: UploadFile) => boolean | void | Promise<boolean | void>
  onChange?: UploadOnChange
  onPreview?: (file: UploadFile) => void
  onExceed?: (files: UploadNativeFile[], fileList: UploadFile[]) => void
  onSelectionError?: (error: unknown) => void
  style?: StyleDesc
  testId?: string
}
export interface UploadExpose {
  openFilePicker(): Promise<void>
  addPaths(paths: string[]): Promise<void>
  addFiles(files: UploadNativeFile[]): Promise<void>
  remove(file: UploadFile): Promise<void>
  readonly fileList: UploadFile[]
}
const percent = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
const sizeLabel = (size?: number) => size == null || !Number.isFinite(size) ? "" : size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`
const isImage = (file: UploadFile) => file.type?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.name)
const previewSrc = (file: UploadFile) => file.thumbUrl ?? file.url
const isNativeFile = (value: unknown): value is UploadNativeFile => value instanceof File || !!value && typeof value === "object" && "arrayBuffer" in value && typeof value.arrayBuffer === "function"
let uidSeed = 0

export const Upload = defineComponent({
  name: "AnimalUpload",
  inheritAttrs: false,
  props: {
    accept: { type: String, default: undefined },
    multiple: { type: Boolean, default: false },
    maxCount: { type: Number, default: undefined },
    disabled: { type: Boolean, default: false },
    directory: { type: Boolean, default: false },
    modelValue: { type: Array as PropType<UploadFile[]>, default: undefined },
    fileList: { type: Array as PropType<UploadFile[]>, default: undefined },
    defaultFileList: { type: Array as PropType<UploadFile[]>, default: () => [] },
    listType: { type: String as PropType<UploadListType>, default: "text" },
    showUploadList: { type: [Boolean, Object] as PropType<boolean | UploadShowUploadList>, default: true },
    drag: { type: Boolean, default: false },
    tip: { type: [String, Number, Object, Array, Boolean] as PropType<VNodeChild>, default: undefined },
    ariaLabel: { type: String, default: "上传文件" },
    beforeUpload: { type: Function as PropType<UploadProps["beforeUpload"]>, default: undefined },
    customRequest: { type: Function as PropType<UploadProps["customRequest"]>, default: undefined },
    action: { type: [String, Function] as PropType<UploadProps["action"]>, default: undefined },
    method: { type: String as PropType<UploadProps["method"]>, default: "POST" },
    headers: { type: Object as PropType<Record<string, string>>, default: undefined },
    data: { type: [Object, Function] as PropType<UploadProps["data"]>, default: undefined },
    name: { type: String, default: "file" },
    withCredentials: { type: Boolean, default: false },
    onRemove: { type: Function as PropType<UploadProps["onRemove"]>, default: undefined },
    onChange: { type: Function as PropType<UploadOnChange>, default: undefined },
    onPreview: { type: Function as PropType<UploadProps["onPreview"]>, default: undefined },
    onExceed: { type: Function as PropType<UploadProps["onExceed"]>, default: undefined },
    /** Failed desktop dialog/filesystem reads are surfaced to the application. */
    onSelectionError: { type: Function as PropType<UploadProps["onSelectionError"]>, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { attrs, slots, expose }) {
    const { renderer } = useGpuix()
    const windowSize = useWindowSize()
    const innerList = ref<UploadFile[]>([...props.defaultFileList])
    const controlled = computed(() => props.fileList !== undefined || props.modelValue !== undefined)
    const list = computed(() => props.fileList ?? props.modelValue ?? innerList.value)
    let listRef: UploadFile[] = list.value
    const focus = ref<string | null>(null)
    const preview = ref<UploadFile | null>(null)
    const previewPanel = ref<HostNode | null>(null)
    const timers = new Map<string, ReturnType<typeof setInterval>>()
    const transfers = new Map<string, () => void>()
    const activeRequests = new Set<string>()
    let alive = true
    let selectionQueue = Promise.resolve()
    let previousFocus: number | null = null

    function stop(uid: string) {
      activeRequests.delete(uid)
      const timer = timers.get(uid)
      if (timer !== undefined) clearInterval(timer)
      timers.delete(uid)
      const abort = transfers.get(uid)
      transfers.delete(uid)
      abort?.()
    }
    function release(uid: string) { stop(uid) }
    let previousUids = new Set(list.value.map((file) => file.uid))
    watch(list, (current) => {
      listRef = current
      const currentUids = new Set(current.map((file) => file.uid))
      // A controlled parent may mutate its array in place, so watch snapshots
      // uid membership rather than relying on Vue's shared previous reference.
      for (const uid of new Set([...previousUids, ...activeRequests])) if (!currentUids.has(uid)) release(uid)
      previousUids = currentUids
      if (preview.value && !current.some((entry) => entry.uid === preview.value!.uid)) preview.value = null
    }, { flush: "sync", deep: true })
    function commit(next: UploadFile[], changed?: UploadFile) {
      if (!alive) return
      listRef = next
      if (!controlled.value) innerList.value = next
      ;(attrs["onUpdate:modelValue"] as ((value: UploadFile[]) => void) | undefined)?.(next)
      if (changed) props.onChange?.({ file: changed, fileList: next })
    }
    function patch(uid: string, update: Partial<UploadFile>) {
      if (!alive || !activeRequests.has(uid) || !listRef.some((file) => file.uid === uid)) return
      const next = listRef.map((file) => file.uid === uid ? { ...file, ...update } : file)
      commit(next, next.find((file) => file.uid === uid))
    }
    function complete(uid: string, update: Partial<UploadFile>) {
      patch(uid, update)
      activeRequests.delete(uid)
      transfers.delete(uid)
    }
    async function realUpload(file: UploadNativeFile, uid: string) {
      try {
        const action = typeof props.action === "function" ? await props.action(file) : props.action
        const data = typeof props.data === "function" ? await props.data(file) : props.data
        if (!alive || !activeRequests.has(uid) || !listRef.some((entry) => entry.uid === uid)) return
        if (!action) throw new Error("upload action is empty")
        const body = new FormData()
        body.append(props.name, file, file.name)
        for (const [key, value] of Object.entries(data ?? {})) {
          if (value instanceof Blob) body.append(key, value)
          else body.append(key, String(value))
        }
        const controller = new AbortController()
        transfers.set(uid, () => controller.abort())
        const response = await fetch(action, { method: props.method, headers: props.headers, body,
          credentials: props.withCredentials ? "include" : "same-origin", signal: controller.signal })
        const responseText = await response.text()
        if (!response.ok) complete(uid, { status: "error", percent: 100, error: responseText || new Error(`HTTP ${response.status}`) })
        else complete(uid, { status: "done", percent: 100, response: responseText })
      } catch (error) {
        complete(uid, { status: "error", percent: 100, error })
      }
    }
    function request(file: UploadNativeFile, uid: string) {
      activeRequests.add(uid)
      if (props.customRequest) {
        try {
          const handle = props.customRequest({ file,
            onProgress: (value) => patch(uid, { status: "uploading", percent: percent(value) }),
            onSuccess: (response) => complete(uid, { status: "done", percent: 100, response }),
            onError: (error) => complete(uid, { status: "error", percent: 100, error }) })
          if (handle && activeRequests.has(uid)) transfers.set(uid, () => handle.abort())
          else if (handle && !listRef.some((entry) => entry.uid === uid)) handle.abort()
        } catch (error) { complete(uid, { status: "error", percent: 100, error }) }
      } else if (props.action !== undefined) void realUpload(file, uid)
      else {
        // Preserve the original's demo mode when no transport is configured.
        patch(uid, { percent: 6 })
        const timer = setInterval(() => {
          const value = (listRef.find((entry) => entry.uid === uid)?.percent ?? 0) + 16
          if (value >= 100) {
            clearInterval(timer); timers.delete(uid)
            complete(uid, { percent: 100, status: "done" })
          } else patch(uid, { percent: value })
        }, 220)
        timers.set(uid, timer)
      }
    }
    async function handleFiles(rawFiles: UploadNativeFile[]) {
      if (!alive || props.disabled) return
      const files = (props.multiple || props.directory ? rawFiles : rawFiles.slice(0, 1)).filter((file) => matchUploadAccept(file, props.accept))
      const limit = props.maxCount && Number.isFinite(props.maxCount) && props.maxCount > 0 ? Math.max(1, Math.floor(props.maxCount)) : undefined
      const added: UploadFile[] = [], requests: Array<[UploadNativeFile, string]> = []
      const original = new Map<string, UploadNativeFile>()
      let overflow: UploadNativeFile[] = []
      for (let index = 0; index < files.length; index++) {
        if (limit !== undefined && added.length >= limit) { overflow = files.slice(index); break }
        const raw = files[index]
        let file = raw
        if (props.beforeUpload) {
          try {
            const result = await props.beforeUpload(raw, files)
            if (result === false) continue
            if (isNativeFile(result)) file = result
          } catch { continue }
        }
        if (!alive || props.disabled) return
        const uid = `animal-upload-${Date.now().toString(36)}-${++uidSeed}`
        const item: UploadFile = { uid, name: file.name, size: file.size, type: file.type, status: "uploading", percent: 0, originFileObj: raw }
        if (file.type.startsWith("image/")) {
          item.thumbUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
        }
        if (!alive) return
        added.push(item); requests.push([file, uid]); original.set(uid, raw)
      }
      if (!added.length && !overflow.length) return
      const merged = [...listRef, ...added]
      const next = limit === undefined ? merged : limit === 1 ? merged.slice(-1) : merged.slice(0, limit)
      const kept = new Set(next.map((file) => file.uid))
      const dropped = merged.filter((file) => !kept.has(file.uid))
      dropped.forEach((file) => release(file.uid))
      const keptAdded = added.filter((file) => kept.has(file.uid))
      const exceeded = [...dropped.flatMap((file) => original.has(file.uid) ? [original.get(file.uid)!] : []), ...overflow]
      if (exceeded.length) props.onExceed?.(exceeded, next)
      if (added.length) commit(next, keptAdded.at(-1))
      for (const [file, uid] of requests) if (alive && kept.has(uid) && listRef.some((entry) => entry.uid === uid)) request(file, uid)
    }
    function addFiles(files: UploadNativeFile[]) {
      const pending = selectionQueue.then(() => handleFiles(files))
      selectionQueue = pending.catch(() => {})
      return pending
    }
    async function addPaths(paths: string[]) {
      if (!alive || props.disabled) return
      try { await addFiles(await readUploadPaths(paths, props.directory)) }
      catch (error) { if (alive) props.onSelectionError?.(error) }
    }
    async function openFilePicker() {
      if (!alive || props.disabled) return
      try {
        if (!renderer) throw new Error("Upload requires a GPUIV renderer for file selection")
        const paths = await promptForPaths(renderer, { files: !props.directory, directories: props.directory, multiple: props.multiple, prompt: props.ariaLabel })
        if (paths && alive) await addPaths(paths)
      } catch (error) { if (alive) props.onSelectionError?.(error) }
    }
    async function remove(file: UploadFile) {
      if (!alive || props.disabled) return
      try { if (await props.onRemove?.(file) === false) return } catch { return }
      if (!alive || !listRef.some((entry) => entry.uid === file.uid)) return
      if (controlled.value) stop(file.uid); else release(file.uid)
      if (preview.value?.uid === file.uid) closePreview()
      commit(listRef.filter((entry) => entry.uid !== file.uid), { ...file, status: "removed" })
    }
    function closePreview() { preview.value = null }
    function openPreview(file: UploadFile) {
      if (props.disabled) return
      if (props.onPreview) props.onPreview(file)
      else if (previewSrc(file)) preview.value = file
    }
    watch(preview, (value) => {
      if (value) previousFocus = renderer?.getFocusedElementId?.() ?? null
      else if (previousFocus != null) { renderer?.focusElement?.(previousFocus); previousFocus = null }
    }, { flush: "sync" })
    onBeforeUnmount(() => {
      alive = false
      for (const uid of activeRequests) stop(uid)
      for (const timer of timers.values()) clearInterval(timer)
      timers.clear(); transfers.clear()
      if (previousFocus != null) renderer?.focusElement?.(previousFocus)
    })
    expose({ openFilePicker, addPaths, addFiles, remove, get fileList() { return list.value } } satisfies UploadExpose)

    function control(id: string, label: string, action: () => unknown, children: unknown, style: StyleDesc = {}) {
      return <ColorSurface role="button" tabIndex={props.disabled ? -1 : 0} aria-label={label} aria-disabled={props.disabled || undefined}
        testId={props.testId ? `${props.testId}-${id}` : undefined}
        onClick={props.disabled ? undefined : action} onKeyDown={props.disabled ? undefined : activationKeys(action)}
        onFocus={() => { focus.value = id }} onBlur={() => { focus.value = null }}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: props.disabled ? "not-allowed" : "pointer", userSelect: "none", ...style,
          ...(focus.value === id ? { outline: { width: 2, color: "#ffd24d", offset: 2 } } : {}) }} transition={{ duration: id === "trigger" ? 0.2 : 0.15, ease: id === "trigger" && !props.drag ? ease : "ease" }}>
        {{ default: () => [
          children
        ] }}
      </ColorSurface>
    }
    function fileItem(file: UploadFile, pictureCard: boolean) {
      const status = file.status ?? "uploading"
      const canPreview = isImage(file) && !!previewSrc(file)
      const config = typeof props.showUploadList === "object" ? props.showUploadList : {}
      const showPreview = config.showPreviewIcon !== false && canPreview
      const statusText = status === "done" ? "上传完成" : status === "error" ? "上传失败" : `上传中 ${percent(file.percent ?? 0)}%`
      const thumb = previewSrc(file)
      const statusView = <div aria-label={statusText} style={{ display: "flex", gap: 4, alignItems: "center", color: status === "error" ? colors.error : colors.success, flexShrink: 0 }}>
        {status === "done" ? <Icon name="Check" size={12} /> : status === "error" ? <Icon name="Close" size={12} /> : <><Spinner size={12} color={colors.primary} /><text style={{ fontSize: 11, color: colors.primary, fontWeight: 700 }}>{`${percent(file.percent ?? 0)}%`}</text></>}
      </div>
      const buttonStyle: StyleDesc = pictureCard ? { position: "absolute", top: 4, width: 18, height: 18, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999 }
        : { width: 22, height: 22, borderRadius: 999, flexShrink: 0, hover: { backgroundColor: "rgba(0,0,0,0.08)" } }
      return <ColorSurface key={file.uid} testId={props.testId ? `${props.testId}-file-${file.uid}` : undefined}
        style={pictureCard ? { position: "relative", width: 84, height: 84, flexShrink: 0, borderRadius: 16, borderWidth: 1.5,
          borderColor: status === "error" ? colors.error : status === "done" ? "#c4b89e" : "#e8dcc8", backgroundColor: "#fffdf7", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }
          : { display: "flex", alignItems: "center", gap: 8, paddingTop: 7, paddingBottom: 7, paddingLeft: 12, paddingRight: 12, borderRadius: 12, borderWidth: 1.5,
            borderColor: status === "error" ? colors.error : "#e8dcc8", backgroundColor: status === "error" ? "#fdeeee" : "#fffdf7", hover: { backgroundColor: colors.primaryBg } }} transition={{ duration: 0.15, ease: "ease" }}>
        {{ default: () => [
          pictureCard ? thumb ? <img src={thumb} alt={file.name} objectFit="cover" style={{ width: "100%", height: "100%" }} /> : <Icon name="File" size={24} />
          : props.listType === "picture" ? <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, overflow: "hidden", borderWidth: 1.5, borderColor: "#e8dcc8", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {thumb ? <img src={thumb} alt={file.name} objectFit="cover" style={{ width: "100%", height: "100%" }} /> : <Icon name="File" size={18} />}
          </div> : <Icon name="File" size={15} />,
          pictureCard ? status === "uploading" || status === "error" ? <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(15,12,8,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>{statusView}</div> : null
          : <><text style={{ flexGrow: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{file.name}</text><text style={{ fontSize: 11, color: colors.textDisabled, flexShrink: 0 }}>{sizeLabel(file.size)}</text>{statusView}</>,
          showPreview ? control(`preview-${file.uid}`, `预览 ${file.name}`, () => openPreview(file), <Icon name="Eye" size={12} />, { ...buttonStyle, ...(pictureCard ? { left: 4 } : {}) }) : null,
          config.showRemoveIcon !== false ? control(`remove-${file.uid}`, `删除 ${file.name}`, () => remove(file), <Icon name="Close" size={12} />, { ...buttonStyle, ...(pictureCard ? { right: 4 } : {}) }) : null
        ] }}
      </ColorSurface>
    }
    return () => {
      const pictureCard = props.listType === "picture-card"
      const triggerChildren = slots.default?.() ?? (props.drag && !pictureCard
        ? [<Icon name="Upload" size={24} />, <text style={{ fontSize: 14, fontWeight: 700 }}>点击或拖拽文件到这里</text>]
        : pictureCard ? [<Icon name="Upload" size={28} />] : [<Icon name="Upload" size={18} />, <text>点击上传</text>])
      const triggerStyle: StyleDesc = pictureCard ? { width: 84, height: 84, borderWidth: 1.5, borderColor: "#c4b89e", borderRadius: 16, backgroundColor: "#fffdf7" }
        : props.drag ? { width: "100%", flexDirection: "column", gap: 8, paddingTop: 28, paddingBottom: 28, paddingLeft: 20, paddingRight: 20,
          borderWidth: 2, borderColor: "#c4b89e", borderRadius: 20, backgroundColor: "#fffdf7", color: colors.textSecondary, hover: { borderColor: colors.primary, color: colors.primary } }
        : slots.default ? { alignSelf: "flex-start" } : { alignSelf: "flex-start", height: 36, gap: 8, paddingLeft: 18, paddingRight: 18,
          borderRadius: radius.pill, backgroundColor: colors.cream, fontSize: 14, fontWeight: 700, boxShadow: shadows.hard, hover: { boxShadow: shadows.hardHover }, active: { boxShadow: shadows.hardActive } }
      return <div {...attrs} testId={props.testId} onFileDrop={props.drag && !props.disabled ? (event: EventPayload) => { void addPaths(event.paths ?? []) } : undefined}
        style={{ display: "flex", flexDirection: "column", gap: 10, color: colors.text, ...(fonts.sans ? { fontFamily: fonts.sans } : {}), ...(props.disabled ? { opacity: 0.55 } : {}), ...(attrs.style as StyleDesc | undefined) }}>
        {pictureCard ? <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{props.showUploadList !== false ? list.value.map((file) => fileItem(file, true)) : null}
          {control("trigger", props.ariaLabel, openFilePicker, triggerChildren, triggerStyle)}</div> : control("trigger", props.ariaLabel, openFilePicker, triggerChildren, triggerStyle)}
        {props.tip ? <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 19.2 }}>{renderContent(props.tip)}</div> : null}
        {!pictureCard && props.showUploadList !== false && list.value.length ? <div role="list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>{list.value.map((file) => fileItem(file, false))}</div> : null}
        {preview.value ? <anchored position={{ x: 0, y: 0 }} anchor="topLeft" fit="snap" snapMargin={0} deferred priority={2} occlude
          style={{ width: windowSize.value.width, height: windowSize.value.height, backgroundColor: "rgba(15,12,8,0.75)" }}>
          <div ref={previewPanel} role="dialog" aria-label={`预览 ${preview.value.name}`} tabIndex={-1} autoFocus
            testId={props.testId ? `${props.testId}-preview` : undefined}
            onKeyDown={(event: EventPayload) => {
              if (event.key === "escape") closePreview()
              else if (event.key === "tab" && previewPanel.value?.id != null) {
                if (event.modifiers?.shift) renderer?.focusPreviousWithin?.(previewPanel.value.id)
                else renderer?.focusNextWithin?.(previewPanel.value.id)
              }
            }} style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={closePreview} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
            <img src={previewSrc(preview.value)} alt={preview.value.name} objectFit="contain"
              style={{ width: Math.min(1100, windowSize.value.width * 0.88), height: windowSize.value.height * 0.86 }} />
            <ColorSurface role="button" tabIndex={0} autoFocus aria-label="关闭预览" testId={props.testId ? `${props.testId}-preview-close` : undefined}
              onClick={closePreview} onKeyDown={activationKeys(closePreview)} style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36,
                display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: colors.cream, cursor: "pointer" }} transition={{ duration: 0.15, ease: "ease" }}>
              {{ default: () => [
                <Icon name="Close" size={20} />
              ] }}
            </ColorSurface>
          </div>
        </anchored> : null}
      </div>
    }
  },
})
export default Upload
