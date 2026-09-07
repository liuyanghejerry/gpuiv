---
'@gpuiv/native': minor
---

Add http(s) `src` support to `<img>`.

GPUI fetches the URL in the background and paints when decode finishes. The Vue tree does not wait. Pass both `width` and `height` so the box does not jump after load.

```tsx
<img
  src="https://example.com/avatar.png"
  objectFit="cover"
  style={{ width: 48, height: 48, borderRadius: 24 }}
/>
```

Filesystem paths and data URLs still work. Failed loads still show the existing fallback placeholder. A definite `width` and `height` now also pin `aspect_ratio`, keeping the layout box stable for any source.
