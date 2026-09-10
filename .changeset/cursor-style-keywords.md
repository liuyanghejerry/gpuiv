---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Map the full CSS cursor keyword set onto GPUI's cursor styles. `cursor` now accepts `crosshair`, `text`, `vertical-text`, `grab`, `grabbing`, `move`, `all-scroll`, `context-menu`, `not-allowed`, `no-drop`, `alias`, `copy`, `col-resize`, `row-resize`, the `ew/ns/nesw/nwse` and directional `n/e/s/w/ne/nw/se/sw` resize keywords, and `auto`/`default` — previously only `pointer` and `default` worked and every other value was silently ignored.

Keywords GPUI cannot show (`none`, `url(..)`, `wait`, `progress`, `help`, `cell`, `zoom-in`, `zoom-out`) now log a one-time dev warning instead of failing silently. The `cursor` style type is narrowed to the supported keywords in `@gpuiv/vue`. Hiding the cursor (`cursor: "none"` for brush cursors) and custom image cursors need a GPUI fork change and remain unsupported.

Part of the drawing-app gap audit (#49).
