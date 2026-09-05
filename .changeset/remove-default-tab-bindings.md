---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Stop binding Tab and Shift+Tab to focus traversal. Both keys now reach normal element keyboard handlers and the render-level `onKeyDown` callback, so terminals and editors can process them without a capture prop.

Applications that want Tab traversal can call the direct GPUI wrappers from the render-level callback:

```tsx
const app = createApp(App, {
  onKeyDown(event) {
    if (event.key !== 'tab') return
    if (event.modifiers?.shift) app.renderer.focusPrevious?.()
    else app.renderer.focusNext?.()
  },
})
```

`createApp` and `createTestApp` accept `onKeyDown` / `onKeyUp` observers, and each mounted root owns a key-event generation so queued events from an old root cannot enter its replacement after a `bun --hot` remount.

Upstream: remorses/gpuix#36
