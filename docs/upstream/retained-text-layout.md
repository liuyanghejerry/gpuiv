# Retained text layouts (GPUI fork patch)

## Problem

GPUI is immediate-mode. Every frame, GPUIV builds a fresh `StyledText` for
every retained `<text>` run, and each one gets an empty `TextLayout`. So every
frame re-shapes and re-wraps every text run in the tree, even when nothing
about it changed.

Shaping is cached (`LineLayoutCache`). Each measure call still runs the line
wrapper and builds new `WrappedLine` storage. Taffy also probes a text leaf
several times per pass (min-content, max-content and the final width).

Measured on Linux with a phase timer in `Window::draw_roots`
(`bench-oss/frame-probe.ts`, frame after a trivial change):

| Tree | build | Taffy | prepaint | paint |
|---|---:|---:|---:|---:|
| 1000 table rows (3000 texts) | 18 ms | **35 ms** | 7 ms | 9.5 ms |
| 5000 `<text>` | 14 ms | **18 ms** | 4.7 ms | 8.5 ms |
| 5000 empty `div` | 8 ms | 1.4 ms | 3 ms | 3.7 ms |

Taffy is cheap without text. With text, Taffy was the largest phase.

## Search (2026-11-25)

- No Zed issue or PR about reusing `TextLayout` measurements across frames.
- The closest is cached views (`Entity::cached` / `AnyView::cached`). They
  reuse a whole subtree's prepaint and paint, but they need:
  - a definite size from the composer;
  - a cache key that includes the bounds' origin, so every scroll frame misses
    ([zed#67326](https://github.com/zed-industries/zed/issues/67326), open);
  - no accessibility nodes, since cached views drop them
    ([zed#66690](https://github.com/zed-industries/zed/issues/66690), open).
- GPUIV also rebuilds its selection, paint-log and bounds registries during
  paint, which a replayed paint would skip. So cached views do not fit
  arbitrary retained subtrees today.

## Fix

The fix is in GPUI's `elements/text.rs`, as one commit on `gpuix-gpuiv`:

- **`TextLayout::retained()`**: a layout that keeps its measurements across
  frames. **`StyledText::with_layout(layout)`** hands it to the element.
- **Reuse rule:** a probe is answered from an earlier frame only when two
  things are identical:
  - the key: text, runs, font size, line height, `white_space`,
    `text_overflow` and `line_clamp`;
  - the exact wrap width.

  The result is then exactly what shaping would produce again. Truncated
  layouts are never reused, matching GPUI's in-frame cache.
- **In-frame state:** it still starts empty every frame, so the in-frame
  cache semantics do not change.
- **Bounds:** up to 4 widths are remembered per text, since a flex pass probes
  several.
- **Shared lines:** `TextLayoutInner::lines` is an `Rc`, so a cache hit does
  not copy lines.
- **Default unchanged:** a `TextLayout::default()` keeps nothing across
  frames and behaves exactly as before.

GPUIV keeps one retained layout per host text run (`RetainedTextLayouts` in
`renderer.rs`). Entries the previous frame did not build are dropped every
frame. A second build of the same run within one frame gets an unshared
layout.

Results (same probe):

| Tree | Taffy before → after | Frame before → after |
|---|---:|---:|
| 1000 table rows | 35 → 20 ms | 78 → 62 ms (−20%) |
| 5000 `<text>` | 18 → 12 ms | 50 → 45 ms (−10%) |

The measure callbacks now total about 4 ms over 18 000 calls for 1000 rows.
The Taffy time that remains is Taffy solving a tree that GPUI rebuilds every
frame. That is structural, and is the subject of performance-plan item 2.

Verification:

- GPUI tests `retained_layout_reuses_unchanged_measurements` and
  `retained_layout_remeasures_changed_inputs`.
- `bench-oss/text-dynamics.ts` changes content, wrap width, font size and
  weight across frames. Its output is identical between the old and new
  builds.
- Six-app layout snapshots are unchanged.

## Status: diverged (fork-local), pending upstream proposal

The patch lives on `liuyanghejerry/zed:gpuix-gpuiv` on top of the Taffy
context-release patch ([taffy-context-release.md](./taffy-context-release.md)).
Its branch head is `gpuix-retained-text-layout`.

Revisit when:

- the patch is proposed to `remorses/zed` (`gpuix`) and merged. GPUIV then
  returns to tracking it without divergence; or
- upstream GPUI grows its own cross-frame text measurement cache, or retains
  the Taffy tree across frames. Then drop this patch and use that instead.
