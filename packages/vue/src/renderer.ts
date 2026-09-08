import type { App, Component, ComponentPublicInstance } from "vue"
import { h } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import type { EventPayload, WindowOptions } from "@gpuiv/native"
import type {
  DebugFrameOverlayMode,
  HostNode,
  NativeRenderer,
  WindowKeyEventHandlers,
} from "./types.js"
import { createGpuivRendererHost } from "./reconciler/vue-renderer.js"
import {
  containerForRenderer,
  handleGpuixEvent,
  idAllocatorFor,
  nextWindowKeyEventId,
} from "./reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "./hooks/use-gpuix.js"
import {
  InProcessBackend,
  liveRendererAsTest,
  serveAutomationStdio,
  type LiveAutomationRenderer,
} from "./automation/client.js"
import { createComponentInspector } from "./automation/component-inspector.js"

const RUNTIME_ERROR_HANDLERS_KEY = "__gpuivRuntimeErrorHandlers"

type RuntimeErrorHandlers = {
  uncaughtException: (error: Error) => void
  unhandledRejection: (reason: unknown) => void
}

function runtimeErrorHandlers(): RuntimeErrorHandlers | undefined {
  return Reflect.get(globalThis, RUNTIME_ERROR_HANDLERS_KEY) as
    | RuntimeErrorHandlers
    | undefined
}

/** Keep bun alive after an uncaught throw, and surface it on the runtime
 *  error overlay. The handlers live on globalThis keyed by
 *  RUNTIME_ERROR_HANDLERS_KEY, so a `bun --hot` module re-evaluation cannot
 *  install a second copy, and resetApp() can take them off again. */
export function installRuntimeErrorHandlers(): void {
  if (typeof process === "undefined" || runtimeErrorHandlers()) return
  const handlers: RuntimeErrorHandlers = {
    uncaughtException: (error) => {
      scheduleRuntimeError(error)
    },
    unhandledRejection: (reason) => {
      scheduleRuntimeError(reason)
    },
  }
  process.on("uncaughtException", handlers.uncaughtException)
  process.on("unhandledRejection", handlers.unhandledRejection)
  Reflect.set(globalThis, RUNTIME_ERROR_HANDLERS_KEY, handlers)
}

function uninstallRuntimeErrorHandlers(): void {
  if (typeof process === "undefined") return
  const handlers = runtimeErrorHandlers()
  if (!handlers) return
  process.off("uncaughtException", handlers.uncaughtException)
  process.off("unhandledRejection", handlers.unhandledRejection)
  Reflect.deleteProperty(globalThis, RUNTIME_ERROR_HANDLERS_KEY)
}

/** Create the live renderer. Render-level event observation is bound to the
 *  owning root through the event registry (Container.onEvent), not captured
 *  here, so a `bun --hot` remount with a different `onEvent` is honored and
 *  stale roots cannot reach the replacement's observer. */
export function createNativeRenderer(): GpuixRenderer {
  const renderer = new GpuixRenderer((err, event) => {
    if (err) {
      console.error("[GPUIX] Native event error:", err)
      return
    }
    if (event) {
      // A throwing app handler must not become a napi_fatal_exception: the
      // native callback runs off the JS event loop with no frame above it.
      try {
        handleGpuixEvent(event, renderer)
      } catch (error) {
        scheduleRuntimeError(error)
      }
    }
  })
  // A pipe means a controller owns stdin. A TTY is a human keyboard.
  if (!process.stdin.isTTY && !process.env.VITEST) {
    const init = renderer.init.bind(renderer)
    renderer.init = (options) => {
      init(options)
      const backend = new InProcessBackend(liveRendererAsTest(renderer))
      // The Vue app does not exist yet — `createApp` attaches the component
      // inspector once it mounts, through this map.
      automationBackends.set(renderer, backend)
      serveAutomationStdio(backend)
    }
  }
  return renderer
}

const automationBackends = new WeakMap<NativeRenderer, InProcessBackend>()

/** ~125fps. Above any common display refresh rate, so frames are never the
 *  bottleneck, while still leaving the Node event loop almost entirely idle. */
const DEFAULT_FRAME_MS = 8

export interface FrameLoop {
  stop: () => void
}

/**
 * Drive GPUI's embedded macOS event loop at a fixed rate.
 *
 * On **macOS**, `renderer.tick()` pumps AppKit and asks GPUI for a frame, so it
 * must be called repeatedly. Do NOT call it from a `setImmediate` loop: that
 * spins the CPU at tens of thousands of ticks per second.
 *
 * On **Windows and Linux**, GPUI owns a blocking event loop on a Rust UI thread
 * and `tick()` only reports whether that loop is still running. The JS loop
 * polls the flag at the same fixed rate so the process exits once the last
 * window closes.
 *
 * Each frame is scheduled only after the previous one finishes, so a slow frame
 * delays the next one instead of letting timers pile up.
 *
 * `tick()` returning false means the last window closed. The loop stops and
 * `onTerminated` runs. `createApp()` uses that to exit the process.
 *
 * A throw from `tick()` must not stop the timer. On macOS that timer is the
 * AppKit pump; if it dies the window freezes while bun may still be alive.
 */
export function startFrameLoop(
  renderer: Pick<GpuixRenderer, "requiresTick" | "tick">,
  options: { frameMs?: number; onTerminated?: () => void } = {}
): FrameLoop {
  if (!renderer.requiresTick()) {
    return { stop: () => {} }
  }

  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const stop = (): void => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const loop = (): void => {
    if (stopped) return
    const started = performance.now()
    let running = true
    try {
      running = renderer.tick()
    } catch (error) {
      scheduleRuntimeError(error)
    }
    if (running === false) {
      stop()
      options.onTerminated?.()
      return
    }
    const wait = Math.max(0, frameMs - (performance.now() - started))
    timer = setTimeout(loop, wait)
  }
  loop()

  return { stop }
}

const RENDER_HOST_KEY = "__gpuivRenderHost"

export interface GpuivAppHandle {
  app: App<HostNode>
  container: HostNode
  renderer: NativeRenderer
  unmount: () => void
}

type RenderSlot = {
  renderer?: NativeRenderer
  handle?: GpuivAppHandle
  loop?: FrameLoop
  /** Last non-overlay root — the Reload button remounts it with lastOptions. */
  rootComponent?: Component
  lastOptions?: RenderOptions
  overlayShown?: boolean
  /** Bumped on every mount. A pending overlay microtask keys on it, so an
   *  error scheduled against an older tree cannot paint over a newer one. */
  mountSerial?: number
}

function thrownToError(thrown: unknown): Error | string {
  if (thrown instanceof Error) return thrown
  if (typeof thrown === "string") return thrown
  try {
    return String(thrown)
  } catch {
    return "Unknown error"
  }
}

function formatRuntimeError(
  thrown: Error | string,
  errorContext?: string
): { message: string; stack: string } {
  let message: string
  let stack: string
  if (thrown instanceof Error) {
    message = thrown.message || thrown.name
    stack = thrown.stack ?? `${thrown.name}: ${thrown.message}`
  } else {
    message = thrown
    stack = thrown
  }
  if (!message) message = "Unknown error"
  const extra = errorContext?.trim()
  if (extra && !stack.includes(extra)) stack = `${stack}\n${extra}`
  if (!stack.includes(message)) stack = `${message}\n${stack}`
  return { message, stack }
}

/** Vue's errorHandler has no React-style componentStack; walk the parent
 *  chain for a best-effort "at Foo at Bar" trace. */
function componentChainOf(
  instance: ComponentPublicInstance | null
): string | undefined {
  let current = instance?.$ ?? null
  const names: string[] = []
  while (current) {
    const type = current.type as { name?: string; __name?: string } | null
    const name = type?.name ?? type?.__name
    if (name) names.push(name)
    current = current.parent ?? null
  }
  return names.length > 0 ? `at ${names.join(" at ")}` : undefined
}

/** Route every runtime error to one place: the app errorHandler, the native
 *  event-callback catch, the frame-loop tick catch, and the process-level
 *  handlers all call this. With no mounted app there is nothing to overlay,
 *  so the error lands on the console only. */
function scheduleRuntimeError(error: unknown, errorContext?: string): void {
  const slot = Reflect.get(globalThis, RENDER_HOST_KEY) as RenderSlot | undefined
  const thrown = thrownToError(error)
  if (!slot || slot.mountSerial === undefined) {
    console.error("[gpuiv] runtime error:", thrown)
    return
  }
  const failedSerial = slot.mountSerial
  queueMicrotask(() => {
    const current = Reflect.get(globalThis, RENDER_HOST_KEY) as RenderSlot | undefined
    if (!current?.handle || current.mountSerial !== failedSerial) return
    showRuntimeError(thrown, errorContext)
  })
}

function showRuntimeError(thrown: Error | string, errorContext?: string): void {
  const slot = Reflect.get(globalThis, RENDER_HOST_KEY) as RenderSlot | undefined
  if (!slot || slot.overlayShown) return
  const formatted = formatRuntimeError(thrown, errorContext)
  console.error("[gpuiv] runtime error:", thrown)
  console.error(formatted.stack)
  slot.overlayShown = true
  try {
    mountTree(slot, runtimeErrorOverlay(formatted, () => reloadApp(slot)), slot.lastOptions ?? {})
  } catch (overlayError) {
    slot.overlayShown = false
    console.error("[gpuiv] failed to show runtime error overlay:", overlayError)
  }
}

function reloadApp(slot: RenderSlot): void {
  if (slot.rootComponent === undefined) return
  createApp(slot.rootComponent, slot.lastOptions ?? {})
}

function runtimeErrorOverlay(
  error: { message: string; stack: string },
  onReload: () => void
): Component {
  const lines = error.stack.length === 0 ? [error.message] : error.stack.split("\n")
  return () =>
    h(
      "div",
      {
        testId: "runtime-error-overlay",
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: 32,
          gap: 16,
          backgroundColor: "#1c0b0b",
          pointerEvents: "auto",
        },
      },
      [
        h(
          "text",
          { style: { fontSize: 22, fontWeight: 700, color: "#f87171" } },
          "Runtime error"
        ),
        h(
          "div",
          {
            testId: "runtime-error-stack",
            style: {
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              minHeight: 0,
              overflowY: "scroll",
              gap: 2,
            },
          },
          lines.map((line) =>
            h(
              "text",
              { style: { fontSize: 13, color: "#fecaca" } },
              line === "" ? " " : line
            )
          )
        ),
        h(
          "div",
          {
            testId: "runtime-error-reload",
            onClick: onReload,
            style: {
              alignSelf: "flex-start",
              padding: 10,
              paddingLeft: 16,
              paddingRight: 16,
              borderRadius: 8,
              backgroundColor: "#7f1d1d",
              hover: { backgroundColor: "#991b1b" },
            },
          },
          [
            h(
              "text",
              { style: { fontSize: 14, fontWeight: 600, color: "#fee2e2" } },
              "Reload"
            ),
          ]
        ),
      ]
    )
}

function renderSlot(): RenderSlot {
  const existing = Reflect.get(globalThis, RENDER_HOST_KEY)
  if (existing) {
    return existing
  }
  const created: RenderSlot = {}
  Reflect.set(globalThis, RENDER_HOST_KEY, created)
  return created
}

export interface RenderOptions extends WindowOptions, WindowKeyEventHandlers {
  onEvent?: (event: EventPayload) => void
  renderer?: NativeRenderer
  /** GPUI scene overlay. Does not go through layout. */
  debugFrameOverlay?: DebugFrameOverlayMode
}

export function resetApp(): void {
  const slot = Reflect.get(globalThis, RENDER_HOST_KEY) as RenderSlot | undefined
  slot?.loop?.stop()
  slot?.handle?.unmount()
  Reflect.deleteProperty(globalThis, RENDER_HOST_KEY)
  uninstallRuntimeErrorHandlers()
}

/**
 * Mount a Vue app onto the native GPUI window.
 *
 * Under `bun --hot`, later calls unmount the previous tree and remount on the
 * same native window. `renderer` stays on the slot and its element-id
 * allocator lives in the registry's module-reload-proof state, so ids and
 * Rust state survive the remount.
 */
export function createApp(
  rootComponent: Component,
  options: RenderOptions = {}
): GpuivAppHandle {
  const {
    onEvent,
    onKeyDown,
    onKeyUp,
    renderer: injected,
    debugFrameOverlay,
    ...windowOptions
  } = options
  const slot = renderSlot()
  if (!slot.renderer) {
    if (injected) {
      slot.renderer = injected
    } else {
      const renderer = createNativeRenderer()
      renderer.init(windowOptions)
      slot.renderer = renderer
      console.log("[gpuiv] created native window")
    }
  }
  const host = slot.renderer
  if (!host) {
    throw new Error("GPUIX renderer is not initialized")
  }
  if (debugFrameOverlay) {
    host.setDebugFrameOverlay?.(debugFrameOverlay)
  }
  installRuntimeErrorHandlers()
  if (!injected && host instanceof GpuixRenderer) {
    // Start pumping before the first mount flush, so a throw during mount
    // still leaves AppKit ticking. The loop is not restarted on remount:
    // stopping it between trees would freeze the window for a frame.
    if (!slot.loop) {
      slot.loop = startFrameLoop(host, {
        onTerminated: () => {
          process.exit(0)
        },
      })
    }
  }
  slot.rootComponent = rootComponent
  slot.lastOptions = options
  slot.overlayShown = false
  return mountTree(slot, rootComponent, options)
}

/** Mount `rootComponent` on the slot's renderer, replacing any live tree.
 *  Shared by createApp, the runtime error overlay, and its Reload button —
 *  each mount is a fresh app instance with the errorHandler wired, the
 *  render-level observer rebound, and the automation inspector reattached. */
function mountTree(
  slot: RenderSlot,
  rootComponent: Component,
  options: RenderOptions
): GpuivAppHandle {
  const host = slot.renderer
  if (!host) {
    throw new Error("GPUIX renderer is not initialized")
  }
  const { onEvent, onKeyDown, onKeyUp } = options
  const previous = slot.handle
  slot.handle = undefined
  if (previous) {
    console.log("[gpuiv] remount: unmount previous tree")
    previous.unmount()
  }
  // Bump after the old tree is gone: an error thrown during its unmount
  // schedules against the old serial and is dropped, while an error in the
  // new mount schedules against this one.
  slot.mountSerial = (slot.mountSerial ?? 0) + 1

  const windowKeyEventId = nextWindowKeyEventId(host)
  const gpuivHost = createGpuivRendererHost(
    host,
    idAllocatorFor(host),
    { onKeyDown, onKeyUp },
    windowKeyEventId
  )
  // Bind the render-level observer to this root. A remount replaces it, and
  // events from the unmounted tree find no handlers, so they never reach the
  // replacement's observer.
  const registryContainer = containerForRenderer(host)
  if (registryContainer) registryContainer.onEvent = onEvent
  try {
    host.setWindowKeyEvents?.(Boolean(onKeyDown), Boolean(onKeyUp), windowKeyEventId)
  } catch (error) {
    gpuivHost.detach()
    throw error
  }
  const app = gpuivHost.vue.createApp(rootComponent)
  app.config.errorHandler = (err, instance, info) => {
    scheduleRuntimeError(err, [info, componentChainOf(instance)].filter(Boolean).join("\n"))
  }
  // App code only ever sees application commands (scroll, window, debug) —
  // never the commit facade — so provide the raw renderer.
  app.provide(GPUIV_CONTEXT, { renderer: host })
  app.mount(gpuivHost.container)
  gpuivHost.flushMutations()
  // Component state over the automation protocol. Reattached on every mount
  // so a `bun --hot` remount never leaves the session walking a dead tree.
  automationBackends.get(host)?.setComponentInspector(createComponentInspector(app))

  const handle: GpuivAppHandle = {
    app,
    container: gpuivHost.container,
    renderer: host,
    unmount: () => {
      app.unmount()
      gpuivHost.flushMutations()
      // Only the live root may turn its window key listeners off; a stale
      // unmount must not disable the replacement's.
      if (gpuivHost.detach()) {
        host.setWindowKeyEvents?.(false, false, windowKeyEventId)
      }
    },
  }
  slot.handle = handle

  console.log("[gpuiv] mount complete")
  return handle
}
