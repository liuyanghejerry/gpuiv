/// GPUIX Vue TestRenderer — thin wrapper over the native TestGpuixRenderer.
///
/// All state lives in Rust's RetainedTree. All mutations go directly to
/// the native renderer via napi. Inspection methods (findByType, getAllText,
/// toJSON, etc.) query the Rust tree via napi — no JS-side shadow copy.
///
/// All event simulation goes through the native GPUI pipeline (coordinate-based
/// hit testing, GPUI dispatch, emit_event_full). The nativeSimulate* methods
/// flush the tree, dispatch through GPUI, drain events, and feed them into
/// the event registry via handleGpuixEvent.
///
/// Unlike React (sync commit), Vue updates flush on a microtask, so after an
/// event simulation call `await app.settle()` before asserting on the tree.

import { spawnSync } from "node:child_process"
import type { Component } from "vue"
import type { App } from "vue"
import { nextTick } from "vue"
import type { EventPayload, HighlightMatch } from "@gpuiv/native"
import type {
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  HostNode,
  NativeRenderer,
} from "./types.js"
import { createGpuivRendererHost } from "./reconciler/vue-renderer.js"
import { handleGpuixEvent } from "./reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "./hooks/use-gpuix.js"

interface NativeTestRendererApi extends NativeRenderer {
  flush(): void
  drainEvents(): EventPayload[]
  simulateKeystrokes(keystrokes: string): void
  focusElement(elementId: number): void
  simulateKeyDown(keystroke: string, isHeld?: boolean): void
  simulateKeyUp(keystroke: string): void
  simulateClick(x: number, y: number, button?: number, modifiers?: string): void
  simulateScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: string
  ): void
  simulateMouseMove(x: number, y: number, pressedButton?: number, modifiers?: string): void
  simulateMouseDown(x: number, y: number, button: number, modifiers?: string): void
  simulateMouseUp(x: number, y: number, button: number, modifiers?: string): void
  getTreeJson(): string
  getAutomationTree(): string
  getElementBounds(elementId: number): number[] | null
  getRetainedElementCount(): number
  clockPause(): number
  clockSet(nowMs: number): number
  clockFastForward(deltaMs: number): number
  clockResume(): number
  advanceTime(milliseconds: number): void
  getRootId(): number | null
  getAllText(): string[]
  scrollTo(elementId: number, x: number, y: number): void
  scrollToItem(elementId: number, index: number, offsetInItem?: number): void
  getScrollOffset(elementId: number): number[] | null
  getListScrollTop(elementId: number): number[] | null
  setDebugFrameOverlay(mode: DebugFrameOverlayMode): string
  getDebugFrameOverlay(): string
  cycleDebugFrameOverlay(): string
  resetDebugFrameOverlayStats(): void
  getDebugFrameOverlayStats(): DebugFrameOverlayStats
  dragSelect(x1: number, y1: number, x2: number, y2: number): void
  getSelectedText(): string | null
  getPaintedText(): string[]
  getPaintedHighlights(): HighlightMatch[]
  getSyntaxCacheStats(): number[]
  clearSelection(): void
  captureScreenshot(path: string): void
}

interface NativeTestRendererConstructor {
  new (width?: number, height?: number): NativeTestRendererApi
}

// Real on macOS (Metal) and Windows (DirectX) test-support builds; a throwing
// stub everywhere else, so the class existing is not availability.
let NativeTestRenderer: NativeTestRendererConstructor | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = require("@gpuiv/native") as {
    TestGpuixRenderer?: NativeTestRendererConstructor
    hasTestGpuixRenderer?: () => boolean
  }
  if (native.TestGpuixRenderer && (native.hasTestGpuixRenderer?.() ?? true)) {
    NativeTestRenderer = native.TestGpuixRenderer
  }
} catch {
  // Native module not available — native simulation methods will throw.
}

/** Whether the native TestGpuixRenderer is available (for conditional test registration). */
export const hasNativeTestRenderer = NativeTestRenderer != null

export const MAC_CPU_THROTTLES = ["utility", "background", "maintenance"] as const

export type MacCpuThrottle = (typeof MAC_CPU_THROTTLES)[number]

function isMacCpuThrottle(value: string): value is MacCpuThrottle {
  for (const clamp of MAC_CPU_THROTTLES) {
    if (clamp === value) return true
  }
  return false
}

export function readMacCpuThrottle(): MacCpuThrottle | null {
  const raw = (process.env.THROTTLE ?? "").trim().toLowerCase()
  if (!raw) return null
  if (!isMacCpuThrottle(raw)) {
    throw new Error(
      `THROTTLE=${raw} is invalid. Use utility, background, or maintenance.`,
    )
  }
  return raw
}

/** Re-exec under `taskpolicy -c`. Call from the process entry, not a vitest worker. */
export function applyMacCpuThrottleFromEnv(): MacCpuThrottle | null {
  const mode = readMacCpuThrottle()
  if (!mode) return null
  if (process.env.GPUIX_CPU_THROTTLE_APPLIED === mode) return mode
  if (process.platform !== "darwin") {
    throw new Error(`THROTTLE=${mode} needs macOS taskpolicy`)
  }
  if (process.argv.some((arg) => arg.includes("vitest/dist/workers"))) {
    throw new Error(
      `THROTTLE=${mode} must wrap the vitest process. Use examples/vitest.config.ts.`,
    )
  }
  console.log(`[throttle] taskpolicy -c ${mode}`)
  const result = spawnSync("taskpolicy", ["-c", mode, ...process.argv], {
    stdio: "inherit",
    env: { ...process.env, GPUIX_CPU_THROTTLE_APPLIED: mode },
  })
  process.exit(result.status ?? 1)
}

// ── Test element tree ────────────────────────────────────────────────

export interface TestElement {
  id: number
  type: string
  style: Record<string, unknown>
  text: string | null
  events: Set<string>
  children: number[]
  parentId: number | null
  customProps?: Record<string, unknown>
  testId?: string | null
}

// ── TestRenderer ─────────────────────────────────────────────────────

/** Offscreen window size for a test renderer. Defaults to 1280x800 in native. */
export interface TestWindowOptions {
  width?: number
  height?: number
}

export class TestRenderer implements NativeRenderer {
  /** Native TestGpuixRenderer — all state lives here in Rust's RetainedTree. */
  private native: NativeTestRendererApi
  readonly applyBatch: NativeRenderer["applyBatch"]

  constructor(options: TestWindowOptions = {}) {
    if (!NativeTestRenderer) {
      throw new Error(
        "Native TestGpuixRenderer not available. Build with test-support to run tests."
      )
    }
    this.native = new NativeTestRenderer(options.width, options.height)
    this.applyBatch = this.native.applyBatch.bind(this.native)
  }

  // ── GPUI pipeline methods ───────────────────────────────────────

  /** Trigger the real GPUI rendering pipeline (GpuixView::render() →
   *  build_element() → apply_styles() → layout). */
  flush(): void {
    this.native.flush()
  }

  /** Drain events collected by the native GPUI event handlers. */
  drainEvents(): EventPayload[] {
    return this.native.drainEvents()
  }

  // ── Native end-to-end simulation ────────────────────────────────
  // These methods go through the full GPUI pipeline:
  //   native simulate → GPUI dispatch → hit test → event handler →
  //   emit_event_full → drainEvents → handleGpuixEvent → Vue handler

  /** Drain events from the native GPUI pipeline and feed them into the
   *  event registry, triggering Vue state updates. Vue updates apply on a
   *  microtask — await `app.settle()` (or `nextTick`) before asserting. */
  dispatchNativeEvents(): void {
    for (;;) {
      const events = this.native.drainEvents()
      if (events.length === 0) break
      for (const event of events) {
        handleGpuixEvent(event, this)
      }
    }
  }

  /** Send keystrokes to whatever currently holds focus.
   *
   *  Unlike `nativeSimulateKeystrokes`, this focuses nothing first, which is
   *  the only way to test that `autoFocus` (or a click) actually moved focus. */
  simulateKeystrokes(keystrokes: string): void {
    this.native.flush()
    this.native.simulateKeystrokes(keystrokes)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  nativeSimulateKeystrokes(elementId: number, keystrokes: string): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeystrokes(keystrokes)
    this.dispatchNativeEvents()
  }

  /** End-to-end: focus element → simulate a single key down through GPUI →
   *  dispatch resulting events to the registry. Unlike nativeSimulateKeystrokes,
   *  this dispatches ONLY a KeyDownEvent — no automatic KeyUpEvent follows. */
  nativeSimulateKeyDown(elementId: number, keystroke: string, isHeld?: boolean): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeyDown(keystroke, isHeld)
    this.dispatchNativeEvents()
  }

  /** End-to-end: focus element → simulate a single key up through GPUI →
   *  dispatch resulting events to the registry. Pairs with nativeSimulateKeyDown. */
  nativeSimulateKeyUp(elementId: number, keystroke: string): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.native.simulateKeyUp(keystroke)
    this.dispatchNativeEvents()
  }

  /** End-to-end: simulate a click through GPUI hit testing →
   *  dispatch resulting events to the registry.
   *  @param button - 0=left (default), 1=middle, 2=right. Non-left fires
   *  `auxClick` on the element, not `click`.
   *  @param modifiers - held modifiers in `press()` syntax: "cmd", "cmd-shift". */
  nativeSimulateClick(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateClick(x, y, button, modifiers)
    this.dispatchNativeEvents()
    // Flush again after Rust ops (queued by Vue) have been applied by the
    // microtask batch flush — repaint the current tree before any screenshot.
    this.native.flush()
  }

  /** End-to-end: simulate scroll wheel through GPUI →
   *  dispatch resulting events to the registry. */
  nativeSimulateScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateScrollWheel(x, y, deltaX, deltaY, modifiers)
    this.dispatchNativeEvents()
  }

  dispatchScrollWheel(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
    modifiers?: string
  ): void {
    this.native.simulateScrollWheel(x, y, deltaX, deltaY, modifiers)
    this.dispatchNativeEvents()
  }

  /** End-to-end: simulate mouse move through GPUI →
   *  dispatch resulting events to the registry.
   *  @param pressedButton - optional button held during move (0=left, 1=middle, 2=right) for drag simulation */
  nativeSimulateMouseMove(
    x: number,
    y: number,
    pressedButton?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseMove(x, y, pressedButton, modifiers)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** End-to-end: simulate mouse down through GPUI hit testing →
   *  dispatch resulting events to the registry.
   *  @param button - 0=left (default), 1=middle, 2=right */
  nativeSimulateMouseDown(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseDown(x, y, button ?? 0, modifiers)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** End-to-end: simulate mouse up through GPUI hit testing →
   *  dispatch resulting events to the registry.
   *  @param button - 0=left (default), 1=middle, 2=right */
  nativeSimulateMouseUp(
    x: number,
    y: number,
    button?: number,
    modifiers?: string
  ): void {
    this.native.flush()
    this.native.simulateMouseUp(x, y, button ?? 0, modifiers)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  // ── Tree inspection (queries Rust RetainedTree via napi) ────────

  /** Build a flat map of TestElements from the native tree JSON.
   *  One FFI call to get the full tree, then parse into TestElement objects. */
  private buildElementMap(): Map<number, TestElement> {
    const json = JSON.parse(this.native.getTreeJson())
    const map = new Map<number, TestElement>()
    const walk = (node: any, parentId: number | null) => {
      if (!node) return
      map.set(node.id, {
        id: node.id,
        type: node.type,
        style: node.style ?? {},
        text: node.text ?? null,
        events: new Set(node.events ?? []),
        children: (node.children ?? []).map((c: any) => c.id),
        parentId,
        ...(node.customProps ? { customProps: node.customProps } : {}),
        testId: node.testId ?? null,
      })
      for (const child of node.children ?? []) {
        walk(child, node.id)
      }
    }
    walk(json, null)
    return map
  }

  /** Get the root element. */
  getRoot(): TestElement | undefined {
    const rootId = this.native.getRootId()
    if (rootId == null) return undefined
    return this.buildElementMap().get(rootId)
  }

  /** Get an element by ID. */
  getElement(id: number): TestElement | undefined {
    return this.buildElementMap().get(id)
  }

  /** Find elements by type (e.g. "div", "text"). */
  findByType(type: string): TestElement[] {
    return [...this.buildElementMap().values()].filter((el) => el.type === type)
  }

  /** Find the first text element containing the given string. */
  findByText(text: string): TestElement | undefined {
    return [...this.buildElementMap().values()].find(
      (el) => el.text != null && el.text.includes(text)
    )
  }

  /** Find the first element with the given testId. */
  findByTestId(testId: string): TestElement | undefined {
    return [...this.buildElementMap().values()].find((el) => el.testId === testId)
  }

  /** Get all text content in the tree (depth-first). */
  getAllText(): string[] {
    return this.native.getAllText()
  }

  /** Print the tree structure for debugging. Only includes non-empty fields. */
  toJSON(): unknown {
    return JSON.parse(this.native.getTreeJson())
  }

  getAutomationTree(): string {
    return this.native.getAutomationTree()
  }

  getElementBounds(elementId: number): number[] | null {
    return this.native.getElementBounds(elementId)
  }

  /** How many elements the retained tree holds, reachable from the root or
   *  not — the only way a test can prove a removal actually freed a node. */
  getRetainedElementCount(): number {
    return this.native.getRetainedElementCount()
  }

  clockPause(): number {
    return this.native.clockPause()
  }

  clockSet(nowMs: number): number {
    return this.native.clockSet(nowMs)
  }

  clockFastForward(deltaMs: number): number {
    return this.native.clockFastForward(deltaMs)
  }

  clockResume(): number {
    return this.native.clockResume()
  }

  /** Advance GPUI's test dispatcher and run due timers.
   *  This is not `clockFastForward`. That moves the motion clock only.
   *  Use this for caret blink, input drag autoscroll, and list edge scroll. */
  advanceTime(milliseconds: number): void {
    this.native.advanceTime(milliseconds)
    this.dispatchNativeEvents()
  }

  focusElement(elementId: number): void {
    this.native.flush()
    this.native.focusElement(elementId)
    this.dispatchNativeEvents()
  }

  // ── Scroll API ──────────────────────────────────────────────────

  /** Set the scroll offset of a scrollable element (overflow: "scroll").
   *  x and y are negative pixel values (scroll down = more negative y).
   *  Call flush() internally to apply. */
  scrollTo(elementId: number, x: number, y: number): void {
    this.native.flush()
    this.native.scrollTo(elementId, x, y)
    // Flush again to re-render with the new offset
    this.native.flush()
  }

  /** Scroll a child into view by its index in the children list.
   *
   *  `offsetInItem` is in pixels. A negative value anchors the viewport top
   *  above the item, resolved against measured row heights at layout time, so
   *  a row stays pixel-stable while unmeasured rows are spliced in above it. */
  scrollToItem(elementId: number, index: number, offsetInItem?: number): void {
    this.native.flush()
    this.native.scrollToItem(elementId, index, offsetInItem)
    this.dispatchNativeEvents()
    this.native.flush()
  }

  /** Get the current scroll offset [x, y] or null if element is not scrollable. */
  getScrollOffset(elementId: number): [number, number] | null {
    this.native.flush()
    const result = this.native.getScrollOffset(elementId)
    if (!result) return null
    return [result[0], result[1]]
  }

  /** The logical scroll anchor of a `<virtual-list>`:
   *  `[itemIndex, offsetInItemPx, viewportHeightPx]`, or null for anything
   *  else. `itemIndex == item count` is gpui's at-end sentinel. Exact even
   *  while row heights are still estimates, because it is the anchor gpui
   *  itself scrolls by. */
  getListScrollTop(elementId: number): [number, number, number] | null {
    this.native.flush()
    const result = this.native.getListScrollTop(elementId)
    if (!result) return null
    return [result[0], result[1], result[2]]
  }

  // ── Canvas API ──────────────────────────────────────────────────

  /** Upload a full RGBA buffer for a `<canvas>` element and repaint. The
   *  native side validates the length and flushes the frame itself. */
  uploadCanvasPixels(
    elementId: number,
    width: number,
    height: number,
    pixels: Uint8Array | Uint8ClampedArray,
  ): void {
    // ImageData.data is Uint8ClampedArray; native takes a plain Uint8Array.
    const bytes =
      pixels instanceof Uint8ClampedArray
        ? new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
        : pixels
    this.native.uploadCanvasPixels?.(elementId, width, height, bytes)
  }

  /** Upload a `<canvas>` element's pixels straight from its 2D context core
   *  (Rust to Rust) and repaint — the path the context facade flushes on. */
  uploadCanvasFromContext(elementId: number, ctx: unknown): void {
    this.native.uploadCanvasFromContext?.(elementId, ctx)
  }

  /** The last uploaded buffer as RGBA, or null before the first upload.
   *  A bridge round-trip, not a GPU readback. */
  readCanvasPixels(elementId: number): Uint8Array | null {
    return this.native.readCanvasPixels?.(elementId) ?? null
  }

  // ── Pointer capture API ─────────────────────────────────────────

  /** Arm pointer capture on the element from its next press on: move and up
   *  keep targeting it after the pointer leaves its bounds. */
  setPointerCapture(elementId: number): void {
    this.native.setPointerCapture?.(elementId)
    this.native.flush()
    this.dispatchNativeEvents()
  }

  /** Release any active pointer capture now. */
  releasePointerCapture(): void {
    this.native.releasePointerCapture?.()
    this.native.flush()
    this.dispatchNativeEvents()
  }

  // ── Selection API ───────────────────────────────────────────────

  /** Drag-select from (x1,y1) to (x2,y2) and return the selected text.
   *
   *  Selection listeners are registered during **paint**, so the native helper
   *  flushes between every step. Calling simulateMouseDown/Move/Up by hand
   *  without those flushes selects nothing. */
  dragSelect(x1: number, y1: number, x2: number, y2: number): string | null {
    this.native.dragSelect(x1, y1, x2, y2)
    return this.native.getSelectedText()
  }

  /** The current selection joined in document order, or null. */
  getSelectedText(): string | null {
    return this.native.getSelectedText()
  }

  /** Every string painted in the last frame, in paint order.
   *
   *  `getAllText()` only sees `<text>` nodes in the retained tree. Native
   *  elements like `<code>` and `<diff>` paint their text inside GPUI, so this
   *  is the only way to assert on what they rendered. */
  getPaintedText(): string[] {
    return this.native.getPaintedText()
  }

  /** Every highlight wash painted in the last frame, in paint order. The only
   *  way to assert on `highlight` without a screenshot. */
  getPaintedHighlights(): HighlightMatch[] {
    return this.native.getPaintedHighlights()
  }

  /** Syntax-cache counters as `[hits, misses, documents]`. */
  getSyntaxCacheStats(): [number, number, number] {
    const [hits, misses, documents] = this.native.getSyntaxCacheStats()
    return [hits, misses, documents]
  }

  clearSelection(): void {
    this.native.clearSelection()
    this.native.flush()
  }

  setDebugFrameOverlay(mode: DebugFrameOverlayMode): string {
    return this.native.setDebugFrameOverlay(mode)
  }

  getDebugFrameOverlay(): string {
    return this.native.getDebugFrameOverlay()
  }

  cycleDebugFrameOverlay(): string {
    return this.native.cycleDebugFrameOverlay()
  }

  resetDebugFrameOverlayStats(): void {
    this.native.resetDebugFrameOverlayStats()
  }

  getDebugFrameOverlayStats(): DebugFrameOverlayStats {
    return this.native.getDebugFrameOverlayStats()
  }

  /** Capture a screenshot of the current rendered UI and save as PNG.
   *  macOS only — requires Metal GPU rendering via VisualTestAppContext. */
  captureScreenshot(path: string): void {
    this.native.flush()
    this.native.captureScreenshot(path)
  }

  /** Whether the native GPUI test renderer is available. Always true. */
  get hasNative(): boolean {
    return true
  }
}

// ── Test app helper ─────────────────────────────────────────────────

export interface TestApp {
  app: App<HostNode>
  container: HostNode
  renderer: TestRenderer
  /**
   * Flush Vue's scheduler, apply pending mutations to Rust, and repaint.
   * Call after simulating input (Vue updates are microtask-based).
   */
  settle: () => Promise<void>
  unmount: () => void
}

/**
 * Create a test app for rendering Vue components on the native
 * TestGpuixRenderer. All mutations go to the real GPUI pipeline.
 *
 * Pass `width` / `height` to size the offscreen window. The 1280x800 default
 * is wide enough to keep a centered max-width column capped, so a layout test
 * that needs to observe re-wrapping must ask for a narrower window.
 */
export function createTestApp(
  rootComponent: Component,
  options: TestWindowOptions = {},
): TestApp {
  const renderer = new TestRenderer(options)
  const gpuivHost = createGpuivRendererHost(renderer, { nextElementId: 0 })
  const app = gpuivHost.vue.createApp(rootComponent)
  // App code only ever sees application commands — never the commit facade —
  // so provide the raw renderer.
  app.provide(GPUIV_CONTEXT, { renderer })
  app.mount(gpuivHost.container)
  // No Vue scheduler job runs for the initial mount — flush synchronously.
  gpuivHost.flushMutations()
  renderer.flush()

  return {
    app,
    container: gpuivHost.container,
    renderer,
    settle: async () => {
      await nextTick()
      gpuivHost.flushMutations()
      renderer.flush()
      // The flush can itself produce events — a `highlight` resolve reports
      // its match count during the build — so deliver them before the caller
      // asserts. Idempotent when the queue is empty.
      renderer.dispatchNativeEvents()
    },
    unmount: () => {
      app.unmount()
      gpuivHost.flushMutations()
      gpuivHost.detach()
      renderer.flush()
    },
  }
}
