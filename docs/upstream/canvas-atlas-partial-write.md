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

## Related gpuiv-side follow-ups (no fork needed, mid-term)

- Canvas memory is unchanged at ~12B/px per context (premul 4 + coverage 8);
  PR #66's full-frame BGRA mirror replaced the retained whole-frame copy.
- Rasterization-buffer tiling and GPU rasterization remain the mid-term path
  (issue #49 P0-2's "中期" scope).

## Revisit triggers

- The fork grows a true sub-rect write (bytes per dirty rect, not per
  tile) → splice only the dirty rows into the atlas write.
- Canvas workloads show the full-tile rewrite dominating (frequent
  sub-tile-size dabs) → revisit tile granularity.
