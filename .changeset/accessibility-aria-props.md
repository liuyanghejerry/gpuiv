---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Expose GPUI accessibility through Vue `role` and `aria-*` props.

A node is in the platform accessibility tree only with both a GPUI id (already set) and a role. VoiceOver, Accessibility Inspector, and other AX clients can now see labelled controls instead of an empty window.

```tsx
<div
  role="button"
  aria-label="Delete note"
  aria-id="notes.delete"
  onClick={remove}
>
  Delete
</div>
```

- Prop names match the DOM: `aria-label`, not `ariaLabel`
- Role values are ARIA tokens (`"button"`, `"heading"`). `"none"` / `"presentation"` produce no node
- `<text>` defaults to `Label`, `<input>` to `TextInput`, `<textarea>` to `MultilineTextInput`, `<img>` to `Image` with `alt`
- `onClick` registers AccessKit Click, so VoiceOver Press fires the same JS handler
- `<virtual-list>` and `<anchored>` accept `role` / `aria-*` too
- `renderer.getA11yTree()` on the test renderer dumps the tree for tests
