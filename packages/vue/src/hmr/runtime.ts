/**
 * Vue Fast Refresh runtime for `bun --hot`.
 *
 * Bun's CLI hot mode has no `import.meta.hot`: on a save it re-evaluates the
 * whole module graph in the same process (globalThis survives). The
 * hmr-preload Bun plugin injects two calls into every module that defines
 * components:
 *
 *   __gpuivHmrFile(url, bodyHash)                 — top of the module body
 *   __gpuivHmrComponent(url, id, component, hash) — after each defineComponent
 *
 * On the first evaluation a file only registers. On later evaluations a
 * component whose statement hash changed — or every component when the
 * module body around it changed — is reloaded through Vue's dev-only HMR
 * runtime (__VUE_HMR_RUNTIME__.reload), which remounts that component in
 * place: its local state resets, its ancestors and siblings keep theirs.
 *
 * Two bun --hot traps shape this file:
 *
 * - A save re-instantiates every module, including vue itself, and the fresh
 *   vue instance's HMR component map is empty. The runtime therefore pins
 *   the FIRST generation's __VUE_HMR_RUNTIME__ in the globalThis state and
 *   always reloads through the instance that mounted the live app.
 *
 * - An entry with a top-level await (chat.tsx awaits the updater leg before
 *   createApp) suspends the module body across microtasks, so a "turn" has
 *   no reliable end marker. The reload counter is therefore monotonic and
 *   createApp keeps a watermark on it (a createApp call that sees the count
 *   advance keeps the live tree), and each file's body hash commits lazily
 *   at the start of the next evaluation of that file.
 */

interface VueHmrRuntime {
  createRecord: (id: string, initialDef: unknown) => boolean
  rerender: (id: string, newRender: unknown) => void
  reload: (id: string, newComp: unknown) => void
}

interface FileRecord {
  /** Body hash of the last committed generation. */
  body: string
  /** Body hash of the generation currently evaluating. */
  nextBody?: string
  /** hmrId → statement hash, one entry per registered component. */
  components: Map<string, string>
}

interface HmrState {
  files: Map<string, FileRecord>
  /** Monotonic count of reloads issued since process start. */
  reloadCount: number
  /** The first generation's __VUE_HMR_RUNTIME__, pinned: it is the instance
   *  that mounted the live app, and the only one whose component map is
   *  populated. */
  runtime?: VueHmrRuntime
}

const STATE_KEY = "__gpuivHmr"

function peekState(): HmrState | undefined {
  return Reflect.get(globalThis, STATE_KEY) as HmrState | undefined
}

function hmrState(): HmrState {
  const existing = peekState()
  if (existing) return existing
  const created: HmrState = {
    files: new Map(),
    reloadCount: 0,
  }
  Reflect.set(globalThis, STATE_KEY, created)
  return created
}

function vueHmrRuntime(): VueHmrRuntime | undefined {
  const state = hmrState()
  if (!state.runtime) {
    const runtime = Reflect.get(globalThis, "__VUE_HMR_RUNTIME__") as
      | VueHmrRuntime
      | undefined
    if (!runtime) return undefined
    state.runtime = runtime
  }
  return state.runtime
}

/** Injected at the top of a transformed module body. The first evaluation
 *  only registers the file's body hash; a re-evaluation commits the previous
 *  generation's hash and stashes the new one for __gpuivHmrComponent's
 *  change detection. */
export function __gpuivHmrFile(url: string, bodyHash: string): void {
  if (!vueHmrRuntime()) return
  const state = hmrState()
  const record = state.files.get(url)
  if (!record) {
    state.files.set(url, { body: bodyHash, components: new Map() })
    return
  }
  if (record.nextBody !== undefined) record.body = record.nextBody
  record.nextBody = bodyHash
}

/** Injected after each top-level `const X = defineComponent(...)` statement,
 *  next to the matching `X.__hmrId = id` assignment. Reloads X through Vue's
 *  HMR runtime when its own statement — or any module-level code around it —
 *  changed since the previous evaluation. */
export function __gpuivHmrComponent(
  url: string,
  id: string,
  component: unknown,
  statementHash: string
): void {
  const runtime = vueHmrRuntime()
  if (!runtime) return
  const state = hmrState()
  let record = state.files.get(url)
  if (!record) {
    record = { body: "", components: new Map() }
    state.files.set(url, record)
  }
  const previousHash = record.components.get(id)
  record.components.set(id, statementHash)
  if (record.nextBody === undefined) return
  const bodyChanged = record.nextBody !== record.body
  if (!bodyChanged && previousHash === statementHash) return
  state.reloadCount += 1
  // A component with no live instances is a no-op inside Vue's reload.
  runtime.reload(id, component)
}

/** The monotonic reload counter createApp watermarks: a createApp call that
 *  sees the count advance since its previous call keeps the live tree (the
 *  hot turn already updated the edited components in place); a call that
 *  sees no advance takes the classic remount path. */
export function hmrReloadCount(): number {
  return peekState()?.reloadCount ?? 0
}
