---
'@gpuiv/vue': patch
---

Add a macOS frosted-glass window example that combines `windowBackground: 'blurred'` with a transparent titlebar and translucent Vue surfaces (upstream `3e3249b`).

```tsx
createApp(App, {
  titlebarTransparent: true,
  windowBackground: 'blurred',
})
```

Run it with `bun run blurred-window` in `examples/`.
