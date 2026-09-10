# `cursor: none` and custom image cursors

Topic: the two cursor capabilities the drawing client needs that GPUI cannot
express today.

**Status:** researched, not implemented. Not a `remorses/gpuix` topic — the
gap is in the zed submodule's `CursorStyle`. Recorded 2026-09-10 while closing
issue #49 P0-5; PR #65 maps 29 CSS keywords onto all 21 `CursorStyle` variants
and one-time-warns on the unsupported ones (`none`, `url(...)`, `wait`,
`progress`, `help`, `cell`, `zoom-in`, `zoom-out`).

## Local facts (zed fork at the current pin)

- `CursorStyle` is a closed enum of 21 variants, each backed by a per-platform
  cursor implementation; there is **no hidden variant and no image-based
  cursor**.
- gpuiv re-applies cursor styles every frame (`Styled::cursor()`), so a
  hidden or image cursor currently has nothing to map onto — the TS type
  union and one-time warning in PR #65 keep the gap visible instead of
  silently degrading.

## Proposed fork change (in `remorses/zed`, then bump the submodule)

1. Add a `Hidden` variant and plumb it through each platform's cursor setter
   (macOS `NSCursor` hide/unhide semantics, Win32 null cursor, X11 invisible
   cursor) — the brush UX is `cursor: "none"` plus a 跟手自绘 circle.
2. Optionally an image-cursor path (cursor created from an `ImageSource`) for
   `url(...)`; a larger surface — only if a shipped app needs it.

## Revisit triggers

- A drawing app ships on gpuiv and needs the brush circle → fork the
  `Hidden` variant (small, self-contained).
- Zed upstream grows either capability → port instead of forking.
