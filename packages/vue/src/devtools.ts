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
 * - `@vue/devtools-shared` decides "browser" from `typeof navigator`, which
 *   Bun defines. Its electron user-app then calls `window.addEventListener`
 *   and touches `document` — both absent in Bun — so the shims make those
 *   calls harmless no-ops.
 *
 * - The same package computes its global `target` as
 *   `typeof window !== "undefined" ? window : globalThis`. If `window` were
 *   a stand-in object, the devtools hook would land on the stand-in and Vue
 *   would never see it. `window` therefore must BE globalThis.
 */

interface DevtoolsConnectOptions {
  /** Devtools middleware server host. Default "http://localhost". */
  host?: string
  /** Devtools middleware server port. Default 8098 (`PORT` env on the
   *  `vue-devtools` CLI). Pass null when the host already includes one. */
  port?: number | null
}

const CONNECTED_KEY = "__gpuivDevtoolsConnected"

/** Install the window/document shims exactly once. Exported for tests. */
export function installDevtoolsShims(): void {
  const g = globalThis as Record<string, unknown>
  g.addEventListener ??= () => {}
  g.removeEventListener ??= () => {}
  g.location ??= { origin: "" }
  g.window ??= g
  g.document ??= {
    createElement: () => ({
      style: {},
      id: "",
      innerHTML: "",
      appendChild() {},
      removeChild() {},
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
  }
}

/**
 * Connect this process to a running standalone Vue DevTools server
 * (`bun x vue-devtools`). Call BEFORE createApp so the hook is installed in
 * time; the component tree and component state then appear in the devtools
 * UI. Safe to call again after a `bun --hot` reload — the second call is a
 * no-op. Returns false with a warning when `@vue/devtools` is not installed.
 */
export async function connectVueDevtools(options: DevtoolsConnectOptions = {}): Promise<boolean> {
  const g = globalThis as Record<string, unknown>
  if (g[CONNECTED_KEY]) return true
  installDevtoolsShims()
  let devtools: { connect: (host?: string, port?: number) => unknown }
  try {
    ;({ devtools } = (await import("@vue/devtools")) as unknown as {
      devtools: { connect: (host?: string, port?: number) => unknown }
    })
  } catch {
    console.warn(
      "[gpuiv] connectVueDevtools: @vue/devtools is not installed. " +
        "Add it as a dev dependency and start the server with `bun x vue-devtools`.",
    )
    return false
  }
  g[CONNECTED_KEY] = true
  // The runtime treats null as "no port in the URL" (proxy setups) even
  // though the published types only admit number|undefined.
  devtools.connect(options.host, options.port as number | undefined)
  return true
}
