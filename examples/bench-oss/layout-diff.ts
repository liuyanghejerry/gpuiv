/**
 * Compare two layout snapshots from layout-snapshot.ts.
 *   bun bench-oss/layout-diff.ts <app> [beforeTag] [afterTag]
 *
 * Nodes are matched by tree position (child-index path), not by element id:
 * ids come from a JS counter, and timer-mounted components can allocate them
 * in a different order between runs. Reports nodes whose type, text, or
 * bounds (> 0.5px) differ, and painted-text log differences.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const [app = "bench", a = "before", b = "after"] = process.argv.slice(2)
const dir = resolve(import.meta.dirname, "../../tmp/layout-snap")
const load = (tag: string) => JSON.parse(readFileSync(resolve(dir, `${app}-${tag}.json`), "utf8"))
type Bounds = { x: number; y: number; width: number; height: number }
type Node = { type: string; id: number; text?: string; bounds?: Bounds; children?: Node[] }

const flatten = (root: Node) => {
  const out = new Map<string, Node>()
  const walk = (n: Node, path: string) => {
    out.set(path, n)
    n.children?.forEach((c, i) => walk(c, `${path}/${i}`))
  }
  walk(root, "")
  return out
}
const sameBounds = (x?: Bounds, y?: Bounds) =>
  !x || !y ? !x === !y : (["x", "y", "width", "height"] as const).every((k) => Math.abs(x[k] - y[k]) <= 0.5)

const A = load(a), B = load(b)
const fa = flatten(A.tree), fb = flatten(B.tree)
const report: string[] = []
for (const path of new Set([...fa.keys(), ...fb.keys()])) {
  const na = fa.get(path), nb = fb.get(path)
  if (!na || !nb) { report.push(`${na ? "-" : "+"} ${path} ${(na ?? nb)!.type}`); continue }
  if (na.type !== nb.type || na.text !== nb.text || !sameBounds(na.bounds, nb.bounds)) {
    report.push(`~ ${path} ${na.type}${na.text ? ` "${na.text.slice(0, 30)}"` : ""}: ${JSON.stringify(na.bounds)} -> ${nb.type} ${JSON.stringify(nb.bounds)}`)
  }
}
const samePainted = JSON.stringify(A.painted) === JSON.stringify(B.painted)
console.log(`${app}: ${fa.size} vs ${fb.size} nodes, ${report.length} differ, painted text ${samePainted ? "identical" : `DIFFERS (${A.painted.length} vs ${B.painted.length})`}, stable ${A.stable}/${B.stable}`)
for (const line of report.slice(0, 25)) console.log("  " + line)
process.exit(report.length === 0 && samePainted ? 0 : 1)
