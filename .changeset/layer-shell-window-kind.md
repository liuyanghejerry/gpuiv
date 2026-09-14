---
'@gpuiv/native': minor
'@gpuiv/vue': patch
---

Add `layerShell` and `appId` to `WindowOptions` so a window can open as a Wayland `wlr-layer-shell` surface.

`render(App, { layerShell })` opens the window as a compositor-anchored surface (bar, dock, notification overlay, wallpaper) instead of a normal floating window: no native titlebar, positioned by its `anchor` rather than by the window origin, with an optional `exclusiveZone` so tiled windows keep clear of it.

```tsx
render(Bar, {
  appId: 'my-panel',
  height: 34,
  focus: false,
  layerShell: {
    namespace: 'my-panel',
    layer: 'top',
    anchor: ['top', 'left', 'right'],
    exclusiveZone: 34,
    keyboardInteractivity: 'none',
  },
})
```

Options map to GPUI's `WindowKind::LayerShell(LayerShellOptions)`: `layer` (`background` | `bottom` | `top` | `overlay`), `anchor` (any of `top` / `bottom` / `left` / `right`; two opposite edges stretch that axis), `exclusiveZone`, `exclusiveEdge`, `margin` (`[top, right, bottom, left]`), `keyboardInteractivity` (`none` | `on-demand` | `exclusive`). Linux/Wayland only; ignored on macOS and Windows. `appId` also sets the Wayland `app_id` / X11 `WM_CLASS` on a normal window.
