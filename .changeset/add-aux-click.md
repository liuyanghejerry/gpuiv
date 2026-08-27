---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add `onAuxClick` for the non-primary mouse buttons.

`onClick` never fired for a right or middle click, so the `isRightClick` field it documents could never be `true` and a context menu had no event to hang on. `onClick` stays primary-only, like the DOM, and `onAuxClick` handles the rest.

```tsx
<div
  onClick={() => select(item)}
  onAuxClick={(event) => {
    if (event.isRightClick) openContextMenu(event.x, event.y)
  }}
/>
```

`onMouseDown` and `onMouseUp` still see every button through `event.button`: `0` left, `1` middle, `2` right.

The automation `click` now sends the button it is asked for: `element.click({ button: 2 })` was silently a left click before.
