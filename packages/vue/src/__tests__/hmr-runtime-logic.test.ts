/// Unit tests for the Fast Refresh runtime's bookkeeping — file records,
/// reload counters, duplicate-watch suppression, and the pinned Vue HMR
/// runtime — driven through the two injected entry points with a stand-in
/// module graph. No GPU, no native renderer.

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __gpuivHmrComponent,
  __gpuivHmrFile,
  hmrReloadCount,
  hmrSettledDuplicates,
  noteHmrMount,
} from "../hmr/runtime.js"

const STATE_KEY = "__gpuivHmr"
const RUNTIME_KEY = "__VUE_HMR_RUNTIME__"

const realVueRuntime = Reflect.get(globalThis, RUNTIME_KEY)

interface RuntimeCalls {
  createRecord: string[]
  rerender: string[]
  reload: Array<[string, unknown]>
}

function installFakeRuntime(): { runtime: unknown; calls: RuntimeCalls } {
  const calls: RuntimeCalls = { createRecord: [], rerender: [], reload: [] }
  const runtime = {
    createRecord: (id: string) => {
      calls.createRecord.push(id)
      return true
    },
    rerender: (id: string) => {
      calls.rerender.push(id)
    },
    reload: (id: string, component: unknown) => {
      calls.reload.push([id, component])
    },
  }
  Reflect.set(globalThis, RUNTIME_KEY, runtime)
  return { runtime, calls }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, STATE_KEY)
  if (realVueRuntime === undefined) {
    Reflect.deleteProperty(globalThis, RUNTIME_KEY)
  } else {
    Reflect.set(globalThis, RUNTIME_KEY, realVueRuntime)
  }
  vi.useRealTimers()
})

describe("hmr runtime state", () => {
  it("reports zero counters before anything registered", () => {
    Reflect.deleteProperty(globalThis, STATE_KEY)
    expect(hmrReloadCount()).toBe(0)
    expect(hmrSettledDuplicates()).toBe(0)
  })

  it("ignores injected calls when no Vue HMR runtime is installed", () => {
    Reflect.deleteProperty(globalThis, STATE_KEY)
    Reflect.deleteProperty(globalThis, RUNTIME_KEY)
    __gpuivHmrFile("/v/entry.tsx", "body-1")
    __gpuivHmrComponent("/v/entry.tsx", "id", { tag: 1 }, "stmt-1")
    // vueHmrRuntime() eagerly creates the state shell, but nothing registers
    // and no counter moves.
    const state = Reflect.get(globalThis, STATE_KEY) as { files: Map<string, unknown> }
    expect(state.files.size).toBe(0)
    expect(hmrReloadCount()).toBe(0)
    expect(hmrSettledDuplicates()).toBe(0)
  })

  it("noteHmrMount pins the runtime that is current at mount time", () => {
    Reflect.deleteProperty(globalThis, STATE_KEY)
    noteHmrMount()
    expect(Reflect.get(globalThis, STATE_KEY)).toBeUndefined()

    const first = installFakeRuntime()
    noteHmrMount()
    // A later bun --hot generation installs a fresh __VUE_HMR_RUNTIME__; the
    // pin must keep pointing at the copy that owns the live tree.
    const second = installFakeRuntime()
    __gpuivHmrFile("/v/entry.tsx", "body-1")
    __gpuivHmrComponent("/v/entry.tsx", "id", { tag: 1 }, "stmt-1")
    __gpuivHmrFile("/v/entry.tsx", "body-1")
    __gpuivHmrComponent("/v/entry.tsx", "id", { tag: 2 }, "stmt-2")
    expect(first.calls.reload).toHaveLength(1)
    expect(second.calls.reload).toHaveLength(0)
  })
})

describe("__gpuivHmrFile", () => {
  it("registers the first evaluation without reloading", () => {
    const { calls } = installFakeRuntime()
    __gpuivHmrFile("/v/entry.tsx", "body-1")
    expect(calls.reload).toHaveLength(0)
    expect(hmrReloadCount()).toBe(0)
  })

  it("suppresses a byte-identical re-evaluation of a just-changed file", () => {
    installFakeRuntime()
    const url = "/v/entry.tsx"
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "id", { tag: 1 }, "stmt-1")
    // The save: body and statement both change.
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, "id", { tag: 2 }, "stmt-2")
    expect(hmrReloadCount()).toBe(1)
    // The watcher's duplicate report of that same save: identical hashes,
    // milliseconds later.
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, "id", { tag: 2 }, "stmt-2")
    expect(hmrSettledDuplicates()).toBe(1)
    expect(hmrReloadCount()).toBe(1)
  })

  it("treats an identical evaluation after the window as its own turn", () => {
    installFakeRuntime()
    const url = "/v/entry.tsx"
    vi.useFakeTimers({ toFake: ["Date"] })
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "id", { tag: 1 }, "stmt-1")
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, "id", { tag: 2 }, "stmt-2")
    // Well past DUPLICATE_WINDOW_MS: the same hashes are an asset-save-shaped
    // turn, not a duplicate report.
    vi.setSystemTime(vi.getMockedSystemTime()!.getTime() + 1_000)
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, "id", { tag: 2 }, "stmt-2")
    expect(hmrSettledDuplicates()).toBe(0)
    // Nothing changed in that turn, so nothing reloads either.
    expect(hmrReloadCount()).toBe(1)
  })
})

describe("__gpuivHmrComponent", () => {
  it("reloads a component whose statement hash changed", () => {
    const { calls } = installFakeRuntime()
    const url = "/v/entry.tsx"
    const v1 = { tag: 1 }
    const v2 = { tag: 2 }
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "Child", v1, "stmt-1")
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "Child", v2, "stmt-2")
    expect(calls.reload).toEqual([["Child", v2]])
    expect(hmrReloadCount()).toBe(1)
  })

  it("reloads every component when only the module body changed", () => {
    const { calls } = installFakeRuntime()
    const url = "/v/entry.tsx"
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "A", { a: 1 }, "stmt-a")
    __gpuivHmrComponent(url, "B", { b: 1 }, "stmt-b")
    __gpuivHmrFile(url, "body-2")
    __gpuivHmrComponent(url, "A", { a: 1 }, "stmt-a")
    __gpuivHmrComponent(url, "B", { b: 1 }, "stmt-b")
    expect(calls.reload.map(([id]) => id)).toEqual(["A", "B"])
    expect(hmrReloadCount()).toBe(2)
  })

  it("skips the reload when neither body nor statement changed", () => {
    const { calls } = installFakeRuntime()
    const url = "/v/entry.tsx"
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "Child", { tag: 1 }, "stmt-1")
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "Child", { tag: 1 }, "stmt-1")
    expect(calls.reload).toHaveLength(0)
    expect(hmrReloadCount()).toBe(0)
  })

  it("creates the file record when the component registers before the file", () => {
    const { calls } = installFakeRuntime()
    const url = "/v/reordered.tsx"
    __gpuivHmrComponent(url, "Child", { tag: 1 }, "stmt-1")
    expect(calls.reload).toHaveLength(0)
    // The file's first evaluation commits body "" → "body-1": a body change,
    // so the unchanged statement hash still reloads.
    __gpuivHmrFile(url, "body-1")
    __gpuivHmrComponent(url, "Child", { tag: 1 }, "stmt-1")
    expect(calls.reload).toHaveLength(1)
  })
})
