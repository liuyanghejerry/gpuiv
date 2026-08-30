/// Serialization benchmark for the applyBatch mutation queue.
///
/// Captures the REAL op queue that `ChatApp` produces through the real Vue
/// host config, then measures every candidate wire format on it. Nothing here
/// is synthetic: `captureOps()` installs a stub NativeRenderer that owns
/// `applyBatch`, so `wrapWithBatching` hands it the exact tuples production
/// sends.
///
/// It also writes `tmp/batch-fixture.json`, which the Rust half of the bench
/// (`packages/native/examples/bench_serde.rs`) reads. Both sides must measure
/// the same bytes or the comparison is meaningless.
///
///   ChatApp ► Vue host config ► wrapWithBatching ► CaptureRenderer.applyBatch(json)
///                                                       │
///                                                       ▼
///                                               op tuples (ground truth)
///                                                 │            │
///                                      JS codec bench     tmp/batch-fixture.json ► Rust
///
/// Run:  bun bench-serialization.ts            (default 2000 turns)
///       TURNS=10000 bun bench-serialization.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createGpuivRendererHost, GPUIV_CONTEXT } from '@gpuiv/vue'
import type { NativeRenderer } from '@gpuiv/vue'
import { Packr } from 'msgpackr'
import { Encoder as CborEncoder } from 'cbor-x'
import { ChatApp } from './chat'

type Op = unknown[]

// ── Capture ──────────────────────────────────────────────────────────
//
// The renderer contract is one atomic batch per commit.

class CaptureRenderer implements NativeRenderer {
  ops: Op[] = []

  applyBatch(json: string): number[] {
    for (const op of JSON.parse(json) as Op[]) this.ops.push(op)
    return []
  }
  getWindowSize(): { width: number; height: number } {
    return { width: 1280, height: 800 }
  }
}

function captureOps(props: { turnCount: number; includeSafeMdx: boolean }): Op[] {
  const capture = new CaptureRenderer()
  const host = createGpuivRendererHost(capture, { nextElementId: 0 })
  const app = host.vue.createApp(ChatApp, props)
  app.provide(GPUIV_CONTEXT, { renderer: capture })
  app.mount(host.container)
  // No Vue scheduler job runs for the initial mount — drain synchronously.
  host.flushMutations()
  host.detach()
  return capture.ops
}

// ── Fixture shape ────────────────────────────────────────────────────

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

interface Shape {
  total: number
  byOp: Map<string, { count: number; bytes: number }>
  uniqueStyles: number
  styleOps: number
  styleBytes: number
  uniqueStrings: number
  totalStrings: number
  stringBytes: number
  uniqueStringBytes: number
}

function describe(ops: Op[]): Shape {
  const byOp = new Map<string, { count: number; bytes: number }>()
  const styles = new Set<string>()
  const strings = new Map<string, number>()
  let styleOps = 0
  let styleBytes = 0
  let stringBytes = 0

  const walkStrings = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.set(value, (strings.get(value) ?? 0) + 1)
      stringBytes += Buffer.byteLength(value)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const inner of Object.values(value as Record<string, unknown>)) walkStrings(inner)
    if (!Array.isArray(value)) for (const key of Object.keys(value)) walkStrings(key)
  }

  for (const op of ops) {
    const name = String(op[0])
    const bytes = Buffer.byteLength(JSON.stringify(op))
    const slot = byOp.get(name) ?? { count: 0, bytes: 0 }
    slot.count += 1
    slot.bytes += bytes
    byOp.set(name, slot)

    if (name === 'setStyle') {
      styleOps += 1
      styleBytes += bytes
      styles.add(canonical(op[2]))
    }
    for (const arg of op.slice(1)) walkStrings(arg)
  }

  let uniqueStringBytes = 0
  for (const key of strings.keys()) uniqueStringBytes += Buffer.byteLength(key)

  return {
    total: ops.length,
    byOp,
    uniqueStyles: styles.size,
    styleOps,
    styleBytes,
    uniqueStrings: strings.size,
    totalStrings: [...strings.values()].reduce((a, b) => a + b, 0),
    stringBytes,
    uniqueStringBytes,
  }
}

// ── Protocol variants ────────────────────────────────────────────────
//
// These are NOT codecs. They change what JS sends, which is the only lever
// that can beat a codec by an order of magnitude. `internStyles` replaces a
// repeated ~1.2 KB style object with a 4-byte id; `internAll` also interns
// every repeated string value, which is what no mainstream JS↔Rust codec
// does for you.

function internStyles(ops: Op[]): Op[] {
  const ids = new Map<string, number>()
  const out: Op[] = []
  for (const op of ops) {
    if (op[0] !== 'setStyle') {
      out.push(op)
      continue
    }
    const key = canonical(op[2])
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      out.push(['defineStyle', id, op[2]])
    }
    out.push(['setStyleRef', op[1], id])
  }
  return out
}

function internAll(ops: Op[]): Op[] {
  const styled = internStyles(ops)
  const ids = new Map<string, number>()
  const table: string[] = []
  // Only intern strings that repeat AND are short enough that a 4-byte ref is
  // a real win. A 3 KB markdown source that appears twice is better sent raw
  // than pinned in a table the decoder must keep alive.
  const counts = new Map<string, number>()
  const count = (value: unknown): void => {
    if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1)
    else if (value && typeof value === 'object')
      for (const inner of Object.values(value as Record<string, unknown>)) count(inner)
  }
  for (const op of styled) for (const arg of op.slice(1)) count(arg)

  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if ((counts.get(value) ?? 0) < 2) return value
      let id = ids.get(value)
      if (id === undefined) {
        id = table.length
        ids.set(value, id)
        table.push(value)
      }
      return { $: id }
    }
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(swap)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = swap(v)
    return out
  }

  const body = styled.map((op) => [op[0], ...op.slice(1).map(swap)])
  return [['strings', table], ...body]
}

// ── Codecs ───────────────────────────────────────────────────────────

const packr = new Packr({ useRecords: false })
const packrRecords = new Packr({ useRecords: true, bundleStrings: false })
const cbor = new CborEncoder({ useRecords: false })

interface Codec {
  name: string
  encode(ops: Op[]): Uint8Array | string
  decode(payload: Uint8Array | string): unknown
}

const CODECS: Codec[] = [
  {
    name: 'JSON.stringify',
    encode: (ops) => JSON.stringify(ops),
    decode: (p) => JSON.parse(p as string),
  },
  {
    name: 'JSON ► utf8 Buffer',
    encode: (ops) => Buffer.from(JSON.stringify(ops), 'utf8'),
    decode: (p) => JSON.parse(Buffer.from(p as Uint8Array).toString('utf8')),
  },
  { name: 'msgpackr', encode: (ops) => packr.pack(ops), decode: (p) => packr.unpack(p as Uint8Array) },
  {
    name: 'msgpackr records',
    encode: (ops) => packrRecords.pack(ops),
    decode: (p) => packrRecords.unpack(p as Uint8Array),
  },
  { name: 'cbor-x', encode: (ops) => cbor.encode(ops), decode: (p) => cbor.decode(p as Uint8Array) },
]

// ── Measurement ──────────────────────────────────────────────────────

function byteLength(payload: Uint8Array | string): number {
  return typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/// Bytes the encoded payload occupies while it is alive.
///
/// Computed, not sampled. `process.memoryUsage().heapUsed` only moves at
/// collection time in JSC, so a GC-bracketed measurement of the same payload
/// came back with values from -0.3 MB to 24 MB for the same 8 MB buffer. Do not
/// put that measurement back.
///
/// The rule this exposes: JSC stores a string as latin1 when every code unit
/// fits in a byte, and as UTF-16 otherwise. The chat payload contains
/// box-drawing characters, so `JSON.stringify` costs 2 bytes of JS heap per
/// wire byte. Encoding into a Buffer costs one, and lives outside the JS heap.
function residentBytes(payload: Uint8Array | string): number {
  if (typeof payload !== 'string') return payload.byteLength
  for (let i = 0; i < payload.length; i++) {
    if (payload.charCodeAt(i) > 0xff) return payload.length * 2
  }
  return payload.length
}

interface Row {
  codec: string
  encodeMs: number
  decodeMs: number
  bytes: number
  retainedMb: number
}

function bench(ops: Op[], iterations: number): Row[] {
  const rows: Row[] = []
  for (const codec of CODECS) {
    for (let i = 0; i < 3; i++) codec.decode(codec.encode(ops))

    const encodes: number[] = []
    const decodes: number[] = []
    let bytes = 0
    let resident = 0
    for (let i = 0; i < iterations; i++) {
      const encodeStart = performance.now()
      const payload = codec.encode(ops)
      encodes.push(performance.now() - encodeStart)
      bytes = byteLength(payload)
      resident = residentBytes(payload)

      const decodeStart = performance.now()
      codec.decode(payload)
      decodes.push(performance.now() - decodeStart)
    }
    rows.push({
      codec: codec.name,
      encodeMs: median(encodes),
      decodeMs: median(decodes),
      bytes,
      retainedMb: resident / 1e6,
    })
  }
  return rows
}

function table(rows: Row[], baselineBytes: number): string {
  const head = '| codec | encode | decode | wire bytes | vs JSON | resident while alive |'
  const sep = '|---|---:|---:|---:|---:|---:|'
  const body = rows.map(
    (r) =>
      `| ${r.codec} | ${r.encodeMs.toFixed(2)} ms | ${r.decodeMs.toFixed(2)} ms |` +
      ` ${(r.bytes / 1e6).toFixed(2)} MB | ${(r.bytes / baselineBytes).toFixed(2)}x |` +
      ` ${r.retainedMb.toFixed(1)} MB |`,
  )
  return [head, sep, ...body].join('\n')
}

// ── The honest cost of interning in JS ───────────────────────────────
//
// The `protocol A` and `protocol B` tables above are a lie about JS time:
// `internStyles(ops)` runs once, outside the timed region, so they price a
// queue that arrived pre-interned. Production cannot do that. The host config
// has to work out a style's identity at `setStyle` time.
//
// Reference equality does not work. The patch always resends the next style
// prop, and a JSX `style={{…}}` literal is a fresh object every render, so a
// `WeakMap` misses on everything except hoisted constants. That leaves a
// content hash, and the cheapest content hash of a JS object is
// `JSON.stringify`. So the same characters get serialized either way;
// interning just moves the work into tens of thousands of small calls plus a
// Map probe each.
//
// This measures that. Interning inside the timed region, against plain
// stringify of the same queue.

function encodeWithInlineInterning(ops: Op[]): string {
  const ids = new Map<string, number>()
  const out: Op[] = []
  for (const op of ops) {
    if (op[0] !== 'setStyle') {
      out.push(op)
      continue
    }
    const key = JSON.stringify(op[2])
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
      out.push(['defineStyle', id, op[2]])
    }
    out.push(['setStyleRef', op[1], id])
  }
  return JSON.stringify(out)
}

function benchInterningCost(ops: Op[], iterations: number): string {
  const plain: number[] = []
  const interned: number[] = []
  for (let i = 0; i < 3; i++) {
    JSON.stringify(ops)
    encodeWithInlineInterning(ops)
  }
  let plainBytes = 0
  let internedBytes = 0
  for (let i = 0; i < iterations; i++) {
    let start = performance.now()
    plainBytes = Buffer.byteLength(JSON.stringify(ops))
    plain.push(performance.now() - start)

    start = performance.now()
    internedBytes = Buffer.byteLength(encodeWithInlineInterning(ops))
    interned.push(performance.now() - start)
  }
  return [
    '| path | JS time | wire bytes |',
    '|---|---:|---:|',
    `| \`JSON.stringify(queue)\` today | ${median(plain).toFixed(2)} ms | ${(plainBytes / 1e6).toFixed(2)} MB |`,
    `| intern inside the encode, then stringify | ${median(interned).toFixed(2)} ms | ${(internedBytes / 1e6).toFixed(2)} MB |`,
  ].join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────

const turns = Number(process.env.TURNS ?? 2_000)
const iterations = Number(process.env.ITERATIONS ?? 9)
const safeMdx = process.env.SAFE_MDX === '1'

console.log(`capturing ChatApp turnCount=${turns} safeMdx=${safeMdx} …`)
const captureStart = performance.now()
const ops = captureOps({ turnCount: turns, includeSafeMdx: safeMdx })
console.log(
  `captured ${ops.length.toLocaleString()} ops in ${(performance.now() - captureStart).toFixed(0)}ms` +
    ` (${(ops.length / turns).toFixed(1)} ops per turn)\n`,
)

const shape = describe(ops)
console.log('## Fixture shape\n')
console.log('| op | count | JSON bytes | share |')
console.log('|---|---:|---:|---:|')
const totalBytes = [...shape.byOp.values()].reduce((a, b) => a + b.bytes, 0)
for (const [name, slot] of [...shape.byOp].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(
    `| ${name} | ${slot.count.toLocaleString()} | ${(slot.bytes / 1e6).toFixed(2)} MB |` +
      ` ${((slot.bytes / totalBytes) * 100).toFixed(1)}% |`,
  )
}
console.log()
console.log(
  `unique styles: ${shape.uniqueStyles.toLocaleString()} of ${shape.styleOps.toLocaleString()} setStyle ops` +
    ` (${(shape.styleBytes / 1e6).toFixed(2)} MB, ${((shape.styleBytes / totalBytes) * 100).toFixed(1)}% of payload)`,
)
console.log(
  `unique strings: ${shape.uniqueStrings.toLocaleString()} of ${shape.totalStrings.toLocaleString()} occurrences` +
    ` — ${(shape.stringBytes / 1e6).toFixed(2)} MB raw vs ${(shape.uniqueStringBytes / 1e6).toFixed(2)} MB deduped`,
)
console.log()

const variants: Array<{ label: string; ops: Op[] }> = [
  { label: 'today — full style object per element', ops },
  { label: 'protocol A — interned styles (setStyleRef)', ops: internStyles(ops) },
  { label: 'protocol B — interned styles + string table', ops: internAll(ops) },
]

const baseline = Buffer.byteLength(JSON.stringify(ops))
for (const variant of variants) {
  console.log(`## ${variant.label}\n`)
  console.log(`ops: ${variant.ops.length.toLocaleString()}`)
  console.log(table(bench(variant.ops, iterations), baseline))
  console.log()
}

console.log('## What interning actually costs JS\n')
console.log(benchInterningCost(ops, iterations))
console.log()

const fixturePath = resolve(import.meta.dir, '../tmp/batch-fixture.json')
mkdirSync(dirname(fixturePath), { recursive: true })
writeFileSync(fixturePath, JSON.stringify(ops))
writeFileSync(
  resolve(import.meta.dir, '../tmp/batch-fixture-interned.json'),
  JSON.stringify(internStyles(ops)),
)
console.log(`wrote ${fixturePath}`)
console.log('next: cargo run --release --example bench_serde  (in packages/native)')

// Exit explicitly — nothing here needs the process to stay alive.
process.exit(0)
