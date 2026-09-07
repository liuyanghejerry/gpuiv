# Native element rules

Deep-dive extracted from the root [AGENTS.md](../../AGENTS.md) — read that first.
These are the full rules for writing or changing native code in `packages/native`.

## Key Types

- **`RetainedElement`** (Rust, `retained_tree.rs`) — the Rust-side source of truth:
  `id`, `element_type`, `style: Option<Arc<StyleDesc>>` (hash-consed by payload,
  shared across elements), `content`, `events`, `children`, `parent`,
  `custom_props`, `auto_focus`, `subtree_revision` (bumped on any descendant
  mutation), `test_id`.
- **`StyleDesc`** (`style.rs`, camelCase serde) — CSS-like, deserialized from the JS
  `style` object: display/flexbox/grid, sizing (`DimensionValue`: pixels |
  percentage | auto), per-side padding/margin, position, colors, per-side borders +
  radius + `BoxShadowValue`, text, overflow, cursor, `pointerEvents`,
  `userSelect`/`selectionColor`, and one-level `hover`/`active` nested `StyleDesc`s
  applied natively by GPUI (no JS round trip). `background` is a `BackgroundValue`
  union (color string or `{type: "linear-gradient", angle, stops, colorSpace?}`)
  resolved through `StyleDesc::resolved_background()` — painting, `should_occlude()`,
  and anchored overlay fill detection all share that one resolution.
- **`EventPayload`** (`element_tree.rs`, Rust → JS) — one napi struct for all events;
  fields are optional and only the relevant ones are populated: `element_id`,
  `event_type`, mouse (`x`, `y`, `button`, `click_count`, `is_right_click`,
  `pressed_button`), keyboard (`key`, `key_char`, `is_held`), scroll (`delta_x`,
  `delta_y`, `precise`, `touch_phase`), `hovered`, plus modifiers.

`should_occlude()` decides the hitbox policy: `pointerEvents: "none"` never blocks; `"auto"` always does; unset follows the painted surface (a fill or absolute/fixed position blocks, with in-flow fills using BlockMouseExceptScroll).

## Text rendering: one funnel, no exceptions

Every string GPUIV paints goes through `crate::text`:

- `selectable_text(..)` for content — registers into the per-frame selection
  registry; the window mouse and key listeners are installed once per frame by
  `selection_frame_reset(..)`
- `chrome_text(..)` for line numbers, language tags and file headers — painted
  and logged for tests, but never part of a selection

**Never call `div().child(some_string)` in a new element.** Doing so makes the
text invisible to selection AND to `getPaintedText()`, so it cannot be tested
except by screenshot.

The registry is rebuilt during **paint**, not during build, because paint order
is the only place document order is guaranteed: a `list()` decides at paint time
which rows exist. `selection_frame_reset()` must stay the first child of the
root, or stale entries from the previous frame leak into the next drag.

Drag move and mouse-up listeners live on the frame reset, not on each text run,
so a drag survives its anchor row unmounting under virtualization, and a pointer
held near a `<virtual-list>` edge autoscrolls the list (the timer stops when the
list can no longer move). Never `stop_propagation()` on mouse-up elsewhere, or a
drag and its edge-scroll timer stay armed. `TestRenderer.advanceTime(ms)` drives
these timers in tests; `clockFastForward` only moves the motion clock.

## A new element needs a host-derived GPUI id, or it has no state

`.id(..)` is not decoration. gpui keys `InteractiveElementState` off the
`GlobalElementId`, so an element without one silently loses **hover, active,
pointer capture, implicit scroll, its accessibility node, and any element state
gpui itself keeps**. `<img>` had no id, which is why an animated GIF never left
frame zero: `ImgState` holds the frame index.

`<div>` and `<text>` use `gpui::ElementId::Integer(host_id)`. Host ids are
already unique per renderer, and a formatted name cost a `SharedString`
allocation on every node on every frame. Custom elements use
`ElementId::Name("__gpuix_<kind>_<host id>")`; that is a different enum variant,
so the two namespaces cannot collide.

**Never call `.id(<index>)` in this crate.** `impl From<usize> for ElementId`
makes the idiomatic gpui row id an `Integer`, which is the same namespace as a
host id. Every per-row id here is a formatted name for that reason:
`__gpuix_diff_line_{ix}`, `__gpuix_md_table_{id}_{sub}`, and the rest.

**Never call `apply_styles` on a stateful root. Call `apply_interactive_styles`.**
`StyleDesc` carries `hover` and `active` for every element type, so a builder
that applies only the base styles type-checks the prop, serializes it, and drops
it. `custom_surface` in `custom_elements/mod.rs` does this for you.

## Bounds: a container uses a tracker, a leaf uses `on_painted`

`getByTestId(..).click()` needs a recorded box. Two mechanisms, both required:

- **Containers** (`<div>`, `<text>`, `<code>`, `<diff>`, `<markdown>`, `<input>`)
  add `crate::automation::bounds_tracker(id, selection_start, insets)` as a
  child. It is `absolute().size_full()`, so the parent must be positioned. Pass
  `Some(selectable)` when the element also owns a selection-start region; the
  editor uses `Some(false)` so a drag moves the caret instead of starting a
  document selection. `custom_surface` attaches it.
- **Leaves** (`<img>`, `<svg>`) and **`<anchored>`** use
  `crate::automation::track_own_bounds(el, id)`, which is gpui's `on_painted`.
  Wrapping a leaf in a div instead would move the layout box: the wrapper
  becomes the flex item, and the image loses intrinsic sizing and corner
  clipping. `<anchored>` uses it because only gpui knows where the overlay
  landed after snapping.

Both record during **paint**, and `bounds_frame_reset` clears the registry
during paint too. Never move any of them to prepaint: `gpui::list()` prepaints a
speculative row range, then rolls the window back through `Window::transact` and
prepaints a different one, so a prepaint-recorded box can belong to a row that
never reached the screen.

## Layout numbers live in `Theme::metrics`, not in Rust constants

Row heights, gutter widths, paddings, text sizes and the heading scale are all
fields on `crate::theme::Metrics`, reachable from JS as `theme.metrics`.

**Do not add a new `const` for anything that decides layout.** Put it on
`Metrics`, give it a default, add it to `MetricsOverride`, `hash_into`, and the
`GpuixMetrics` TypeScript interface. The whole point is that a design tweak is a
Vue re-render, not a native rebuild.

Two things stay constant, because they are paint geometry and cannot move a
glyph: the table hairline, and the inline-code wash overhang.

`<diff>` derives its virtualized height model from the metrics without
measuring, so `DiffElement` re-runs `reset_with_uniform_height` whenever
`Metrics::hash_into` changes. Forget that and the scrollbar drifts from the
content.


## A macOS menu item owns its shortcut, so the window never sees it

`crate::app_menu` installs the App and Window menus during renderer init. GPUI
does not do this on its own: `NSApp.mainMenu` stays nil, macOS paints an empty
menu bar, and `⌘Q`, `⌘H`, `⌘M` and `⌘W` do not exist, because AppKit only
provides them through menu items.

**Never add an Edit menu carrying `⌘C` / `⌘V` / `⌘X` / `⌘A`.** AppKit consumes a
key equivalent before the window sees the key event, so those items would take
the keystroke away from the selection listener in `text::paint` and from the
per-focus clipboard handling in `custom_elements::input`. An Edit menu needs
those handlers moved into GPUI actions first.

`gpui::App::set_menus` reads each shortcut out of the keymap, so bind the keys
**before** you call it. Window-level items (`MinimizeWindow`, `ZoomWindow`,
`CloseWindow`) go through `with_window_menu_actions` on the root element in
`GpuixView::render`, because a `Window` exists nowhere else; app-level ones
(`Quit`, `Hide`, `HideOthers`, `ShowAll`) are `cx.on_action` globals.

Two things real AppKit decides for you. The **title of the application menu is
the executable name**, not the `Menu` name you pass, so `bun app.tsx` shows
`bun`; only a `.app` bundle changes it. And the menu named `Window` is handed to
`setWindowsMenu:`, which prepends AppKit's own tiling items, `Enter Full Screen`
included. Do not add that item yourself.

## Virtualized Vue children re-enter through `cx.processor`

`<virtual-list>` does not build its retained children during `GpuixView::render`.
Its `gpui::list()` callback uses `cx.processor` to re-enter the `GpuixView`
entity after the root render has returned, creates a fresh `BuildCtx`, and builds
only the rows GPUI requests. Never capture the root render's tree guard or
`BuildCtx` in that callback.

`<diff>` still owns its parsed Rust data because one native diff node is much
cheaper than retaining one Vue node per line.

`VirtualList` (the Vue wrapper with `itemCount` + `renderItem`) mounts only the
visible window in Vue itself — use it for long transcripts.

## A prepended row is only visible at the top

`gpui::ListState` anchors on a **logical item index**, and `splice_focusable`
shifts that anchor by the number of rows inserted before it. So a prepend keeps
the rows already on screen and pushes the new one above the viewport. That is
correct for a history pane, and wrong for a feed.

A browser anchors the same way and suppresses it at `scrollTop: 0`. GPUIV copies
that: `VirtualListEntry::sync` remembers a top-aligned list whose
`logical_scroll_top()` is `{0, 0}` and is not following its tail, and calls
`scroll_to(default)` after the splice. Do not "simplify" that away. The guard is
`is_following_tail()`, not the `followTail` prop: a following list that does not
fill its viewport also ends layout anchored at `{0, 0}`, and `scroll_to` would
call `stop_following` on it and kill the chat tail on any short transcript.

**Do not trust a short list to prove a prepend works.** While the content is
shorter than the viewport, gpui's "does not fill" branch re-anchors to item 0 on
every layout, so the drift is invisible. It appears on the frame where the list
first overflows. The regression test in `virtual-list.test.tsx` grows a 160px
list from 2 rows to 12 rather than starting tall.

**A loading row is the anchor while the reader waits in it**, so an
infinite-scroll prepend splices the page in *under* it and replaces the screen
the reader was looking at. The splice-shift above only protects an anchor
*below* the insert point. The app owns the correction, because only it knows the
loading row stands for the arriving content: read `getListScrollTop`, commit,
then `scrollToItem(indexOfTheMessageUnderTheVoid, offsetInVoid - EDGE_HEIGHT)`.
The negative offset anchors the viewport top above that row and gpui resolves it
at layout time against the freshly measured new rows, which is what makes the
restore pixel-exact; any pixel math done in JS would trust `estimatedItemHeight`
and still jump. The append twin: a reader waiting at a trailing loading row
usually rests on gpui's **at-end sentinel** (`itemIndex == item count`, stored
`logical_scroll_top` is `None`), not inside the void, so the offset is
meaningless there; convert with the viewport height from the same tuple
(`EDGE_HEIGHT - viewportHeight`). The Vue wrapper decodes the sentinel to
`atEnd: boolean` — the pixel conversion stays app-side. Traps that cost upstream
a session each:

- virtual-list `scrollToItem` is **queued and applied after the next render's
  splice** (`PENDING_VIRTUAL_LIST_SCROLLS` in `renderer.rs`). Applying it
  eagerly let `splice_focusable` shift the just-restored anchor a second time
  on the live renderer, while the test renderer hid it because
  `TestRenderer.scrollToItem` flushes first
- a bottom-aligned list with a trailing loading row starts **scrolled to the
  end**, i.e. showing that loading row. In tests, wheel direction is therefore
  ambiguous at mount: the first wheel tick can trigger a `next` fetch even when
  the test means to scroll up. Start from the latest page (no trailing edge) or
  `scrollToItem` onto content first.

