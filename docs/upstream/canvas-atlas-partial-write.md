# Canvas atlas sub-rect writes (and the canvas memory follow-ups)

Topic: what it would take to update only the dirty region of an uploaded
canvas texture in place instead of re-allocating atlas tiles, plus the
gpuiv-side canvas memory work deliberately deferred alongside it.

**Status:** researched; workaround shipped. Not a `remorses/gpuix` topic — the
blocking API lives in the zed submodule. Recorded 2026-09-10 while closing
issue #49 P0-2; PR #66 ships the 256×256 tile-grid workaround (single-stroke
upload 22.1MB → 426KB, idle frames 0 bytes) and documents the fork ask in its
body.

## Local facts (zed fork at the current pin)

| Item | Fact | Where |
|---|---|---|
| `PlatformAtlas` trait | Only `get_or_insert_with` / `remove` / `contains` — **no sub-rect update on an existing tile** | `zed/crates/gpui/src/scene.rs` |
| Atlas caching | Tiles are cached per `RenderImage::id` (monotonic counter) and frame data is private — any byte change must take a new id → new tile → full upload of that image's bytes | same area |
| Sub-rect upload exists, unexposed | `MetalAtlasTexture::upload` internally supports a sub-rectangle `replace_region` | `gpui_apple` atlas code |

## Proposed fork change (in `remorses/zed`, then bump the submodule)

Extend `PlatformAtlas` with a sub-rect write on an existing tile, e.g.

```rust
fn write_tile_region(
    &self,
    key: &AtlasKey,
    region: Bounds<DevicePixels>,
    bytes: &[u8],
    stride: u64,
)
```

mapping to `replace_region` on Metal and `queue.write_texture` on wgpu, plus
a way to keep a stable `ImageId` per canvas surface. That would drop the
per-tile re-allocation and the 1px border duplication the tile-grid
workaround pays.

## Related gpuiv-side follow-ups (no fork needed, mid-term)

- Canvas memory is unchanged at ~12B/px per context (premul 4 + coverage 8);
  PR #66's full-frame BGRA mirror replaced the retained whole-frame copy.
- Rasterization-buffer tiling and GPU rasterization remain the mid-term path
  (issue #49 P0-2's "中期" scope).

## Revisit triggers

- The fork grows the sub-rect write API → drop per-tile re-allocation and the
  tile borders.
- Canvas workloads show tile re-allocation/border cost dominating → prioritize
  the fork PR.
