/** Portals through Vue's built-in `<Teleport>`: children mount under a host
 *  element taken from a template ref, kept in key order, and free their
 *  elements when the Teleport unmounts. Runs everywhere — the retained-tree
 *  mirror is reconstructed from the recorded protocol ops. The GPU suite in
 *  portal.test.tsx covers the painted equivalents. */

import { defineComponent, h, reactive, ref } from "vue"
import { Teleport } from "vue"
import { describe, expect, it } from "vitest"
import { mountHeadless } from "./headless.js"
import type { Op } from "./headless.js"

interface TreeNode {
  type: string
  children: number[]
  text?: string
}

function treeFromOps(ops: Op[]): Map<number, TreeNode> {
  const nodes = new Map<number, TreeNode>()
  const destroy = (id: number, dead: Set<number>) => {
    dead.add(id)
    for (const c of nodes.get(id)?.children ?? []) destroy(c, dead)
  }
  for (const op of ops) {
    const [name, ...args] = op as [string, ...unknown[]]
    if (name === "createElement") {
      nodes.set(args[0] as number, { type: args[1] as string, children: [] })
    } else if (name === "appendChild") {
      nodes.get(args[0] as number)?.children.push(args[1] as number)
    } else if (name === "insertBefore") {
      const parent = nodes.get(args[0] as number)!
      const child = args[1] as number
      const at = parent.children.indexOf(args[2] as number)
      if (at === -1) parent.children.push(child)
      else parent.children.splice(at, 0, child)
    } else if (name === "destroyElement") {
      const dead = new Set<number>()
      destroy(args[0] as number, dead)
      for (const [id, node] of nodes) {
        node.children = node.children.filter((c) => !dead.has(c))
        if (dead.has(id)) nodes.delete(id)
      }
    } else if (name === "setText") {
      const node = nodes.get(args[0] as number)
      if (node) node.text = args[1] as string
    }
  }
  return nodes
}

const state = reactive({ items: [] as string[], mounted: true })

const Screen = defineComponent({
  setup() {
    const layer = ref<any>(null)
    return () =>
      h("div", { style: { width: 200, height: 200 } }, [
        h("div", { ref: layer, "test-id": "layer", style: { width: 100, height: 100 } }),
        h("div", { "test-id": "lexical-parent" }, [
          state.mounted && layer.value
            ? h(
                Teleport,
                { to: layer.value },
                () => state.items.map((item) => h("text", { key: item }, item))
              )
            : null,
        ]),
      ])
  },
})

/** The first text inside a subtree — a host `<text>` keeps its string content
 *  on a child `#text` instance. */
function textOfSubtree(nodes: Map<number, TreeNode>, id: number): string | undefined {
  const node = nodes.get(id)
  if (!node) return undefined
  if (node.text) return node.text
  for (const child of node.children) {
    const text = textOfSubtree(nodes, child)
    if (text) return text
  }
  return undefined
}

/** The layer's children that carry text — Teleport's own start/end anchors
 *  are empty text nodes and stay out of the way. */
const contentEntries = (nodes: Map<number, TreeNode>, layerId: number) =>
  nodes
    .get(layerId)!
    .children.map((id) => [id, textOfSubtree(nodes, id)] as const)
    .filter((entry): entry is readonly [number, string] => Boolean(entry[1]))

const contentTexts = (nodes: Map<number, TreeNode>, layerId: number) =>
  contentEntries(nodes, layerId).map(([, text]) => text)

describe("Teleport portals (headless)", () => {
  it("mounts children under the target, not the lexical parent", async () => {
    state.items = ["a", "b"]
    state.mounted = true
    const app = mountHeadless(Screen)
    await app.settle()

    const nodes = treeFromOps(app.renderer.ops)
    const root = app.container.children[0]!
    const layer = root.children[0]!
    const texts = contentTexts(nodes, layer.id!)
    expect(texts).toEqual(["a", "b"])
    const lexical = root.children[1]!
    expect(
      contentTexts(nodes, lexical.id!),
      "the lexical parent holds only the Teleport's placeholder, no portal content"
    ).toEqual([])
    app.unmount()
  })

  it("keeps key order across insertions and preserves neighbour identities", async () => {
    state.items = ["b", "c"]
    state.mounted = true
    const app = mountHeadless(Screen)
    await app.settle()
    let nodes = treeFromOps(app.renderer.ops)
    const root = app.container.children[0]!
    const layer = root.children[0]!
    const stable = new Map(
      contentEntries(nodes, layer.id!).map(([id, text]) => [text, id] as const)
    )

    state.items = ["a", "b", "c"]
    await app.settle()
    state.items = ["a", "b", "x", "c"]
    await app.settle()

    nodes = treeFromOps(app.renderer.ops)
    const order = contentTexts(nodes, layer.id!)
    expect(order).toEqual(["a", "b", "x", "c"])
    // Neighbours moved in place, not remounted: their element ids survived.
    expect(textOfSubtree(nodes, stable.get("b")!)).toBe("b")
    expect(textOfSubtree(nodes, stable.get("c")!)).toBe("c")
    app.unmount()
  })

  it("frees the portal's elements when it unmounts", async () => {
    state.items = ["a", "b"]
    state.mounted = true
    const app = mountHeadless(Screen)
    await app.settle()
    const root = app.container.children[0]!
    const layer = root.children[0]!

    state.mounted = false
    await app.settle()

    const nodes = treeFromOps(app.renderer.ops)
    expect(contentTexts(nodes, layer.id!)).toEqual([])
    const remaining = contentEntries(nodes, layer.id!).length + [...nodes.values()].filter((n) => n.text).length
    expect(remaining).toBe(0)
    app.unmount()
  })
})
