# Scrolling and hit-testing

Deep-dive extracted from the root [AGENTS.md](../../AGENTS.md) — read that first.

## Nested scrolling is not supported

Never put a scroll container inside another scroll container. That includes
`overflow: "scroll"`, `<virtual-list>`, and `<diff>` (`gpui::list()` always
takes the wheel). GPUI delivers the same wheel event to both hitboxes. The
inner list steals the gesture. Nested scroll looks broken and there is no
GPUI API to turn list scroll off.

Keep **one** scroll parent. Long inner content must grow with that parent, or
collapse behind an expandable (file header, first N lines, Show more). `<diff>`
defaults to flow layout. Pass `scroll` plus a bounded height only for a
dedicated viewer. Do not give `<diff>` a bounded height inside a parent
scroller just so it can virtualize.

`overflow-x: scroll` is allowed inside a vertical scroller. GPUI remaps a
vertical wheel onto overflow-x unless `restrict_scroll_to_axis()` is set.
Every `overflow_x_scroll()` in native code must call that, or the parent
scroller jumps sideways when the pointer is over `<code>` or a markdown table.

## Scroll cost

A wheel event calls `cx.notify` on the one `GpuixView`. That rebuilds the
tree. `gpui::list()` then re-renders every **visible** item. Cached heights
only skip overdraw items that are off screen.

```
wheel  ►  notify GpuixView  ►  render()  ►  Taffy on visible rows  ►  paint
```

If scroll is smooth on empty padding and slow or stuck on text, a filled
child is stealing the wheel. `occlude()` is **BlockMouse**. It stops the
hit test. The parent list never sees the event. In-flow fills must use
`block_mouse_except_scroll()`. Keep `occlude()` for absolute/fixed overlays
and `pointerEvents: "auto"`.

Remaining scroll cost is Taffy on fat visible rows. `<code>` is one flex row
per line; safe-mdx is ~100 host nodes. Flatten paint (`<markdown>` / `<code>` /
`<diff>` as one native node) before changing the frame loop.

Keep `<virtual-list>` `overdraw` modest. 820px on a short chat kept almost
every row live. Profile with `debugFrameOverlay: 'full'`. The overlay is
draw time, not FPS. `8.3 MS` is about 120 Hz.

A long `{rows.map(...)}` is slow **at start**. Mounting creates every child in
the patch. Use `VirtualList` with `itemCount` and `renderItem` so Vue only
mounts the visible window. The host `<virtual-list>` children API still
retains every child. After mount, scroll cost is visible Taffy only.

Keep chrome state out of the component that maps the list. Keep the list prop
reference stable — replace the `turns` array only when a message arrives, and
the component's prop comparison skips the update, which is exactly what `memo`
did in the React binding. A 5k-row chat paid 250ms per click before that.
Profile that path with `INTERACT=1 bun profile-chat-scroll.tsx`. Do not treat a
fast wheel flush as proof that chrome updates are cheap.


## Overlays and icons

Menus, tooltips, and dialogs go through **`SelectContent` / `FloatingLayer` /
`<anchored deferred>`**. Never overflow a `position: "absolute"` card out of the
composer into a `<virtual-list>`. The list paints after the composer, so the
list shows through the menu and clicks hit the text behind it.

Do not paint `#00000000` over a blurred window. A transparent GPUI quad punches
through Metal to the desktop. Omit the fill, or use the parent color. Overlay
rows need a **solid** fill too, not a transparent idle state.

A filled in-flow `div` uses **BlockMouseExceptScroll**. Clicks and hovers stop,
the wheel still reaches the scroller behind it. `position: "absolute"` /
`"fixed"` or `pointerEvents: "auto"` uses **BlockMouse** and steals the wheel
too. `pointerEvents: "none"` opts out.

That is not DOM bubbling. GPUI hitboxes are one flat painted list, so the wheel
reaches **any** scroller behind the element, not only an ancestor. An absolute
card over an unrelated scroller would scroll it, which is why absolute steals
the wheel here. Give a pannable surface under absolute children
`pointerEvents: "none"` wrappers.

`pointerEvents: "none"` means this element inserts **no hitbox**, so nothing
behind it is blocked. It does not disable the listeners on the element itself,
and it does not inherit.

An absolutely positioned wrapper with **no** fill still takes hits, like an
empty positioned `div` in a browser. A wrapper that only carries a scroll
translation must set `pointerEvents: "none"`, or it swallows every press meant
for the surface behind it. Its children keep their own hitboxes:
`pointerEvents` does not inherit.

(Upstream has since moved to BlockMouseExceptScroll for absolute as well —
`occlude()` reserved for `pointerEvents: "auto"` — to make pannable canvases
possible. Our `renderer.rs` still steals for absolute/fixed; if you need that
behaviour, sync the upstream change instead of working around it.)

Text **selection** still uses window mouse events and text bounds, not hitboxes.
A drag on a menu over markdown can still start a selection. Do not skip
selection tests to hide that.

If `<svg>` icons are blank in vitest, `src` is probably a `data:image/svg+xml`
URL from `import … with { type: 'file' }`. Native decodes that URL. Do not write
a temp-file workaround. Prefer `fill="#000"` / `stroke="#000"` plus
`style.color`. `currentColor` in the file is not `style.color`.

macOS traffic-light clearance is **86px**. The test renderer does not draw
traffic lights, so that gap looks empty in PNGs.

