/** The host-node mirror is what Vue's keyed patching reads back through
 *  `parentNode` / `nextSibling`, so its child order must track every insert,
 *  move and removal exactly. These run large keyed lists through reorders,
 *  removals at both ends and in the middle, clears and appends, and compare
 *  the mirror with the rendered keys after each step. Headless: no GPU. */

import { defineComponent, h, shallowRef } from "vue"
import { describe, expect, it } from "vitest"
import type { HostNode } from "../types.js"
import { mountHeadless } from "./headless.js"

const keys = shallowRef<number[]>([])
const List = defineComponent({
  setup: () => () =>
    h("div", { style: { overflowY: "scroll" } },
      keys.value.map((key) => h("div", { key }, [h("text", null, String(key))]))),
})

/** The list `div` under the container (the root may add a fragment anchor). */
function listNode(container: HostNode): HostNode {
  const list = container.children.find((child) => child.type === "div")
  if (!list) throw new Error("list div not mounted")
  return list
}

function mirrorKeys(container: HostNode): number[] {
  return listNode(container)
    .children.filter((child) => child.type === "div")
    // Each row is <div><text>{key}</text></div>; the string is a `#text`
    // instance under the host <text>.
    .map((child) => Number(child.children[0]?.children[0]?.text))
}

function expectMirrorConsistent(container: HostNode) {
  const list = listNode(container)
  for (const child of list.children) expect(child.parent).toBe(list)
  expect(new Set(list.children).size).toBe(list.children.length)
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

/** Seeded Fisher–Yates, so a failure reproduces. */
function shuffle(values: number[]): number[] {
  const out = [...values]
  let seed = 7
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe("host mirror under keyed list churn", () => {
  it("tracks reorders, removals, clears and appends", async () => {
    keys.value = range(0, 600)
    const app = mountHeadless(List)
    try {
      const steps: Array<[string, (current: number[]) => number[]]> = [
        ["reverse", (k) => [...k].reverse()],
        ["swap 1 and 598", (k) => { const n = [...k]; [n[1], n[598]] = [n[598]!, n[1]!]; return n }],
        ["remove front", (k) => k.slice(1)],
        ["remove back", (k) => k.slice(0, -1)],
        ["remove every 7th", (k) => k.filter((_, i) => i % 7 !== 3)],
        ["prepend 50", (k) => [...range(1000, 1050), ...k]],
        ["append 50", (k) => [...k, ...range(2000, 2050)]],
        ["insert in middle", (k) => [...k.slice(0, 200), ...range(3000, 3020), ...k.slice(200)]],
        ["shuffle", (k) => shuffle(k)],
        ["clear", () => []],
        ["refill", () => range(5000, 5600)],
        ["remove first half", (k) => k.slice(300)],
      ]
      for (const [name, next] of steps) {
        keys.value = next(keys.value)
        await app.settle()
        expect(mirrorKeys(app.container), name).toEqual(keys.value)
        expectMirrorConsistent(app.container)
      }
    } finally {
      app.unmount()
    }
  })
})
