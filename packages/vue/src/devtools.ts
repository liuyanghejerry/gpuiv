/**
 * Vue DevTools (standalone) integration for GPUIV apps.
 *
 * The standalone devtools (`bun x vue-devtools`, then the devtools UI) talks
 * to the app over a socket: `@vue/devtools`'s `devtools.connect()` installs
 * `__VUE_DEVTOOLS_GLOBAL_HOOK__` and bridges Vue's dev events to the server.
 * The component tree and state inspection are framework-level, so they work
 * with GPUIV's custom renderer; features that need a DOM (element highlight,
 * the select-element picker, scroll-into-view, open-in-editor) stay inert.
 *
 * Two Bun environment mismatches must be shimmed before connecting, and both
 * are load-bearing:
 *
 * - Bun has no `window`, `document` or `location` — `navigator`, `self`,
 *   `addEventListener` and `removeEventListener` it does define, so those
 *   shims are for other runtimes. `@vue/devtools-shared` decides "browser"
 *   from `typeof navigator` (true on Bun), and the user-app (8.2.1) then
 *   reads `window.location.origin` and builds DOM nodes with
 *   `document.createElement` / `querySelectorAll` / `createRange` — the
 *   stubs turn those calls into no-ops instead of TypeErrors.
 *
 * - The same package computes its global `target` as
 *   `typeof window !== "undefined" ? window : globalThis`. If `window` were
 *   a stand-in object, the devtools hook would land on the stand-in and Vue
 *   would never see it. `window` therefore must BE globalThis.
 */

/** Options for `connectVueDevtools`. */
export interface DevtoolsConnectOptions {
  /** Devtools middleware server host. Default "http://localhost". */
  host?: string
  /** Devtools middleware server port. Default 8098 (`PORT` env on the
   *  `vue-devtools` CLI). Pass null when the host already includes one. */
  port?: number | null
}

const CONNECTED_KEY = "__gpuivDevtoolsConnected"

/**
 * Install the window/document shims exactly once. Returns the global keys
 * this call installed (empty on a repeat call) so a connect that fails can
 * undo exactly those. Exported for tests.
 */
export function installDevtoolsShims(): string[] {
  const g = globalThis as Record<string, unknown>
  const installed: string[] = []
  const shim = (key: string, value: unknown): void => {
    if (g[key] !== undefined) return
    g[key] = value
    installed.push(key)
  }
  shim("addEventListener", () => {})
  shim("removeEventListener", () => {})
  shim("location", { origin: "" })
  shim("window", g)
  shim("document", {
    // The stub the devtools overlays and `scrollToComponent` build with:
    // the latter appends a positioned div to document.body and calls
    // scrollIntoView on it when the component's root has none (always true
    // for a GPUIV host node).
    createElement: () => ({
      style: {},
      id: "",
      innerHTML: "",
      appendChild() {},
      removeChild() {},
      scrollIntoView() {},
    }),
    createRange: () => ({
      selectNode() {},
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
      }),
    }),
    getElementById: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {}, removeChild() {} },
  })
  return installed
}

/** Undo `installDevtoolsShims`, and only what it installed. */
function removeDevtoolsShims(installed: string[]): void {
  const g = globalThis as Record<string, unknown>
  for (const key of installed) delete g[key]
}

/**
 * Connect this process to a running standalone Vue DevTools server
 * (`bun x vue-devtools`). Call BEFORE createApp so the hook is installed in
 * time; the component tree and component state then appear in the devtools
 * UI. Safe to call again after a `bun --hot` reload — the second call is a
 * no-op. Returns false with a warning when `@vue/devtools` is not installed
 * or the client cannot start, in which case the shims are rolled back and
 * the process is left as it was.
 */
export async function connectVueDevtools(options: DevtoolsConnectOptions = {}): Promise<boolean> {
  const g = globalThis as Record<string, unknown>
  if (g[CONNECTED_KEY]) return true
  const shimmed = installDevtoolsShims()
  let devtools: { connect: (host?: string, port?: number) => unknown }
  try {
    ;({ devtools } = (await import("@vue/devtools")) as unknown as {
      devtools: { connect: (host?: string, port?: number) => unknown }
    })
  } catch {
    removeDevtoolsShims(shimmed)
    console.warn(
      "[gpuiv] connectVueDevtools: @vue/devtools is not installed. " +
        "Add it as a dev dependency and start the server with `bun x vue-devtools`.",
    )
    return false
  }
  try {
    // Upstream's connect() is async but its body runs synchronously: it
    // installs the hook (and needs the shims for that) before starting the
    // user-app bundle in a floating dynamic import. Awaiting it therefore
    // keeps the "call before createApp" contract, and turns a connect
    // failure (a shim gap, a dropped named export) into this warning instead
    // of an unhandled rejection. The runtime treats null as "no port in the
    // URL" (proxy setups) even though the published types only admit
    // number|undefined.
    await devtools.connect(options.host, options.port as number | undefined)
  } catch (error) {
    removeDevtoolsShims(shimmed)
    console.warn("[gpuiv] connectVueDevtools: could not start the devtools client.", error)
    return false
  }
  g[CONNECTED_KEY] = true
  return true
}
