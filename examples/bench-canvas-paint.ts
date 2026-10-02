/** Large layered painting benchmark. Run with a release native build:
 *   bun examples/bench-canvas-paint.ts --output tmp/canvas-paint-before.json
 *   bun examples/bench-canvas-paint.ts --output tmp/canvas-paint-after.json --compare tmp/canvas-paint-before.json
 * Each case runs in a fresh process so native/GPU allocations do not carry
 * over. Timings split recording, CPU rasterization, mirror/tile preparation
 * and GPUI flush (CPU submission, not completed GPU execution).
 */
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, cpus } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { GpuixCanvas2DCore, TestGpuixRenderer } from "@gpuiv/native"

const WIDTH = 2880
const HEIGHT = 1920
const VIEW_WIDTH = 960
const VIEW_HEIGHT = 640
const DABS = 8
const WARMUP = 6
const FRAMES = 24
type Pattern = "continuous" | "scattered"

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  }
}

function measure(pattern: Pattern, dpr: number, layers: number) {
  const rssBefore = process.memoryUsage().rss
  const renderer = new TestGpuixRenderer(VIEW_WIDTH, VIEW_HEIGHT)
  const ops: unknown[][] = [
    ["createElement", 1, "div"],
    ["setStyle", 1, { width: VIEW_WIDTH, height: VIEW_HEIGHT, backgroundColor: "#ffffff" }],
    ["setRoot", 1],
  ]
  const cores = Array.from({ length: layers }, (_, layer) => {
    const id = layer + 2
    ops.push(
      ["createElement", id, "canvas"],
      ["setStyle", id, { position: "absolute", left: 0, top: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT }],
      ["appendChild", 1, id],
    )
    return new GpuixCanvas2DCore(WIDTH * dpr, HEIGHT * dpr)
  })
  renderer.applyBatch(JSON.stringify(ops))
  for (const [layer, core] of cores.entries()) {
    core.setTransform(dpr, 0, 0, dpr, 0, 0)
    core.setFillRgba(230, 230, 230, 0.1)
    core.fillRect(0, 0, WIDTH, HEIGHT)
    renderer.uploadCanvasFromContext(layer + 2, core)
  }
  renderer.flush()
  const rssReady = process.memoryUsage().rss
  let rssPeak = rssReady
  const samples = { record: [] as number[], raster: [] as number[], upload: [] as number[], paint: [] as number[], frame: [] as number[], tileBytes: [] as number[] }
  for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
    const startBytes = renderer.canvasUploadedBytes()
    const t0 = performance.now()
    for (const [layer, core] of cores.entries()) {
      core.setFillRgba(layer % 2 ? 60 : 220, 80, layer % 2 ? 220 : 60, 0.35)
      for (let dab = 0; dab < DABS; dab++) {
        const far = pattern === "scattered" && dab >= DABS / 2
        const step = (frame * 3 + dab * 4) % 48
        const x = far ? WIDTH - 160 - step : 160 + step
        const y = far ? HEIGHT - 160 - step : 160 + step
        core.beginPath()
        core.arc(x, y, 8, 0, Math.PI * 2, false)
        core.fill("nonzero")
      }
    }
    const t1 = performance.now()
    // Materialize without a whole-canvas JS readback.
    for (const core of cores) core.getImageData(0, 0, 1, 1)
    const t2 = performance.now()
    for (const [layer, core] of cores.entries()) renderer.uploadCanvasFromContext(layer + 2, core)
    const t3 = performance.now()
    renderer.flush()
    const t4 = performance.now()
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss)
    if (frame >= WARMUP) {
      samples.record.push(t1 - t0)
      samples.raster.push(t2 - t1)
      samples.upload.push(t3 - t2)
      samples.paint.push(t4 - t3)
      samples.frame.push(t4 - t0)
      samples.tileBytes.push(renderer.canvasUploadedBytes() - startBytes)
    }
  }
  // Untimed, full pixel checksums catch rendering differences across runs.
  const pixels = cores.map(core => createHash("sha256").update(core.getImageData(0, 0, WIDTH * dpr, HEIGHT * dpr)).digest("hex"))
  return {
    pattern, dpr, layers,
    timingsMs: Object.fromEntries(["record", "raster", "upload", "paint", "frame"].map(key => [key, summary(samples[key as keyof typeof samples])])),
    tileBytes: summary(samples.tileBytes),
    rssBytes: { before: rssBefore, ready: rssReady, peak: rssPeak },
    pixels,
  }
}

const output = option("--output")
const compare = option("--compare")
if (!output) throw new Error("Pass --output <path> for the benchmark JSON")
const selected = option("--case")
if (selected) {
  const [pattern, dpr, layers] = selected.split(":")
  if (!["continuous", "scattered"].includes(pattern!) || !["1", "2"].includes(dpr!) || !["1", "3"].includes(layers!)) throw new Error(`Invalid case: ${selected}`)
  writeFileSync(output, JSON.stringify(measure(pattern as Pattern, Number(dpr), Number(layers))))
} else {
  const directory = mkdtempSync(join(tmpdir(), "gpuiv-canvas-paint-"))
  const cases: ReturnType<typeof measure>[] = []
  try {
    for (const dpr of [1, 2]) for (const layers of [1, 3]) for (const pattern of ["continuous", "scattered"] as const) {
      const name = `${pattern}:${dpr}:${layers}`
      const file = join(directory, `${pattern}-dpr${dpr}-layers${layers}.json`)
      const child = spawnSync(process.execPath, [import.meta.filename, "--case", name, "--output", file], { encoding: "utf8", env: { ...process.env, GPUIX_BACKGROUND: "1" } })
      if (child.status !== 0) throw new Error(`${name}: ${child.stderr}\n${child.stdout}`)
      const result: ReturnType<typeof measure> = JSON.parse(readFileSync(file, "utf8"))
      cases.push(result)
      console.log(`${name.padEnd(16)} frame p95 ${result.timingsMs.frame!.p95.toFixed(2)} ms; raster ${result.timingsMs.raster!.p95.toFixed(2)}; upload ${result.timingsMs.upload!.p95.toFixed(2)}; tiles ${(result.tileBytes.median / 1048576).toFixed(2)} MiB; RSS ${(result.rssBytes.peak / 1048576).toFixed(0)} MiB`)
    }
    if (compare) {
      const baseline = JSON.parse(readFileSync(compare, "utf8")) as { cases: ReturnType<typeof measure>[] }
      for (const result of cases) {
        const previous = baseline.cases.find(item => item.pattern === result.pattern && item.dpr === result.dpr && item.layers === result.layers)
        if (!previous || JSON.stringify(previous.pixels) !== JSON.stringify(result.pixels)) throw new Error(`Pixel checksum mismatch: ${result.pattern}:${result.dpr}:${result.layers}`)
      }
      console.log("All pixel checksums match the baseline.")
    }
    writeFileSync(resolve(output), JSON.stringify({ logicalSize: [WIDTH, HEIGHT], viewport: [VIEW_WIDTH, VIEW_HEIGHT], dabsPerLayer: DABS, warmup: WARMUP, frames: FRAMES, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cases }, null, 2) + "\n")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
