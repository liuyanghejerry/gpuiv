---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Make `<code>` a bare surface. It paints glyphs only now: no fill, no border, no
radius, no padding and no language header. `style` is the surface, exactly like
a `<div>`, so the card look belongs to your app instead of to the element.

```tsx
<code
  code={source}
  language="typescript"
  showLineNumbers
  style={{
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffffff1f',
    backgroundColor: '#ffffff09',
  }}
/>
```

`fontFamily`, `fontSize`, `fontWeight`, `lineHeight` and `color` in `style` now
beat the theme, and one resolver feeds all three consumers: the div text style,
every `TextRun`, and the fixed row height. `style.lineHeight` used to be dropped
and clip tall glyphs; it re-sizes the rows instead. `fontSize` on its own scales
the row height by the theme's ratio, so bigger glyphs never overlap.

Lines still never wrap, and the block is still its own horizontal scroller, so
`whiteSpace` and `overflowX` in `style` do nothing.

**Migration.** `showHeader` is gone. Render your own header in a wrapper:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden' }}>
  <div style={{ padding: 6, backgroundColor: '#ffffff09' }}>
    <text style={{ fontSize: 12, color: '#a3a3a3' }}>{language}</text>
  </div>
  <code code={source} language={language} style={{ padding: 12, minWidth: 0 }} />
</div>
```

Five `theme.metrics` fields only ever styled that card, so they moved to the
`mdCode*` group where they still tune the `<markdown>` fenced block. `<markdown>`
keeps its card: a document renderer owns its layout, a primitive does not.

| Before | After |
|---|---|
| `codePaddingX` / `codePaddingY` | `mdCodePaddingX` / `mdCodePaddingY` |
| `codeRadius` | `mdCodeRadius` |
| `codeHeaderPaddingY` | `mdCodeHeaderPaddingY` |
| `codeHeaderTextSize` | `mdCodeHeaderTextSize` |

`codeTextSize`, `codeLineHeight` and the `codeGutter*` fields are unchanged.
