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
 *   vue instance's HMR component map is empty. Vue records a mounted tree in
 *   the copy that mounted it, so this runtime reloads through a pinned
 *   __VUE_HMR_RUNTIME__ — the copy that owns the live tree — and noteHmrMount()
 *   re-pins it on every mount. A classic remount (an asset save, the error
 *   overlay's Reload button) mounts the new tree from the newest copy, so
 *   without the re-pin every later reload would go to a copy with no live
 *   instances and silently do nothing.
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
  /** When this file last started evaluating, in ms. */
  lastEvalAt: number
  /** Whether the previous evaluation of this file changed its body — the
   *  precondition for recognizing a duplicate watch event. */
  justChanged: boolean
}

interface HmrState {
  files: Map<string, FileRecord>
  /** Monotonic count of reloads issued since process start. */
  reloadCount: number
  /** Monotonic count of duplicate re-evaluations suppressed since process
   *  start. createApp watermarks this alongside `reloadCount` to keep the
   *  live tree when a save was reported twice. */
  settledDuplicates: number
  /** The __VUE_HMR_RUNTIME__ of the vue copy that mounted the live tree:
   *  Vue records mounted instances in the copy that mounted them, so a reload
   *  through any other copy finds no instances. Re-pinned by noteHmrMount()
   *  whenever a tree mounts. */
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
    settledDuplicates: 0,
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

/** Called by the mount path right before a tree mounts. At that moment
 *  `globalThis.__VUE_HMR_RUNTIME__` is the mounting generation's copy — the
 *  one whose component map the new tree registers into — so this is where the
 *  pin moves after a classic remount (an asset save, the error overlay's
 *  Reload button). The previous pin belongs to the tree that just unmounted.
 *
 *  The keep-the-live-tree path in createApp must NOT call this: that tree is
 *  still registered in the pinned copy, and re-pinning to a newer one would
 *  make the next reload a no-op. */
export function noteHmrMount(): void {
  const runtime = Reflect.get(globalThis, "__VUE_HMR_RUNTIME__") as
    | VueHmrRuntime
    | undefined
  if (!runtime) return
  hmrState().runtime = runtime
}

/** How soon after a changed evaluation an identical one counts as a
 * duplicate watch event rather than its own turn. Bun's Windows watcher can
 * report one save twice; the second evaluation is byte-identical and lands
 * within the same event-loop drain (milliseconds), while real saves are
 * separated by at least a user's save cadence. */
const DUPLICATE_WINDOW_MS = 50

/** Injected at the top of a transformed module body. The first evaluation
 * only registers the file's body hash; a re-evaluation commits the previous
 * generation's hash and stashes the new one for __gpuivHmrComponent's
 * change detection. */
export function __gpuivHmrFile(url: string, bodyHash: string): void {
  if (!vueHmrRuntime()) return
  const state = hmrState()
  const record = state.files.get(url)
  if (!record) {
    state.files.set(url, {
      body: bodyHash,
      components: new Map(),
      lastEvalAt: Date.now(),
      justChanged: false,
    })
    return
  }
  const now = Date.now()
  const previousEvalHash = record.nextBody
  const duplicate =
    previousEvalHash !== undefined &&
    previousEvalHash === bodyHash &&
    record.justChanged &&
    now - record.lastEvalAt <= DUPLICATE_WINDOW_MS
  record.lastEvalAt = now
  if (record.nextBody !== undefined) record.body = record.nextBody
  record.nextBody = bodyHash
  if (duplicate) {
    // A watcher double-report of the save that just hot-applied: nothing in
    // this generation differs, so remounting would only throw away the state
    // the reload preserved. Count it for createApp's watermark and keep
    // `justChanged` armed so a third report is suppressed too.
    state.settledDuplicates += 1
    return
  }
  // Against the committed body, so the first re-evaluation of a changed file
  // counts as changed even though its predecessor stashed nothing.
  record.justChanged = bodyHash !== record.body
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
    record = {
      body: "",
      components: new Map(),
      lastEvalAt: 0,
      justChanged: false,
    }
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

/** The monotonic duplicate-suppression counter createApp watermarks
 *  alongside the reload count: a watcher double-report of a save re-runs the
 *  entry with unchanged hashes, and without this signal that identical turn
 *  would take the remount path and discard the state the reload kept. */
export function hmrSettledDuplicates(): number {
  return peekState()?.settledDuplicates ?? 0
}
