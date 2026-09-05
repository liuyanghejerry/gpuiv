# AGENTS.md - GPUIV Codebase Guide

**Read [README.md](./README.md) first** to understand what GPUIV is, the architecture, mutation API, event flow, supported elements/events/styles, and the test renderer.

> **GPUIV is a self-maintained fork of GPUIX**
> ([`remorses/gpuix`](https://github.com/remorses/gpuix), the React binding),
> ported to Vue 3. How this fork relates to upstream — what is synced,
> declined, or deliberately diverged — is tracked in
> [`docs/upstream/`](./docs/upstream/README.md).

## GPUIV is a thin layer on GPUI

**Read the GPUI docs and the GPUI source before you write native code.** `zed/crates/gpui`
is checked out in this repository. `gpui::ListState`, `gpui::div`, `gpui::Window` and the
rest are the real API; GPUIV only translates a Vue tree into calls on them.

Do not invent behaviour on top of GPUI. If a GPUIV element needs something GPUI does not
do, the order is:

1. Find the GPUI API that already does it. Search `zed/crates/gpui` for the symbol
2. Search `zed-industries/zed` issues and PRs. Someone may have shipped it already
3. Fix it in the `remorses/zed` fork as a normal GPUI change, and bump the submodule
4. Only then, add GPUIV code

**Never paper over GPUI in `packages/native`.** A workaround that re-applies state after
GPUI computed it, patches a value GPUI owns, or reaches around a GPUI invariant will break
on the next submodule bump and is very hard to debug. When such a change is unavoidable,
it must state in a comment what GPUI does, why that is not what GPUIV needs, and which
GPUI call makes it safe.

Prefer the smallest translation. Fewer moving parts is more important than matching any
other framework's behaviour.

## Project Goal

GPUIV enables building **native GPU-accelerated desktop applications** using **Vue 3 and TypeScript**, powered by [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) (Zed's rendering framework).

Instead of Electron/web rendering, your Vue components render directly to the GPU via Metal/Vulkan.

```
Vue 3 (TypeScript)  →  napi-rs  →  GPUI (Rust)  →  GPU
     Your code         Bridge      Native render    Metal/Vulkan
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  JavaScript / TypeScript                                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Your Vue App                                           │   │
│  │                                                          │   │
│  │  const Counter = defineComponent({                      │   │
│  │    setup() {                                            │   │
│  │      const count = ref(0)                               │   │
│  │      return () => (                                     │   │
│  │        <div style={{ display: 'flex', gap: 8 }}>        │   │
│  │          <div onClick={() => count.value++}>+</div>     │   │
│  │        </div>                                           │   │
│  │      )                                                  │   │
│  │    },                                                   │   │
│  │  })                                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @gpuiv/vue (packages/vue)                              │   │
│  │                                                          │   │
│  │  - Vue 3 custom renderer (createRenderer from vue)      │   │
│  │  - Host config emits DOM-like mutations                 │   │
│  │  - BatchingRenderer: one applyBatch() per flush         │   │
│  │  - Event handler registry keyed by (id, eventType)      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                     ↓ mutations (batched JSON)                  │
└─────────────────────────────────────────────────────────────────┘
                               ↓ napi-rs FFI
┌─────────────────────────────────────────────────────────────────┐
│  Rust / Native                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @gpuiv/native (packages/native)                        │   │
│  │                                                          │   │
│  │  - RetainedTree: applies mutations, stores the UI        │   │
│  │  - GpuixView::render() → build_element() → GPUI         │   │
│  │  - apply_styles(): StyleDesc → GPUI style methods        │   │
│  │  - Event handlers → ThreadsafeFunction callbacks to JS   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  GPUI (from zed)                                         │   │
│  │                                                          │   │
│  │  - Immediate-mode UI framework                           │   │
│  │  - Flexbox layout via Taffy                              │   │
│  │  - GPU rendering via Metal (macOS) / Vulkan (Linux)      │   │
│  │  - Native window management                              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Insight: Immediate Mode Alignment

GPUI is **immediate-mode** - it rebuilds the entire UI tree every frame. This actually aligns perfectly with Vue's reactive model:

| Traditional DOM Renderer | GPUIV |
|--------------------------|-------|
| `appendChild(node)` | Mutation applied to the Rust RetainedTree |
| `node.style.color = x` | `setStyle` mutation, then rebuild next frame |
| Mutation-based | Mutation protocol + retained tree |

We don't fight GPUI's architecture - we embrace it. Mutations update the retained tree; `GpuixView::render()` walks it every frame to produce ephemeral GPUI elements. Only **changed elements** cross the FFI boundary — Vue's patch diffs the vnode tree and sends minimal mutations.

## Package Structure

```
gpuiv/
├── packages/
│   ├── native/                 # Rust napi-rs bindings (@gpuiv/native)
│   │   ├── src/
│   │   │   ├── lib.rs           # Module exports
│   │   │   ├── renderer.rs      # GpuixRenderer, GpuixView, build_element()
│   │   │   ├── retained_tree.rs # RetainedTree, RetainedElement (Rust-side source of truth)
│   │   │   ├── element_tree.rs  # EventPayload type (Rust → JS)
│   │   │   ├── style.rs         # StyleDesc, should_occlude() hitbox policy
│   │   │   ├── color.rs         # Color parsing (csscolorparser 0.8.3)
│   │   │   ├── theme.rs         # Comet palette, oklch helpers, Metrics, JS overrides
│   │   │   ├── motion.rs        # Native motion.div transitions
│   │   │   ├── automation.rs    # Test automation command protocol (native side)
│   │   │   ├── test_renderer.rs # TestGpuixRenderer (test-support feature, macOS)
│   │   │   ├── text/            # Selection: state, paint registry, TextRuns
│   │   │   ├── syntax/          # Syntect highlighting + bounded cache
│   │   │   ├── markdown/        # pulldown-cmark parser + gpui renderer
│   │   │   ├── diff/            # Unified-patch parser + row flattening
│   │   │   └── custom_elements/ # input, img, svg, anchored, code, diff, markdown
│   │   ├── examples/
│   │   │   └── hello.rs         # Pure GPUI test (no JS)
│   │   ├── Cargo.toml
│   │   └── build.rs
│   │
│   └── vue/                     # Vue 3 custom renderer (@gpuiv/vue)
│       ├── src/
│       │   ├── index.ts          # Public exports
│       │   ├── testing.ts        # createTestApp(), TestRenderer
│       │   ├── reconciler/
│       │   │   ├── vue-renderer.ts    # Vue createRenderer host config (mutation protocol)
│       │   │   ├── batch-renderer.ts  # BatchingRenderer: queues ops, one applyBatch() per flush
│       │   │   └── event-registry.ts  # (id, eventType) → handler map
│       │   ├── components/       # motion, VirtualList, Select, FloatingLayer
│       │   ├── automation/       # connectTest/launch client, stdio protocol
│       │   ├── hooks/            # use-gpuix, use-window-size
│       │   ├── types.ts          # NativeRenderer interface, StyleDesc TS types
│       │   └── __tests__/        # vitest suites (GPU-backed)
│       └── package.json
│
├── examples/                    # Example apps (private workspace)
│   ├── chat.tsx                 # Waku-style app (the flagship example)
│   ├── chat.test.tsx            # Automation-driven UI test
│   ├── chat.perf.test.tsx       # Draw / chrome perf regression test
│   ├── counter.tsx, diff.tsx, native-text.tsx
│   ├── profile-chat-scroll.tsx  # Manual profiling entry
│   └── compile-chat.ts          # bun compile bundle script
│
├── scripts/
│   ├── dev.ts                   # Watch Rust src, rebuild, re-render screenshots
│   └── screenshots.ts           # Regenerate docs/images/
│
├── docs/                        # Design plans + curated images
├── zed/                         # Pinned GPUI fork submodule (gpuix)
└── .changeset/                  # Pending release notes
```

## The Mutation Protocol (JS → Rust)

The FFI surface is one atomic batch call. The `NativeRenderer` interface (`packages/vue/src/types.ts`) has a single required mutation method — everything else is optional query/command API:

```ts
interface NativeRenderer {
  /** Apply one commit. Returns every element id destroyed by the batch. */
  applyBatch(json: string): Array<number>
  // …optional focus/scroll/selection/window/debug methods
}
```

Element IDs are plain numbers from a JS incrementing counter (u64 in Rust, f64-safe across napi).

The host config talks to a commit-phase `MutationRenderer` facade (`packages/vue/src/reconciler/batch-renderer.ts`): its explicit methods (`createElement`, `setStyle`, …) only push `["opName", ...args]` tuples onto a queue, and `flushMutations()` — invoked on a microtask after Vue's scheduler has run its component update jobs, or synchronously by callers that need the Rust tree current (mount, tests, clock-pinned frames) — flushes the whole queue in **one `applyBatch(json)` FFI call**. The wire format is nine ops:

```
["createElement", id, "type"]      ["setStyle", id, { …style }]   ← raw object
["destroyElement", id]             ["setText", id, "content"]
["appendChild", parentId, childId] ["setEventListener", id, "type", bool]
["insertBefore", parentId, childId, beforeId]
["setRoot", id]                    ["setCustomProp", id, "key", value]   ← raw JSON value
```

- There is no `removeChild` op: `destroy_element` unlinks the child from its parent and invalidates the parent chain in Rust, and `appendChild`/`insertBefore` re-parent. Never reintroduce a detach op — a dangling child id in `parent.children` or a stale `subtree_revision` cache is the bug it hides.
- Queue **raw objects** for `setStyle` / `setCustomProp`. Do not `JSON.stringify` them first — the outer applyBatch stringify would escape that string again and Rust would parse twice. A 10k-row mount spent 626ms in `applyBatch` that way.
- Adding a new mutation means one facade method in `batch-renderer.ts` plus one `BatchOp` variant in `renderer.rs`. The TS facade type is the JS-side validation; the Rust visitor errors on unknown ops (`unknown operation: …`), so a typo fails loudly, not silently.
- Rust decodes the batch straight from its JSON bytes into typed ops (strings borrow from the input, styles stay `&RawValue` until apply), then hash-conses identical style payloads into shared `Arc`s **before** applying — parse-then-apply keeps the batch atomic, and a failed style rolls back what the batch interned. A 10k-turn chat mount parses+applies in ~30ms, down from ~127ms. The style table is swept when it doubles or when it outlives a shrunken tree (`maybe_sweep`).
- Vue's renderer patches synchronously within a component update, but the update itself is scheduled on a microtask. Host nodes are materialized into the queue during patch, then the batch is flushed on the microtask after the scheduler finishes.

Rust applies the batch to `RetainedTree` and invalidates the view. Each GPUI frame, `GpuixView::render()` walks the retained tree and calls `build_element()` to produce ephemeral GPUI elements; Taffy lays them out and the GPU paints.

### Event Flow (Rust → JS)

```
1. User clicks element id=3
2. GPUI fires on_click on the element
3. Rust closure calls emit_event_full(callback, 3, "click", {x, y, ...})
4. ThreadsafeFunction queues EventPayload on the Node.js event loop
5. JS event registry: eventHandlers.get(3)?.get("click")?.(payload)
6. Vue handler runs: onClick={() => count.value++}
7. State update → Vue scheduler → patch sends mutations → applyBatch back to Rust
```

Rust only knows **whether** an element has a listener (via `setEventListener`), never the closure — handlers live in JS.

### Mouse capture is armed by the press

A `div` with `onMouseDown`, `onMouseMove`, and `onMouseUp` keeps receiving move and up after the pointer leaves the hitbox, matching HTML `setPointerCapture`. GPUIV arms that automatically when the same node listens for both `mouseDown` and `mouseMove`: `build_element` calls GPUI's `el.capture_pointer()` on it.

Put all three on the element the user grabs — a clip handle, a resizer, a slider. Capture is armed by the **press**, so an overlay mounted during that press never arms it, and a release past the window edge is lost. A node with only `onMouseDown` / `onMouseUp` does not capture, and a release outside still cancels the click, as in the DOM.

## Key Types

### RetainedElement (Rust, `retained_tree.rs`)

```rust
pub struct RetainedElement {
    pub id: u64,
    pub element_type: String,                    // "div", "text", "input", "diff", ...
    pub style: Option<Arc<StyleDesc>>,           // hash-consed by payload, shared across elements
    pub content: Option<String>,                 // text content
    pub events: HashSet<String>,
    pub children: Vec<u64>,
    pub parent: Option<u64>,
    pub custom_props: HashMap<String, serde_json::Value>, // input, diff, etc.
    pub auto_focus: bool,
    pub subtree_revision: u64,                   // bumped on any descendant mutation
    pub test_id: Option<String>,                 // from the testId prop
}
```

### StyleDesc (`style.rs`, camelCase serde)

CSS-like, deserialized from the JS `style` object. Groups: display/flexbox/grid, sizing (`DimensionValue`: pixels | percentage | auto), per-side padding/margin, position, colors, per-side borders + radius + `BoxShadowValue`, text, overflow, cursor, `pointerEvents`, `userSelect`/`selectionColor`, and one-level `hover`/`active` nested `StyleDesc`s applied natively by GPUI (no JS round trip). `background` is a `BackgroundValue` union: a color string or a `{type: "linear-gradient", angle, stops: [2], colorSpace?}` object resolved through `StyleDesc::resolved_background()` — painting, `should_occlude()`, and anchored overlay fill detection all share that one resolution.

`should_occlude()` decides the hitbox policy: `pointerEvents: "none"` never blocks; `"auto"` always does; unset follows the painted surface (a fill or absolute/fixed position blocks, with in-flow fills using BlockMouseExceptScroll).

### EventPayload (`element_tree.rs`, Rust → JS)

One napi struct for all events; fields are optional and only the relevant ones are populated: `element_id: f64`, `event_type: String`, mouse (`x`, `y`, `button`, `click_count`, `is_right_click`, `pressed_button`), keyboard (`key`, `key_char`, `is_held`), scroll (`delta_x`, `delta_y`, `precise`, `touch_phase`), `hovered`, plus modifiers.

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

## Iterating on the Rust side

There is no hot reload and there cannot be: `require()` of a `.node` calls
`process.dlopen`, Node has no unload, and the event loop, GPU device, window and
selection registry all live in thread-locals of the loaded library.

Use `bun run dev` (see `scripts/dev.ts`). It watches `packages/native/src`,
rebuilds, and re-renders the screenshot tests. **A Rust edit reaches fresh PNGs
in about 4 seconds.** Prefer screenshot mode over `--app`: PNGs in
`packages/vue/screenshots/` can be read by an agent, a live window cannot.

**Never run `bun run clean` in `packages/vue` while `bun --hot chat.tsx` is
up.** `packages/vue/dist` is inside the app's module graph, so deleting it
under a running watcher breaks every subsequent load until the process is
restarted. Build first, then start the app.

```bash
bun run dev                      # rebuild, re-render the showcase screenshots
bun scripts/dev.ts --shots diff  # only tests matching "diff"
bun scripts/dev.ts --app native-text   # rebuild, restart an example app
```

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

**Never ship or start the app on a debug native build.** `bun run build:debug`
and `cargo build` without `--release` produce an unoptimized `.node`. GPUI
paint is then many times slower, and that looks like an app bug. Always use
`bun run build` in `packages/native` (release). Use `build:debug` only when
the user asks, or when a debug-only tool (lldb, sanitizers) cannot run on
release. After any debug build, rebuild release before starting `chat.tsx`
or judging frame time.

Two things avoid the rebuild entirely:

- **Content** already lives in props. Change `patch` or `source` and the next
  frame shows it.
- **Design numbers** live in `theme.metrics`. Tuning a row height or heading
  scale is a Vue re-render.

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

The chat "jank" over code and tables was the Y-to-X remap above, not the
tick loop. After that fix, remaining cost is Taffy on fat visible rows.
`<code>` is one flex row per line. Safe-mdx is ~100 host nodes. Flatten
paint before changing the frame loop.

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

## Profiling and optimizing

Load the **profano** skill first. Fetch its README. Do not guess CLI flags.

Separate **first mount**, **scroll**, and **chrome setState**. They are
different paths.

```
first mount
  Vue maps every child
    ►  createElement / setStyle / setCustomProp  (queued)
    ►  one applyBatch JSON
    ►  Rust RetainedTree
    ►  first paint (list builds visible rows only)

scroll
  wheel  ►  notify GpuixView  ►  render()  ►  Taffy on visible rows  ►  paint

chrome setState
  sidebar click / composer key
    ►  parent re-render
    ►  {rows.map(...)} again unless the list props stay stable
    ►  same JS cost as mount if you forget
```

### JS / mount

Write a short script that mounts through `createTestApp()` and exits. Profile
that, not the live window. The tick loop will drown the mount.

```ts
import { createTestApp } from '@gpuiv/vue/testing'
import { ChatApp } from './chat'

const start = performance.now()
const app = createTestApp(ChatApp)
console.log(`mount ${(performance.now() - start).toFixed(1)}ms`)
```

```bash
cd examples
MOUNT_ONLY=1 bun --cpu-prof --cpu-prof-dir=../tmp/cpu-profiles profile-chat-scroll.tsx
INTERACT=1 bun profile-chat-scroll.tsx
npx profano ../tmp/cpu-profiles/CPU.*.cpuprofile -n 30
npx profano ../tmp/cpu-profiles/CPU.*.cpuprofile --sort total -n 20
```

Read **self** first. That is where the CPU sat. **Total** is the caller chain.

The 10k chat mount was 850ms. profano said:

| Function | Self | What it was |
|---|---|---|
| `applyBatch` | 626ms | Rust parsing the mutation JSON |
| (renderer scheduler) | 31ms | Vue |
| `stringify` | 26ms | `JSON.stringify(queue)` |

Vue was not the problem. The batch **stringified every style and theme**, then
stringified the queue, then Rust parsed each escaped string again. Fix: queue
raw objects (see "The Mutation Protocol" above).

After a renderer change, **build `@gpuiv/vue`**. `examples/` and
`bun --hot chat.tsx` load `packages/vue/dist`, not `src`. packages/vue
vitest uses `src`. You will think the fix works in one suite and fail in the
app.

```bash
cd packages/vue && bun run build
```

### Scroll / paint

Turn on `debugFrameOverlay: 'full'`. The number is **draw time**, not FPS.
`8.3 MS` is about 120 Hz.

The chat wheel jank was **not** the tick loop. GPUI remaps a vertical wheel
onto `overflow-x`. `<code>` and markdown tables stole the gesture. Fix is
`restrict_scroll_to_axis()` on every `overflow_x_scroll()`.

Keep `overdraw` modest. 820px on a short list keeps almost every row live.

Do not flatten the frame loop to hide fat rows. Flatten the rows
(`<markdown>` / `<code>` / `<diff>` as one native node).

### Native

For Rust time, `sample` the bun/node pid, or `samply`. GPUI also has
`ZED_MEASUREMENTS=1`. That is Zed's frame log, not our overlay.

A `.node` cannot unload. After a native rebuild, restart the app. `bun --hot`
only remounts Vue.

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

## Upstream tracking

This fork tracks `remorses/gpuix` (the React binding), which shares no git
history with us — never `git merge upstream/main`; port per-file or per-diff.
The status of every upstream topic (synced / pending / declined / diverged)
lives in [`docs/upstream/README.md`](docs/upstream/README.md). Update that
ledger in the same PR whenever you port, decline, or deliberately diverge from
an upstream change. A declined topic needs its own file under `docs/upstream/`
recording the reason and the revisit triggers. An agent skill driving this
loop lives at `.agents/skills/upstream-sync/SKILL.md`.

## Ported code

`text/`, `syntax/`, `markdown/`, `diff/`, `theme.rs`, `custom_elements/code.rs`,
`custom_elements/diff.rs`, and the caret blink sections of
`custom_elements/input.rs` are ported from [Comet](https://github.com/zeronsh/comet)
(MIT). Each file names its original in
its header, and `THIRD_PARTY_NOTICES.md` has the full table. When fixing a bug in
one of them, read the Comet original first: it usually documents why the code is
shaped that way.

## Auto-generated files (do NOT edit manually)

The following files in `packages/native/` are auto-generated by napi-rs during `bun run build`. Never edit them by hand — they are regenerated from the Rust `#[napi]` annotations every build:

- `packages/native/index.d.ts` — TypeScript type declarations
- `packages/native/index.js` — Node.js loader/binding glue
- `packages/native/*.node` — compiled native binary

To update the TypeScript API surface, edit the Rust source files in `packages/native/src/` (add/modify `#[napi]` structs, methods, functions), then run `bun run build` in `packages/native` to regenerate.

## Changesets

**Always** add a `.changeset/*.md` file after a user-facing fix or feature. Do this before you consider the work done. Never skip it. Never edit CHANGELOG.md. Never bump `package.json` version by hand.

Format (see `.changeset/readme.md`): one kebab-case `.md` file per logical change, `patch` for fixes and `minor` for features, present tense, focused on what users see. Front-matter lists the affected packages:

```md
---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Description of the user-facing change.
```

If the change fixes a GitHub issue or should close a PR, put `Fixes #N` / `Closes #N` on its own line. changepub copies those onto the release commit. Do not run the interactive changeset CLI, and do not add vague entries like "misc improvements".

## Publishing

**Never publish from a local machine.** CI is the only release path. Both packages' `prepublishOnly` scripts exit if `CI` is unset.

`.github/workflows/ci.yml` builds `@gpuiv/native` for every napi target (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64), uploads the `.node` artifacts, then the `publish` job downloads them, runs `napi create-npm-dirs` + `napi artifacts`, and publishes `@gpuiv/native` and `@gpuiv/vue`. macOS and Windows build with `build` (test-support included: Metal / DirectX `TestGpuixRenderer`), and CI runs the full vue + example suites on both. Linux builds with `build:release` (`--no-default-features`, no test-support — waiting on GPUI's wgpu image readback).

Publish order is required. `@gpuiv/vue` depends on `@gpuiv/native` (`workspace:^`, rewritten to the exact published version in CI). If Vue publishes first, an install in that window cannot resolve native.

1. `napi pre-publish` publishes the per-platform packages (`darwin-arm64`, `linux-x64-gnu`, …)
2. `npm publish` publishes `@gpuiv/native`
3. `npm publish` publishes `@gpuiv/vue`

NPM tokens are fetched through Sigillo (`SIGILLO_TOKEN` secret); CI never stores the npm token directly. The publish steps skip versions already on npm. To release: bump versions via changesets, push to `main`.

## Building

### Standalone Build

The `zed/` submodule tracks the `gpuix` branch of `remorses/zed`. Cargo uses path
dependencies from that submodule so the native addon and native platforms always
compile from the same source:

**Always keep `zed/` checked out on the local `gpuix` branch. Never leave the
submodule in detached HEAD state**, including after `git submodule update` or a
pointer update. If Git detaches it, switch back to `gpuix` before doing any
other work.

- macOS uses `MacPlatform::new_embedded()` and pumps AppKit on Node's main thread
- Windows and Linux run `gpui_platform::application().run()` on a dedicated UI thread
- `gpui_macos` is a direct macOS dependency for production and the GPU-backed test renderer
- `core-text = 21.0.0`, `core-graphics = 0.24.0` for macOS

These avoid the core-graphics 0.24 vs 0.25 conflict between `core-text` and Zed's `font-kit` fork.

First-time setup:

```bash
bun install
git submodule update --init --recursive
xcodebuild -downloadComponent MetalToolchain   # macOS, Xcode 26+
```

The default cargo feature is `test-support`, so published binaries include `TestGpuixRenderer` and users can write GPU-backed tests for their own apps.

### Rust toolchain

`rust-toolchain.toml` pins the same channel as `zed/rust-toolchain.toml` (currently `1.97.1`). When the
submodule moves, update ours to match or GPUI may not compile.

### Metal toolchain (macOS)

`gpui_apple` compiles `shaders.metal` in its build script. Xcode 26 no longer ships the
Metal compiler by default, so a fresh machine fails with
`cannot execute tool 'metal' due to missing Metal Toolchain`. Install it once:

```bash
xcodebuild -downloadComponent MetalToolchain
```

### Bumping the gpui revision

1. Merge upstream Zed into the `gpuix` branch in `remorses/zed`.
2. Resolve any embedded `gpui_macos` conflicts in a new commit; do not rewrite history.
3. Fast-forward the `zed/` submodule to the updated `gpuix` branch.
4. Match `rust-toolchain.toml` to `zed/rust-toolchain.toml`.
5. Run `cargo check --all-targets`, `bun run build`, and the test suites.

### Search Zed before you touch GPUI

Before you debug a GPUI behaviour, add a GPUIV feature that needs a new GPUI
API, or patch the fork, **search `zed-industries/zed` first**. Zed is a large
project with an active roadmap. The answer is often one of:

- someone already reported the same bug
- an open PR already implements the API, so **wait and bump the submodule**
- a merged PR already added it, so **bump the submodule** instead of writing code
- a closed issue says the Zed team declined it, so plan a fork-only fix

Search issues and PRs together, then search code:

```bash
# issues + PRs, full text
gh search issues --repo zed-industries/zed --include-prs --limit 30 'TransformationMatrix' \
  --json number,title,url,state,isPullRequest \
  --jq '.[] | [.number, .isPullRequest, .state, .title, .url] | @tsv'

# title only, to find the feature rather than every mention
gh search issues --repo zed-industries/zed --include-prs --match title --limit 30 'transform'

# where the API already exists in the tree
gh search code --repo zed-industries/zed --language Rust --limit 30 'TransformationMatrix'
```

Then read the promising ones in full. A closed issue is the important signal, and
its `stateReason` and comments explain whether the idea was rejected or shipped:

```bash
gh issue view 53303 -R zed-industries/zed --json number,title,state,stateReason,body,comments
gh pr view 59413 -R zed-industries/zed --json title,state,body,files,comments,reviews
```

**Use the `--repo` and `--match` flags. Do not put `repo:` or `in:title` inside the
query string.** `gh search` mangles the inline form: `repo:` first fails with
`Invalid search query`, and `in:title ... repo:owner/name` silently drops the repo
filter and returns results from unrelated repositories.

Search the real symbol names, not concepts. `TransformationMatrix`,
`with_element_offset`, and `request_animation_frame` find the discussion.
"animation is slow" does not.

Record the outcome in the changeset or PR body, with issue and PR URLs, so the
next session does not repeat the search.

### Fixing GPUI for GPUIV

The `remorses/zed` fork is part of GPUIV's implementation boundary. Fix GPUI in
the fork when a reusable GPUI API or platform correction keeps GPUIV simpler and
avoids embedded-platform or event-routing workarounds. Do not keep a hack in
`packages/native` only because the required API is missing upstream.

Fork-only fixes must be normal commits on a `gpuix`-based branch and must be
pushed to a **reachable remote branch** before this submodule points at them.
Never pin GPUIV to a detached commit. This checkout tracks `remorses/zed`; if
you cannot push there (no write access), fork `remorses/zed` under your account,
branch from `gpuix`, and repoint `.gitmodules` at your fork. Use a separate Zed
worktree for the change; do not develop or commit inside the `zed/` build
checkout.

```bash
# from a local clone of remorses/zed (or your fork)
git fetch origin gpuix
git worktree add ../zed-gpuix-<change> -b gpuix-<change> origin/gpuix

# from the Zed worktree, after review
git push origin HEAD:gpuix   # or HEAD:gpuix-<change> on your own fork

# then update this repository to that reachable commit
git -C zed fetch origin gpuix && git -C zed switch gpuix
git -C zed merge --ff-only origin/gpuix
```

Commit the resulting `zed` submodule pointer in GPUIV with the code that uses
the new API. The `.gitmodules` branch stays `gpuix` (or your fork's equivalent).

### PRs to Zed

A "PR to Zed" means **upstream** [`zed-industries/zed`](https://github.com/zed-industries/zed)
`main`. Never open that PR from this checkout. Never point it at `remorses/zed`.

Do **not** branch, commit review markers, or reset `zed/` inside this checkout.
That submodule is what GPUIV builds against. A dirty or switched `zed/` breaks
the native addon and the test renderer.

```bash
# from a separate local clone of zed, never this repo's zed/ build checkout
git remote add upstream https://github.com/zed-industries/zed.git  # once
git fetch upstream
git worktree add ../zed-<branch-name> -b <branch-name> upstream/main
```

Commit only in that worktree. Do not add comments to Zed source. Push the branch
to `remorses/zed`, then open the PR with `--repo zed-industries/zed --base main`.
After merge, cherry-pick onto `gpuix` and fast-forward the submodule
here. Never run `git reset` in `zed/` to "undo" PR work.

### PRs to GPUIV

When you open a PR with `gh pr create` against **this repo**
(`liuyanghejerry/gpuiv`), the body must name the **harness**, **agent**, and
**model** that wrote the change. Then put **every user prompt** from the
session in a collapsed `<details>` block. Reviewers use that to judge prompt
quality and how much the agent invented.

Do this for `gh pr create` and for later `gh pr edit` if the first body missed
it. Do not add this block to Zed PRs.

```md
**Harness:** OpenCode / Kimaki
**Agent:** build
**Model:** xai/grok-4.6

<details>
<summary>User prompts</summary>

1. first user message, verbatim

2. second user message, verbatim

</details>
```

- **Harness:** the product that ran the agent. Examples: OpenCode, Kimaki,
  Claude Code, Cursor, Codex.
- **Agent:** the named agent if the harness has one (`build`, `plan`, `opus`).
  Write `none` if there is no named agent.
- **Model:** the exact model id from the session (`xai/grok-4.6`,
  `anthropic/claude-opus-4.6`). Do not guess a shorter marketing name.
- **User prompts:** every user message that drove the PR, in order, verbatim.
  Skip system reminders, tool output, and your own replies. If a prompt is
  huge, keep the full text inside the details block; do not summarize it.

## Current Status

Keep this list in sync with the README **Status** section. User-facing APIs
belong in README. This list is only the remaining engineering work.

### Completed

- [x] Vue 3 custom renderer (`createRenderer` from `vue`) with mutation-based protocol
- [x] napi-rs FFI bindings and RetainedTree
- [x] Style mapping, including native `hover` / `active`
- [x] Mouse, keyboard, focus, scroll, and click-outside events
- [x] `applyBatch` applies one mutation batch atomically and invalidates the view
- [x] GPU-backed test renderer
- [x] Native `<input>` and `<textarea>`
- [x] `<img>` (local raster/SVG) and `<svg>` (tintable monochrome icons)
- [x] `<virtual-list>`
- [x] `<code>`, `<diff>`, `<markdown>` with Syntect
- [x] Cross-element text selection
- [x] Text search highlight (`highlight` prop, `useTextSearch`, `findRanges`)
- [x] Headless Select (Combobox and Tooltip are not ported to the Vue binding yet)
- [x] `setWindowTitle`
- [x] macOS menu bar with the standard shortcuts (`appName`)
- [x] Window chrome (`titlebarTransparent`, `windowBackground`, traffic-light position)
- [x] Background launch (`focus`, `show`, `activateWindow`)
- [x] Last window close quits the process
- [x] Debug frame overlay (`setDebugFrameOverlay`)
- [x] Native `motion.div` transitions with deterministic frame capture
- [x] `<canvas>` pixel bridge (`uploadCanvasPixels`/`readCanvasPixels`, `GpuixCanvas`)
- [x] `CanvasRenderingContext2D` — `getContext("2d")`: a TS WebIDL facade over the Rust rasterization core (`GpuixCanvas2DCore`; paths, transforms, gradients, AA strokes, clip, composite, image data). Draws record into a native display list and rasterize once per flush; uploads pull straight from the core (`uploadCanvasFromContext`), pixels never cross FFI. Text APIs throw `NotSupported`; glyph rasterization is follow-up work
- [x] `contextMenu` event, explicit pointer capture, `stopWheelPropagation`
- [x] Runtime errors keep the macOS window alive (`startFrameLoop` catches
      `tick()` throws; `createApp` installs uncaught handlers)
- [x] Applications own the Tab key: no process-wide Tab bindings;
      `focusNext`/`focusPrevious` napi + render-level `onKeyDown`/`onKeyUp`

### TODO

#### High Priority

- [ ] **Background highlighting** - move Syntect off the frame thread once
      there is a way to request a repaint from a background task

#### Medium Priority

- [ ] **Tablet input** - pen pressure waits on zed PR #63250 (or an aligned
      fork patch); tilt and coalesced events are fork-only. Research and
      revisit triggers in `docs/upstream/tablet-input.md`
- [ ] **Mid-press pointer capture** - arming capture on a press that is
      already in flight needs a hitbox-aware GPUI listener; today
      `setPointerCapture` arms from the next press on

#### Low Priority

- [ ] **Window controls** - resize, minimize (title already works)
- [ ] **Multiple windows** - Support multiple GPUI windows
- [x] **JS remount** - `createApp()` plus `bun --hot` remounts the Vue tree on the same window
- [ ] **Vue HMR** - keep `ref` state across saves. Needs Bun to run the Fast Refresh transform during `bun --hot`
- [ ] **Native hot reload** - cannot unload a `.node`. `bun run dev` rebuilds and restarts
- [ ] **DevTools** - Vue DevTools integration

## Testing

### Unit Tests

```bash
# Rust unit tests (selection, syntax, diff parser, markdown parser, theme)
cd packages/native && cargo test --lib

# Vue custom renderer + GPU-backed test renderer
cd packages/vue && bun run test

# Example app tests
cd examples && bun run test

# Chat draw / chrome regression (same suite, file filter)
cd examples && bun run test chat.perf.test.tsx

# macOS CPU clamp. E-cores, not Chrome 6x. Do not set in CI.
THROTTLE=utility bun run test chat.perf.test.tsx
THROTTLE=utility bun profile-chat-scroll.tsx
THROTTLE=utility bun --hot chat.tsx
```

`examples/chat.perf.test.tsx` is the automated profile. It uses `createTestApp()`,
not the live window. Assert **p95 draw / flush ms**, not a per-frame FPS floor.

`packages/vue/src/__tests__/canvas-wpt.test.ts` runs a vendored subset of the
W3C web-platform-tests canvas suite (593 cases: 452 run, 141 skipped with the
missing API named in the title) against the 2D context — no window, no GPU
renderer; it loads `@gpuiv/native` for the rasterization core, so it needs a
built `.node`. The cases come from `packages/vue/wpt/yaml/`; regenerate the
JSON with `bun scripts/convert-canvas-wpt.ts` after updating them. A case the
context cannot express yet goes into the `requires` list in the converter,
not into a `skip()` in the runner — the skip reason must stay machine-visible.

`THROTTLE` re-execs under `taskpolicy -c`. `utility` is an M1/M2 Air CPU proxy.
`background` is harsher, closer to a 2019 Intel Mac. GPU and RAM stay on this
machine. `taskpolicy -c` only works at launch. The vitest config wraps the main
process so workers inherit the clamp. A throttled run **logs** numbers and
skips the default budgets. Those budgets are for an unclamped M-series CPU.

Use `bun run test`, not `bun test`. The suites are vitest, so `bun test` picks the
wrong runner and fails on the `vitest` imports.

### Asserting on native elements

`getAllText()` reads the retained tree, so it only sees `<text>` nodes. `<code>`,
`<diff>` and `<markdown>` paint inside gpui and are invisible to it. Use
`renderer.getPaintedText()` (every string painted last frame, in paint order) and
`renderer.dragSelect(x1, y1, x2, y2)` instead.

`dragSelect` exists because selection listeners are registered during **paint**:
calling `simulateMouseDown` / `Move` / `Up` by hand without a flush between each
step silently selects nothing.

Vue updates flush on a **microtask**, not synchronously. After simulating input,
`await app.settle()` before asserting on the tree — it flushes Vue's scheduler,
applies pending mutations, and repaints.

Screenshots go to `packages/vue/screenshots/` (gitignored), not `/tmp`, so they
can be inspected after a run.

### Integration Test

```bash
cd examples && bun --hot chat.tsx
```

Use tuistory for the long-running process. Do not use `tsx` or raw `tmux`.

### Drive the live window

**Do not use `usecomputer`, `screencapture`, or desktop clicks.** GPUIV has a
Playwright-like automation API. Full docs are in the README **Automation**
section.

Mark targets with `testId`. Then either:

- `connectTest(app.renderer, app.settle)` against `createTestApp()` in vitest
- `launch({ command, args })` against a child process. The app serves commands
  on stdin only when stdin is a **pipe**

**Always pass `focus: false` when you start a window to check your own work.**
The user is doing something else. A window that activates on launch takes the
keyboard mid-sentence, once per iteration, and there is no reason for it:
`click()` and `screenshot()` never need focus. Wire the entry file so the flag
comes from the environment, then set it in `launch({ env })`, so a human run
still behaves normally.

```tsx
createApp(App, { focus: process.env.GPUIX_BACKGROUND !== '1' })
```

`fill()` and `press()` work against `launch()` too: the live renderer's
`simulateKeystrokes` dispatches synthetic key events through the window's GPUI
input pipeline, so native `<input>` and `<textarea>` get real key handling
without the window activating. `createTestApp()` is still preferable for
typing-heavy checks — it opens no window at all.

```ts
import { launch } from '@gpuiv/vue/automation'

const app = await launch({
  command: 'bun',
  args: ['chat.tsx'],
  cwd: 'examples',
  env: { GPUIX_BACKGROUND: '1' },
})
await app.getByTestId('sidebar-collapse').waitFor({ timeoutMs: 30_000 })
await app.screenshot({ path: 'tmp/chat.png' })

const startedAt = await app.clock.pause()
await app.getByTestId('sidebar-collapse').click()
await app.captureFrames('tmp/sidebar', [startedAt, startedAt + 100, startedAt + 200])
await app.clock.resume()
await app.close()
```

`click()` hits the last painted bounds. `clock.pause` / `set` / `fastForward`
freeze native motion. `captureFrames` writes one PNG per timestamp. That is how
you record a sidebar open/close, not a screen recorder.

## Related Projects

- [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) - Zed's GPU UI framework
- [Vue custom renderer API](https://vuejs.org/api/custom-renderer.html) - `createRenderer` reference
- [opentui](https://github.com/anomalyco/opentui) - Terminal UI with a custom renderer (host-config reference)
- [create-gpui-app](https://github.com/zed-industries/create-gpui-app) - Official GPUI starter template

## Contributing

1. Rust changes go directly in `packages/native/src/` — this fork has no
   `zed/crates/gpuix`; the submodule is the GPUI fork only
2. TypeScript changes can be made directly in `packages/vue/`

## Examples using same tech as ours. To unblock on issues and compare to our code

For example usage of projects depending on gpui in rust: opensrc https://github.com/zed-industries/create-gpui-app

For examples of NAPI rs native packages: https://github.com/napi-rs/package-template and https://github.com/Brooooooklyn/Image

For reading gpui source code: https://github.com/zed-industries/zed inside crates/gpui

For examples of a custom Vue renderer (the `createRenderer` host-config approach we use): https://vuejs.org/api/custom-renderer.html
