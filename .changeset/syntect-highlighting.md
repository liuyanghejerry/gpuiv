---
'@gpuiv/native': minor
---

Replace Tree-sitter with **Syntect** for native syntax highlighting. `<code>`, `<diff>`, and Markdown fences still detect language the same way and still paint from the theme palette. Token classes stay `HighlightKind` values, not baked-in colours, so a theme change recolours existing spans without a reparse.

The highlighter now uses Syntect's **pure-Rust fancy-regex** engine. There is no Tree-sitter runtime and no per-language C grammar in the native binary.

```tsx
<code code={source} language="typescript" />
<markdown text={'```rust\nfn main() {}\n```'} />
<diff patch={unified} />
```

Language detection is unchanged: fence tag, then path, then shebang. Unknown languages still render as plain text.

Token colours can shift a little versus Tree-sitter, because Syntect scopes are not the old capture names. The public `HighlightKind` contract and the JS theme override path are the same.
