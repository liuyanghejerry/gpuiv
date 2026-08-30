---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add native two-stop linear gradients to the `style.background` API (upstream `09e0cae`).

```tsx
<div
  style={{
    background: {
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { color: '#7c3aed', position: 0 },
        { color: '#06b6d4', position: 1 },
      ],
      colorSpace: 'oklab',
    },
  }}
/>
```

Gradients use GPUI's GPU shaders on every renderer. They support CSS angle
direction, rounded corners, `srgb` or `oklab` interpolation, and native
`hover` and `active` styles. A transparent gradient does not block the mouse,
matching a transparent color.
