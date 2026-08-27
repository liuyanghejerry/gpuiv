---
'@gpuiv/vue': patch
---

`useWindowSize()` now samples the window every **100 ms** instead of reading it once on mount, so a resized or late-opening window no longer reports a stale size forever.

The old hook seeded state with a hardcoded `800x600` and read the renderer a single time from an effect. Two failures came out of that:

- the first read can land **before** the platform window has a size, so the hook kept `800x600` for the whole life of the app
- a **window resize** was never observed at all

Both matter for code that converts a mouse position into layout coordinates. A stale height silently points at the wrong row.

```ts
useWindowSize()                      // 100ms, the default
useWindowSize({ intervalMs: 250 })   // slower
useWindowSize({ intervalMs: false }) // read once, never poll
```

State is seeded from the renderer during setup, and the ref only updates when the width or height actually changes, so a drag-resize cannot flood Vue with renders. This mirrors what `useWindowInsets()` already does; the two hooks now share the same pull-based shape and the same `intervalMs` option.
