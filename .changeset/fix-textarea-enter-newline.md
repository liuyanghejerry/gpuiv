---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Make Enter insert a newline in `<textarea>` unless `onSubmit` is set.

Plain Enter used to always fire `onSubmit` in both `<input>` and `<textarea>`. A normal multiline editor could not insert a newline, and Enter did nothing when no `onSubmit` listener was set.

```tsx
<textarea value={draft} onChange={(event) => (draft = event.value ?? '')} />

<textarea
  value={draft}
  onChange={(event) => (draft = event.value ?? '')}
  onSubmit={send}
/>
```

- `<textarea>`: Enter and Shift+Enter insert a newline and emit `onChange`
- `<textarea onSubmit={send}>`: Enter emits `onSubmit`; Shift+Enter still inserts a newline
- `<input>`: Enter still emits `onSubmit`
