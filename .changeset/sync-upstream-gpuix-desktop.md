---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Sync upstream GPUIX changes through `remorses/gpuix@367ef48` (desktop subset):

- **Pointer capture**: `onMouseMove` / `onMouseUp` keep firing after the pointer
  leaves the element that received `onMouseDown`, matching HTML
  `setPointerCapture`. Uses GPUI's native pointer capture.
- **Virtual-list windowed rows keep `estimatedItemHeight`** when Vue has not
  mounted them, so a jump past the mounted window no longer collapses the
  scrollbar. `itemCount` now requires `estimatedItemHeight` (TypeScript
  enforces it; native ignores `itemCount` without it).
- **`useWindowInsets()` hook + `getWindowInsets()`**: safe-area and
  software-keyboard geometry, sampled every 100ms by default.
- **`<markdown>` wraps in flex columns** (`min-width: 0`), fenced code scrolls
  on X like `<code>`, and `<markdown>` / `<code>` / `<diff>` record painted
  bounds so `testId` locators and `getElementBounds` work on them.
- Copy shortcuts route through the GPUI root key listener; a tap arms text
  selection instead of selecting immediately (drag promotes it).
- `zed` submodule tracks the `gpuix` branch of `remorses/zed`.
