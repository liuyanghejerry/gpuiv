/**
 * Canvas 2D rasterizer benchmark — the same headless path the WPT suite
 * uses (`GpuixCanvasRenderingContext2D` straight from the source module, a
 * stub upload renderer, no window, no GPU).
 *
 * Two phases per workload, so the pre/post Rust-core comparison stays fair:
 *
 *   record  — N mutating ops only. The TS rasterizer pays eager raster cost
 *             here; a lazy native core pays only recording. Both numbers are
 *             honest floors of their architecture.
 *   frame   — the same N ops plus a 1×1 `getImageData` that materializes the
 *             frame (forces rasterization + readback on a lazy core). This
 *             is the per-frame number the 2× gate in the migration goal is
 *             judged on.
 *
 * Usage:
 *   bun bench-canvas.ts            # human table
 *   bun bench-canvas.ts --json     # single JSON object (for baseline files)
 */

import {
  GpuixCanvasRenderingContext2D as Context2D,
  type GpuixUploadTarget,
} from "../packages/vue/src/canvas/context2d.js"

const WIDTH = 600
const HEIGHT = 400
const WARMUP_FRAMES = 20
const FRAMES = 100

type Phase = "record" | "frame"

interface Workload {
  name: string
  opsPerFrame: number
  run: (ctx: Context2D, frame: number) => void
}

function makeContext(): Context2D {
  let upload: GpuixUploadTarget = {
    id: 1,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    renderer: { uploadCanvasPixels(_id: number, _w: number, _h: number, _px: Uint8Array) {} },
  }
  const ctx = new Context2D(WIDTH, HEIGHT, () => upload)
  return ctx
}

// ── Workloads ──────────────────────────────────────────────────────────

/** The chatty-tax detector: thousands of tiny independent ops per frame. */
const chattyTinyFill: Workload = {
  name: "chatty-tiny-fill",
  opsPerFrame: 2500,
  run(ctx, frame) {
    for (let i = 0; i < 2500; i++) {
      const x = (i * 7 + frame * 3) % (WIDTH - 4)
      const y = (i * 13 + frame * 5) % (HEIGHT - 4)
      ctx.fillStyle = i % 2 ? "#c33" : "#37c"
      ctx.fillRect(x, y, 2, 2)
    }
  },
}

/** Path construction + small fills — the drawChart/drawScene shape. */
const chattyPathFill: Workload = {
  name: "chatty-path-fill",
  opsPerFrame: 2400,
  run(ctx, frame) {
    for (let i = 0; i < 200; i++) {
      ctx.beginPath()
      const base = ((i * 29 + frame * 11) % (WIDTH - 60)) + 10
      ctx.moveTo(base, 20)
      ctx.lineTo(base + 8, 40)
      ctx.quadraticCurveTo(base + 16, 60, base + 8, 80)
      ctx.bezierCurveTo(base, 100, base + 20, 120, base + 6, 140)
      ctx.closePath()
      ctx.fillStyle = i % 3 === 0 ? "#0a7" : "#333"
      ctx.fill()
    }
  },
}

/** Few ops, big areas — raster throughput, not FFI tax. */
const rasterHeavy: Workload = {
  name: "raster-heavy",
  opsPerFrame: 60,
  run(ctx, frame) {
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
    grad.addColorStop(0, "#123")
    grad.addColorStop(1, "#fed")
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = i % 2 === 0 ? grad : "#ffffff08"
      ctx.fillRect(0, ((i * 13 + frame) % HEIGHT) - 40, WIDTH, 60)
    }
  },
}

/** Dashed stroked polylines — stroke geometry cost. */
const strokeHeavy: Workload = {
  name: "stroke-heavy",
  opsPerFrame: 410,
  run(ctx, frame) {
    ctx.setLineDash([6, 4])
    for (let i = 0; i < 20; i++) {
      ctx.beginPath()
      ctx.moveTo(10, 10 + i * 19 + frame)
      for (let s = 1; s <= 20; s++) ctx.lineTo(10 + s * 28, 10 + i * 19 + ((s * 17 + frame) % 40))
      ctx.strokeStyle = i % 2 ? "#d50" : "#05d"
      ctx.lineWidth = 1 + (i % 3)
      ctx.stroke()
    }
  },
}

/** Full-canvas pixel round trips — readback bandwidth. */
const imageDataRoundtrip: Workload = {
  name: "imagedata-roundtrip",
  opsPerFrame: 20,
  run(ctx, frame) {
    const src = ctx.createImageData(WIDTH, HEIGHT)
    const px = src.data
    for (let i = 0; i < px.length; i += 4) {
      px[i] = (i + frame) & 255
      px[i + 1] = (i >> 8) & 255
      px[i + 2] = (i >> 4) & 255
      px[i + 3] = 255
    }
    ctx.putImageData(src, 0, 0)
    const back = ctx.getImageData(0, 0, WIDTH, HEIGHT)
    // Touch one byte so the read is not dead code.
    if (back.data[0] === 12345) console.log("unreachable")
  },
}

const WORKLOADS: Workload[] = [
  chattyTinyFill,
  chattyPathFill,
  rasterHeavy,
  strokeHeavy,
  imageDataRoundtrip,
]

// ── Harness ────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]!
}

function measure(workload: Workload, phase: Phase): { median: number; p95: number } {
  const ctx = makeContext()
  const samples: number[] = []
  const total = WARMUP_FRAMES + FRAMES
  for (let frame = 0; frame < total; frame++) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    const t0 = performance.now()
    workload.run(ctx, frame)
    if (phase === "frame") ctx.getImageData(0, 0, 1, 1) // materialize the frame
    const t1 = performance.now()
    if (frame >= WARMUP_FRAMES) samples.push(t1 - t0)
  }
  samples.sort((a, b) => a - b)
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95) }
}

const asJson = process.argv.includes("--json")
const results: Record<string, { opsPerFrame: number; record: { median: number; p95: number }; frame: { median: number; p95: number } }> = {}

for (const wl of WORKLOADS) {
  const record = measure(wl, "record")
  const frame = measure(wl, "frame")
  results[wl.name] = { opsPerFrame: wl.opsPerFrame, record, frame }
  if (!asJson) {
    console.log(
      `${wl.name.padEnd(22)} ops/frame ${String(wl.opsPerFrame).padStart(5)}` +
        `  record ${record.median.toFixed(2)}/${record.p95.toFixed(2)} ms` +
        `  frame ${frame.median.toFixed(2)}/${frame.p95.toFixed(2)} ms (median/p95)`,
    )
  }
}

if (asJson) {
  console.log(JSON.stringify({ canvas: [WIDTH, HEIGHT], warmup: WARMUP_FRAMES, frames: FRAMES, workloads: results }, null, 2))
}
