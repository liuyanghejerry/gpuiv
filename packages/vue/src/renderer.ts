import type { Component } from "vue"
import type { App } from "vue"
import { GpuixRenderer } from "@gpuiv/native"
import type { EventPayload, WindowOptions } from "@gpuiv/native"
import type { DebugFrameOverlayMode, HostNode, NativeRenderer } from "./types.js"
import { createGpuivRendererHost } from "./reconciler/vue-renderer.js"
import { handleGpuixEvent } from "./reconciler/event-registry.js"
import { GPUIV_CONTEXT } from "./hooks/use-gpuix.js"
import {
  InProcessBackend,
  liveRendererAsTest,
  serveAutomationStdio,
  type LiveAutomationRenderer,
} from "./automation/client.js"

export function createNativeRenderer(
  onEvent?: (event: EventPayload) => void
): GpuixRenderer {
  const renderer = new GpuixRenderer((err, event) => {
    if (err) {
      console.error("[GPUIX] Native event error:", err)
      return
    }
    if (event) {
      handleGpuixEvent(event, renderer)
      if (onEvent) {
        onEvent(event)
      }
    }
  })
  // A pipe means a controller owns stdin. A TTY is a human keyboard.
  if (!process.stdin.isTTY && !process.env.VITEST) {
    const init = renderer.init.bind(renderer)
    renderer.init = (options) => {
      init(options)
      serveAutomationStdio(new InProcessBackend(liveRendererAsTest(renderer)))
    }
  }
  return renderer
}

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
    const running = renderer.tick()
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

export interface RenderOptions extends WindowOptions {
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
}

const idAllocators = new WeakMap<NativeRenderer, { nextElementId: number }>()

function idAllocatorFor(renderer: NativeRenderer): { nextElementId: number } {
  let alloc = idAllocators.get(renderer)
  if (!alloc) {
    alloc = { nextElementId: 0 }
    idAllocators.set(renderer, alloc)
  }
  return alloc
}

/**
 * Mount a Vue app onto the native GPUI window.
 *
 * Under `bun --hot`, later calls unmount the previous tree and remount on the
 * same native window. `renderer` stays on the slot, so ids and Rust state
 * survive the remount.
 */
export function createApp(
  rootComponent: Component,
  options: RenderOptions = {}
): GpuivAppHandle {
  const { onEvent, renderer: injected, debugFrameOverlay, ...windowOptions } = options
  const slot = renderSlot()
  if (!slot.renderer) {
    if (injected) {
      slot.renderer = injected
    } else {
      const renderer = createNativeRenderer(onEvent)
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
  if (slot.handle) {
    console.log("[gpuiv] remount: unmount previous tree")
    slot.handle.unmount()
  }

  const gpuivHost = createGpuivRendererHost(host, idAllocatorFor(host))
  const app = gpuivHost.vue.createApp(rootComponent)
  // App code only ever sees application commands (scroll, window, debug) —
  // never the commit facade — so provide the raw renderer.
  app.provide(GPUIV_CONTEXT, { renderer: host })
  app.mount(gpuivHost.container)
  gpuivHost.flushMutations()

  const handle: GpuivAppHandle = {
    app,
    container: gpuivHost.container,
    renderer: host,
    unmount: () => {
      app.unmount()
      gpuivHost.flushMutations()
      gpuivHost.detach()
    },
  }
  slot.handle = handle

  if (!injected && slot.renderer instanceof GpuixRenderer) {
    slot.loop?.stop()
    slot.loop = startFrameLoop(slot.renderer, {
      onTerminated: () => {
        process.exit(0)
      },
    })
  }
  console.log("[gpuiv] mount complete")
  return handle
}
