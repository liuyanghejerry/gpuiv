# Canvas atlas sub-rect writes (and the canvas memory follow-ups)

Topic: what it would take to update only the dirty region of an uploaded
canvas texture in place instead of re-allocating atlas tiles, plus the
gpuiv-side canvas memory work deliberately deferred alongside it.

**Status:** in-place updates adopted (2026-09-27). The zed fork grew
`Window::update_image` (commit `dbbe13dffc`, "support in-place image
updates": stable atlas uploads across Metal, WGPU, DirectX), and gpuiv's
canvas now keeps a stable `RenderImage::id` per 256×256 tile and rewrites
the existing atlas allocation on every content flush — no per-flush tile
re-allocation, no `drop_image` round-trip while a stroke repaints. The
per-write granularity is still the whole tile (the `PlatformAtlas::update`
API writes a full tile's bytes); only a resize re-allocates. The 1px tile
border remains by design (linear-filter bleed between atlas regions).
PR #66's tile-grid workaround is otherwise unchanged.

## Local facts (zed fork, since `dbbe13dffc`)

| Item | Fact | Where |
|---|---|---|
| `PlatformAtlas::update` | Rewrites an existing tile's bytes in place when the size matches (`replace_region` on Metal, `write_texture` on wgpu/DirectX); remove + re-insert otherwise | `zed/crates/gpui/src/platform.rs` |
| `Window::update_image` | Applies new bytes to the atlas tile keyed by `RenderImage::id`; the id is a public field, so callers keep it stable across content changes | `zed/crates/gpui/src/window.rs`, `assets.rs` |
| Stable id per canvas tile | gpuiv's `CanvasSurface` inherits each tile's previous id on rebuild and queues the image for `update_image` at the tile's next paint | `packages/native/src/canvas.rs` |
| Write granularity | One full tile (plus its 1px border) per dirty flush — `update` has no sub-rect form yet | `PlatformAtlas::update` |

## GPUIV painting follow-ups (2026-10-01, no GPUI fork change)

- Clear only the previous operation's antialiasing coverage bounds before
  the next fill, stroke, clear, image draw or clip. Keep the existing `f64`
  precision and rasterization algorithm.
- Track pending pixel bounds per upload tile instead of unioning distant
  operations into one rectangle. Convert only those bounds to the BGRA
  mirror and rebuild each affected tile once per flush.
- Refresh adjacent tiles when their 1px sampling border reads a changed
  pixel, including diagonal neighbors. Full invalidations (`copy`, reset
  and resize) still update every tile.

### Painting benchmark

`examples/bench-canvas-paint.ts` uses a fresh process for each case, a
2880×1920 logical canvas, DPR 1/2, one/three layers, and eight translucent
round brush dabs per layer per frame. Continuous strokes stay near one
corner; scattered strokes touch opposite corners in the same flush.
Initialize and upload every layer before six warmup frames and 24 measured
frames. The offscreen GPU viewport is 960×640, showing all layers scaled
to fit. Run against a release native build:

```sh
bun examples/bench-canvas-paint.ts --output tmp/canvas-paint-before.json
# Rebuild the native addon after changing the renderer.
bun examples/bench-canvas-paint.ts --output tmp/canvas-paint-after.json --compare tmp/canvas-paint-before.json
```

The JSON separates recording, CPU rasterization, mirror/tile preparation,
GPUI flush and total frame time (median/p95), records process RSS at frame
boundaries, and hashes each layer's full pixel buffer outside the timing
loop. `--compare` rejects mismatched pixel checksums. GPUI flush measures
CPU submission, not completed GPU execution or interactive presentation
latency. Tile bytes include the sampling borders and describe image bytes
prepared for the atlas, rather than a hardware bandwidth measurement.

Measured on Apple M3 Pro, macOS arm64, 2026-10-01. Baseline native sources:
`3f526fe`; after: the local coverage and dirty-tile changes described above.

| Workload | DPR | Layers | Frame p95 before → after (ms) | Tile bytes/frame before → after (MiB, median) |
|---|---|---|---|---|
| Continuous | 1 | 1 | 4.08 → 0.35 | 0.25 → 0.25 |
| Scattered | 1 | 1 | 23.17 → 0.45 | 19.55 → 0.51 |
| Continuous | 1 | 3 | 11.17 → 1.32 | 0.76 → 0.76 |
| Scattered | 1 | 3 | 75.88 → 1.73 | 58.66 → 1.52 |
| Continuous | 2 | 1 | 12.63 → 0.76 | 0.25 → 0.25 |
| Scattered | 2 | 1 | 92.55 → 0.99 | 69.32 → 0.76 |
| Continuous | 2 | 3 | 38.69 → 4.62 | 0.76 → 0.76 |
| Scattered | 2 | 3 | 273.06 → 4.92 | 207.96 → 2.29 |

All eight cases keep identical full-buffer pixel checksums. The
coverage-only intermediate run reduces DPR 2, three-layer continuous
raster p95 from 35.06 to 0.51 ms; scattered uploads remain 207.96 MiB
until dirty tiles are tracked separately. These timings are observations
on this machine. Regression tests assert pixel results and tile byte
counts, rather than these machine-specific wall-clock thresholds.

## Remaining GPUIV memory work (no fork needed, mid-term)

- Canvas memory is unchanged at ~12B/px per context (premul 4 + coverage 8);
  PR #66's full-frame BGRA mirror replaced the retained whole-frame copy.
- Rasterization-buffer tiling and GPU rasterization remain the mid-term path
  (issue #49 P0-2's "中期" scope).

## Revisit triggers

- The fork grows a true sub-rect write (bytes per dirty rect, not per
  tile) → splice only the dirty rows into the atlas write.
- Canvas workloads show the full-tile rewrite dominating (frequent
  sub-tile-size dabs) → revisit tile granularity.
