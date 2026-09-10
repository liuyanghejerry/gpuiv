# Canvas element transform (scale / rotate)

Topic: what it would take for a `<canvas>` to paint under an element-level
transform (zoom / rotation for the drawing client), and the state of that
support in the zed submodule (`remorses/zed`, `gpuix` branch).

**Status:** researched, not implemented. This is not a `remorses/gpuix` topic —
it lives in the zed submodule. Investigated 2026-09-10 while closing issue #49
P0-4; the pinch half shipped in PR #63, this half is blocked on the fork change
below (full findings in that PR's body).

## Local facts (zed fork at the current pin)

| Item | Fact | Where |
|---|---|---|
| `PolychromeSprite` | The primitive `<canvas>` paints through (`gpui::img` → `Window::paint_image`) has **no `transformation` field**, and `Window::paint_image` takes no transformation parameter | `zed/crates/gpui/src/scene.rs` |
| `TransformationMatrix` | Exists and is applied by the rasterizers only for `MonochromeSprite` / `SubpixelSprite` (text / SVG): `gpui_apple/src/shaders.metal` applies it via `to_device_position_transformed`; `Window::paint_svg` threads a matrix but carries an alpha mask only — it cannot carry a color canvas | `scene.rs`, `gpui_apple/src/shaders.metal` |
| Today's options | Scale by re-styling the box (texture stretch — blurry) or re-rasterize under a new CTM (CPU-expensive). **Rotation has no path at all.** | — |

## Proposed fork change (in `remorses/zed`, then bump the submodule)

1. Add `transformation: TransformationMatrix` to `PolychromeSprite` (unit by
   default in every constructor).
2. Thread a transformation through `Window::paint_image` (extra param or a
   `paint_image_with_transformation` variant).
3. Apply it in the Metal shader path where `MonochromeSprite.transformation`
   is already applied, and in the WGSL paths (`gpui_wgpu/src/shaders*.wgsl`)
   used by Windows/Linux/web.

Once the fork carries it, gpuiv's canvas paint path passes a
`TransformationMatrix::unit().scale(..).rotate(..)` built from a
canvas-specific `transform: { scale, rotate }` custom prop — deliberately
**not** a general `StyleDesc.transform` (issue #49 scoping).

## Revisit triggers

- The fork change above lands → bump the submodule and wire the canvas prop.
- A general element-transform design starts in zed upstream → reconsider the
  scoping before growing a gpuiv-private transform.
