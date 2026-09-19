---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add a window-level `onSelectionChange` callback so apps can react when the text selection changes.

Pass it to `createApp()`, the same way as `onKeyDown`. The payload is a normal `EventPayload`. `value` is the joined selected text, or omitted when the selection is empty.

```tsx
createApp(App, {
  onSelectionChange(event) {
    lastSelected.value = event.value ?? ''
  },
})
```

The event fires once per real change, including a clear. An unchanged frame does not fire.
