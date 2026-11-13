# @gpuiv/native

## 0.6.1

### Patch Changes

- cab21fa: Add user-facing npm READMEs with installation instructions, minimal examples, platform notes, and documentation links for the native, Vue, Animal Island, and packager packages.

## 0.6.0

### Minor Changes

- 4914c7b: Support `display: none` for retained elements and native `filter` motion tracks. Hidden subtrees keep their Vue state and native identity while skipping layout, paint and hit-testing, and matching image-filter lists interpolate on the frame clock while the last filtered frame (or the unfiltered source before the first) stays visible until the next one is ready. Keep every Carousel slide mounted so hidden pages retain local state, add the outgoing-slide crossfade, and keep BackTop's hover scale on one baked rest shadow that scales with the artwork instead of regenerating a filter per frame.
- 04f9021: Expose additional ARIA keyboard shortcuts, placeholders, set positions, table indexes, and counts through the native accessibility tree. Forward unknown `aria-*` props for forward compatibility and ignore invalid values safely.
- 9cfbb1c: Restore Beautiful UI keyboard actions and source links, resume appended streaming content, and fix virtual rows in small table viewports. Add editable property prompts, column resizing, horizontal scrolling with a fixed Company column, Flowchart, AgentScreen, and a static Surfer preview. Bundle the original font families, match sRGB color mixing, and support a reactive reduced-motion preference.
  
  Expose checked/pressed states and numeric ranges in the native accessibility tree so table checkboxes, approval choices, and sliders report their current values.
- 45f5d31: Tray support: `setTray(renderer, { iconPath, tooltip?, template? }, onClick?)` installs the process tray (macOS `NSStatusItem` via GPUIV-owned platform code — GPUI has no tray API — and Windows `Shell_NotifyIconW` on a message-only window), `clearTray(renderer)` removes it. One tray per process (a second `setTray` replaces the first); `onClick` fires on a tray click. `template: true` renders a monochrome macOS menu-bar template; Windows loads `.ico` (other formats best-effort). Linux reports unsupported (StatusNotifierItem/DBus not implemented) and a tray menu is not offered yet — clicks are the whole surface.
- 4b0558b: Headless `Dialog` components in Base UI's shape: `Dialog` (Root), `DialogTrigger`, `DialogPortal`, `DialogBackdrop`, `DialogPopup`, `DialogTitle`, `DialogDescription`, `DialogClose`. The portal is a new native `<anchored fill="window">` layer — Rust sizes it from the viewport every frame, so a resize never leaves an uncovered strip that clicks could reach. Escape closes through the dismiss layer stack, a modal popup traps Tab inside itself, and focus moves to the popup on open and back to the trigger (or whatever held focus before) on close; `initialFocus` / `finalFocus` override those targets and `modal: false` renders a non-blocking layer. `DismissableLayer` orders nested overlays by nesting rather than mount order, so a Dialog and a Select opening in one commit still stack correctly, and only the topmost layer closes on one Escape. `resolveFocusTarget` is exported for custom overlays.
- 525a332: macOS frame loop wakes on the display link instead of polling. `GpuixRenderer.setFrameWakeCallback(callback)` registers a weak, coalesced native callback that fires after GPUI queues a display frame, so AppKit input is delivered at display rate (up to 120Hz on ProMotion) and nothing polls while idle. `startFrameLoop` uses it automatically when available, with a 100ms fallback timer for a lost wake (e.g. a hidden window's display link); an explicit `frameMs` keeps fixed-rate timer polling. Other platforms are unchanged.
- eaf511d: A Rust crate can add its own GPUI component as an element: `register_custom_element` stores a factory in a process-wide list that every renderer picks up, and the crate ships its own Node addon loaded through `NAPI_RS_NATIVE_LIBRARY_PATH`. Element names must contain a `-` and cannot reuse a built-in. The public custom-element surface (`CustomElement`, `CustomRenderContext`, `custom_surface`, `wire_standard_events`, `emit_event_full`, `EventCallback`, `GpuixView`, and a re-exported `gpui`) is now importable from `gpuiv_native`; `EventPayload` gains `detail` for custom-event data. See "Your own native elements" in the docs and the runnable `example-rust-native-element/` crate.
  
  In `@gpuiv/vue`, every prop named `on` + an uppercase letter with a function value is now an event listener, on any element — not just the built-in event names — so externally registered elements get custom events (`onGreet` → `greet`). A non-function value stays a data prop, and a prop switching between the two keeps listeners and props in sync.
- 71a105e: Inline `$x^2$` formulas in `<markdown>` now render as baseline-aligned images when the `math` map covers them. The flattener replaces the TeX run with space characters whose measured advances (NBSP / THIN / HAIR SPACE denominations from the live mono font) reserve the formula's exact width, and the text underlay paints the rasterized SVG with its bottom sitting `depth` px below the line baseline — the metadata `renderMathMap` already produced. Selection drags across a formula keep working; copying one copies its placeholder spaces rather than the TeX (the same loss an inline image copies in the DOM), and unmapped formulas keep today's literal-TeX fallback. Formula SVGs rasterize once per element lifetime through gpui's usvg pipeline.
- d26b1c1: Focus styles, ported from upstream gpuix: a new nested `focusVisible` style object applies natively while an element has focus after keyboard input (like CSS `:focus-visible`; a mouse press never shows it), and while a control has keyboard focus every other focusable element dims to 40% of its own opacity (paint only, bounds never move) so every Tab target stays visible. A focused text field dims nothing. Opt out per element with `style.keyboardFocusDim: false` (SelectContent and DialogPopup do), or for the whole window with `createApp(App, { keyboardFocusDim: false })` and draw your own focus look with `focusVisible: { outline: { … } }`. The dim travels as a new `setKeyboardFocusDim` batch op (one per root creation, so a remount without the option restores the default). Our existing `outline` style object stays the way to paint rings; upstream's flat `outlineWidth`/`outlineColor`/`outlineOffset` props were not adopted.
- 811d00a: Report native image decode completion and failure through `onLoad` and `onError`, once per source generation. Include the source and intrinsic dimensions or error in the event payload. Restore Animal Island Image loading fades and error artwork, and Avatar image fallbacks with the original `onError=false` opt-out.
  
  Batch image completion repaint notifications on the next GPUI frame so many resources finishing together do not redraw the entire window once per image or stall native queries.
- 1dd5711: Accept BGRA pixel buffers in live image uploads without swapping color channels on the UI thread.
- cde4787: Every host element ref now has `scrollIntoView()`, which scrolls the nearest `overflow: "scroll"` parent or `<virtual-list>` until the element is visible. `<img>` refs additionally gain `setImage(bytes)` and `setImagePixels(width, height, rgba)` for live image uploads that bypass `src` and the JSON mutation protocol — the previous GPU image is dropped on replace and on unmount, and a virtual-list child scrolls by its logical index (windowStart-aware), not its windowed child position.
- 11b7de2: Add `renderer.loadFont(path)` and `renderer.loadFontBytes(bytes)` to register custom `.ttf`/`.otf` fonts with the GPUI text system, so `fontFamily` can reference bundled fonts (e.g. Inter, JetBrains Mono) instead of silently falling back when they are not installed. Call them right after `init()`, before text in that family is first painted — GPUI caches a failed family lookup, so already-painted fallback text does not switch retroactively.
- 8c272d1: Mermaid fences in `<markdown>` get a rendering channel: ` ```mermaid ` blocks parse as their own block and render from a new `mermaid` map prop — app-supplied images (`{ src }`, typically data-URL SVGs) keyed by the fence source with outer whitespace trimmed, the same convention as the `math` map. Mapped fences paint as image blocks (natural size, clamped by `mdImageMaxHeight` like other markdown images); unmapped fences keep today's labelled `mermaid` code card, never a blank. GPUIV deliberately ships no diagram renderer — mermaid needs a real browser layout, so the producer (headless browser, build step, remote renderer) stays app-side.
- 435af61: Read-only `<markdown>` renders footnotes. `[^label]` references paint as numbered accent markers (`[1]`) in document order of first appearance, definitions render in place with the shared number, and clicking a reference emits `linkClick` with `footnote:<label>` so apps can scroll or preview. Previously references painted as the literal `[label]` and definitions vanished into the surrounding stream. Footnote numbering is global, so sources containing definitions take the same full-reparse path as link-reference definitions.
- 435af61: Markdown math: `$$…$$` display formulas render as centered SVG images. The new `@gpuiv/vue/math` subpath exports `renderMathMap(source, options?)`, which scans markdown for `$$…$$` / `$…$` (skipping code spans), renders each formula through MathJax headless (liteAdaptor, self-contained path SVGs, results cached), fixes glyph colour, rewrites ex units to px baked at 2× for crisp GPU downscale, and returns a map to pass as `<markdown math={map}>`. Unmapped display formulas fall back to the literal TeX in a muted card. `$inline$` formulas keep their TeX source visible as an accent mono run — inline baseline-aligned SVG runs need new text-layout mechanics and remain open (the map entries already carry the `depth` metadata that layout will need).
- 07526d4: Expose test-renderer resource ownership counts and GPUI entity leak baselines so apps can verify repeated mount and unmount cycles release their resources.
- 28ce86c: `AnimatePresence` keeps leaving children mounted until their exit animation finishes, matching Motion for React. `motion.div` gains an `exit` target and `onMotionComplete`; a child that leaves an `AnimatePresence` swaps `animate` for `exit`, and the node unmounts when the native track reaches the exit target. Completions are generation-aware, so a completion queued for a previous target never unmounts a node that retargeted, and offscreen virtual-list rows settle on schedule (motion now advances per frame over every declared track, not only during element builds). Custom components participate via `usePresence()` / `useIsPresent()`.
- c785e86: Multiple windows on macOS: `createWindow(root, options)` mounts a component in a new native window after `createApp`. Each window gets its own renderer, so element ids, events, focus, text selection, scroll state, automation bounds and paint logs stay per-window. Renderer state that used to live in process-wide thread-locals (automation bounds, the text-selection registry, paint logs, pending scrolls, the repaint-dirty flag) now lives on the window's view, and `GpuixRenderer` holds its own window handle. The returned handle's `close()` unmounts the tree, closes the OS window and drops the renderer from the frame loop.
- 157efc4: Multiple windows now work on Windows and Linux too: a second renderer's `init()` opens its window on the process's single GPUI UI thread instead of failing. Window-scoped commands (scroll, focus, window controls, automation queries) are addressed to their own window through the shared command channel, and closing a window removes it from the UI thread's window table.
- 4ccbf78: Animate background, text and border colors and single or multiple box shadows on the native frame clock. Preserve visible colors when reversing a transition, interpolate transparent colors without dark fringes, and allow explicit null color targets to restore the base style.
- 4ccbf78: Support CSS filter functions on native images through cached background processing. Preserve image layout, alpha edges, animation frame delays and source load events while applying color adjustments, blur and contour shadows.
- 364acfb: Support inset shadows and shadow arrays in native styles through GPUI's existing shadow API. Keep single shadows compatible, preserve CSS's first-shadow-on-top array order, and accept an empty array to clear the shadow stack.
  
  Restore Animal Island Switch inset depth and Progress fill highlights to match the React components.
- 811d00a: Support native `input type="password"` with masked paint, protected copy/cut, and real text editing, selection, and IME coordinates. Add configurable `placeholderColor` to native inputs and textareas, and pass Animal Island Input password mode and placeholder ink through to the native editor.
- 1c53356: Add `setTrayMenu` for native macOS and Windows tray menus with stable action IDs, separators, disabled entries, replacement and clearing, plus test-renderer support.
  
  Refs #50
  Refs #49
- a596d9b: Global shortcuts: `registerGlobalShortcut(renderer, accelerator, onTrigger?)` arms a system-wide hotkey that works with any app focused; registering the same accelerator again replaces it, and `unregisterGlobalShortcut(renderer, accelerator)` removes it. Accelerators are `'+'`-separated modifiers (`ctrl`, `alt`/`option`, `shift`, `cmd`/`win`/`super`) then one key (`a`–`z`, `0`–`9`, `f1`–`f12`). macOS uses Carbon `RegisterEventHotKey` (no accessibility permission needed, the AppKit loop pumps Carbon events); Windows uses `RegisterHotKey` on a message-only window (a combination another app claimed fails with a clear error). Linux reports unsupported — X11 `XGrabKey` does not survive Wayland.
- 4c9458f: `registerUrlScheme` now works on Windows and Linux instead of reporting unsupported. GPUI's platform ports leave the claim unimplemented, so the registration is done in GPUIV's own layer with the same per-user story the packager installs: Windows writes `HKCU\Software\Classes\<scheme>` candidate-handler keys (`URL Protocol` marker, quoted open command — the default-protocol claim remains the user's confirmation, Windows hash-protects protocol UserChoice), Linux merges `x-scheme-handler/<scheme>` into a per-user desktop entry and claims it via `xdg-mime`. Delivery (`onOpenUrls`) was already implemented on both platforms. The packager's `register` command also learned `win.urlSchemes` / `linux.urlSchemes` config for packaging-time declaration.
- c2ff4ed: `onLayout` on `<div>` and `<text>` reports the element's border box after its first paint and each time its size changes, with no polling of `getElementBounds`. The event payload gains `width` and `height`.
- 1f3d00a: `onScrollChange` on an `overflow: "scroll"` element reports its scroll offset whenever it moves — wheel, scrollbar drag, `scrollTo`, `scrollIntoView`, or content shrinking under the offset — complementing `onScroll`, which reports only the wheel delta before it is applied. The event payload gains `scrollX` and `scrollY`.
- e4f04a6: Add the `outline` style: a line outside the border box that takes no layout space, like CSS `outline`. Accepts `{ width, color, offset? }`; `offset` may be negative to draw the line inside. Combined with `focus`-visible styling it draws a focus ring that moves nothing, which a border cannot. Backed by `Style::outline` in the zed fork (`c0d597fd`), with the submodule bump also picking up keyboard-modality pointer-jitter suppression, duplicate tab-stop dedupe and test-window activation.
- 848c464: Add `getElementsAt(x, y)` for topmost-first element hit testing with clipping, deferred layers, and pointer-event handling. Read bounds, automation trees, and window sizes from the last completed frame without forcing paint or waiting for the UI thread; pass `forceRender: true` when a fresh frame is required. Preserve the last good window size when a native query fails.
- 60e41d8: Add `resizeWindow(width, height)` to request a window's content size at runtime, with positive finite dimensions and independent routing for each window.
- deda832: Interactive task lists in read-only `<markdown>`: `- [ ]` / `- [x]` items now render a real checkbox in the marker column instead of the literal `[x]` text. Clicking a checkbox fires a new `onTaskToggle` event carrying the marker's rendered state (`value`) and its byte offsets in `source` (`startIndex`/`endIndex`), so apps flip `[ ]`↔`[x]` in place and re-render. Checkbox geometry (`mdTaskBoxSide`, `mdTaskBoxRadius`, `mdTaskStroke`) joins the theme metrics. Ordered task items keep the number and paint the marker literally.
- 99a30d2: New style keys: `aspectRatio` sizes the indefinite axis from the definite one, `borderStyle: "dashed"` draws dashed borders, `alignItems` accepts `stretch` and `baseline`, and `justifyContent` accepts `space-evenly`.
- 211e859: Tab and Escape now have DOM-like defaults. Tab / Shift+Tab move focus through `tabIndex` elements and never type `"\t"` into a focused `<input>`; Escape closes the topmost open dismiss layer (Select, Combobox and Tooltip popups now close through it). The defaults run after every element `onKeyDown` and the render-level `onKeyDown`, so any handler can cancel one with the new `KeyEvent.preventDefault()`; `stopPropagation()` skips the ancestors and the window handler of the same keystroke. `createApp(App, { tabNavigation: false })` turns the Tab default off. Native key events carry a `keystrokeId` that groups one dispatch's element events and its trailing window event.
  
  animal-island's Modal, Drawer, Image preview and Upload preview keep their focus traps by cancelling the Tab default before walking the subtree.
- 2cbf95f: `<text>` accepts a `runs` prop for inline-styled segments: `runs={[{ text: "plain " }, { text: "bold", fontWeight: 700 }, { text: "err", underline: { wavy: true } }]}`. The runs replace any string children, including when the array is empty; non-text children remain. Per-segment `color`, `fontWeight`, `fontStyle`, `fontFamily`, `underline`, `strikethrough` and `backgroundColor` are supported; unset attributes fall back to the element's own style. Selection, search and copy keep working because they key off the concatenated string. Per-run font size is deliberately not offered — a size change would reflow the line.
- dbdd1dd: `scrollbarColor` paints a native scrollbar thumb: over an `overflow: "scroll"` container on each axis that has more to show, and over a `<virtual-list>`. The thumb follows the scroll offset in the frame it paints, sizes unmeasured virtual rows from the measured ones, takes no pointer input, and `scrollbarWidth` sets its thickness (default 6). Padding on a `<virtual-list>` now insets its rows on all four sides, with the thumb at the list's own edge.
- 194ce52: `<VirtualList>` grows sticky section headers. Pass `stickyIndices` (logical indices of header rows, ascending) and optionally `renderStickyHeader`; the active section's header pins at the top of the list as an overlay that paints above the rows and passes wheel, selection, and clicks through its host descendants, swapping when the next section's header crosses the top. The header content must paint its own opaque background. Backed by a new `getVirtualListGeometry(elementId, index)` renderer query — `[anchorIndex, viewportX, viewportY, viewportWidth, viewportHeight]` plus item bounds when measured — which is also the primitive for other scroll-driven UI. True in-flow sticky (headers pushed by their successor, interactive overlays) needs a GPUI List change and stays on the fork queue.

### Patch Changes

- 811d00a: Keep bounds polling on Windows and Linux from forcing and waiting for another frame. Share window-size polling between components on the same renderer and interval. Preserve fresh automation snapshots, avoid updating animated height, pattern surfaces, progress bars and carousels when only their screen position changes, batch active Skeleton animations on one timer, and keep distant Animal Island gallery sections out of the active render tree.
- 9f8bfdc: Return live automation bounds after the requested layout has painted on Windows and Linux, so newly mounted or repositioned controls have current click coordinates.
- db827bd: Canvas flushes rewrite their atlas tiles in place instead of re-allocating them. The zed fork grew `Window::update_image` (stable atlas uploads across Metal, wgpu and DirectX); each 256×256 canvas tile now keeps a stable `RenderImage` id and a dirty flush rewrites the existing atlas allocation (`replace_region` on Metal, `write_texture` elsewhere) at that tile's next paint. A stroke no longer churns tile allocations and `drop_image` round-trips while it repaints — only a canvas resize re-allocates. Also fixes a latent leak where a canvas resize discarded the retirement list of the tiles it replaced.
- 1d71992: Reduce CPU work for small brush strokes on large canvases by clearing only the previously used antialiasing coverage region between drawing operations.
- 8796694: Reduce Canvas 2D retained memory by storing raster coverage and clip masks in covered regions instead of full-canvas buffers, while preserving pixel output and dirty-tile uploads.
  
  Refs #49
- 1d71992: Upload only changed canvas tiles when distant brush strokes occur in the same frame, and refresh neighboring tile borders to keep scaled canvas edges consistent.
- 5600352: Coalesce macOS repaints into the frame loop. Every `applyBatch` used to draw a full frame (build + Taffy layout + paint) synchronously inside the FFI call — with live components flushing ~130 batches/s (spinners, bounds polls, streamed text) and scrolling rebuilding the largest part of the tree, that pinned a CPU core and dropped frames. Batches now only mark the tree dirty; the frame loop's `tick()` draws once per tick, which also caps the paint rate at the loop's 16ms cadence (~60fps). Same-frame paths (selection drag, IME) keep their explicit `window.refresh()`. Scroll CPU on the component gallery measured 100% → ~40% of a core; the frame loop's default interval moved from 8ms to 16ms to match the paint cap.
- 0e61dee: Reduce diff scrolling work by checking changed props instead of hashing the full patch every frame, and limiting offscreen row measurement to four code lines.
- 11b7de2: Empty text nodes no longer occupy layout space. Vue compiles `{items.map(…)}` sitting among JSX siblings into a Fragment wrapped in empty text anchors, and GPUIV shaped the empty string at the default line height — every mapped list next to siblings gained a phantom ~26px band above and below the rows (visible between a table's header and its first row). Empty text now renders zero-size, matching the DOM.
- 1f3d00a: `scrollIntoView` and `scrollToItem` on a plain `overflow: "scroll"` container scrolled to the wrong child or not at all: the internal bounds canvas was the scroll container's first paint-tree child, shifting gpui's child indices by one against the retained tree's. The canvas now paints after the user children, so indices align.
- 811d00a: Position centered floating menus and tooltips at the trigger's midpoint without applying the popup's size twice. Keep the Animal Island gallery header fixed and its scroll viewport filling the remaining window height.
- d2a05c5: Honor explicit transparent floating backgrounds and paint each surface fill once, with its drop shadows behind the fill. Animate the complete floating surface so translucent panels and SVG silhouettes retain their intended background during entrance motion.
- db48ea0: `loadFont` / `loadFontBytes` validate the font before handing it to the text system: a file that is not a TrueType/OpenType font, or whose family/full/PostScript name records are missing or unreadable, now fails the call with an error instead of aborting the whole process. The GPU test renderer also gained `loadFontBytes`, so tests can exercise custom fonts headlessly.
- 21f87c4: Text search keeps whole matches on non-trivial Unicode. Greek final sigma now matches exact uppercase words (`ΟΣ` finds `ΟΣ`), a case-insensitive hit that ends inside an expansion (like `İ` folding to `i` + combining dot) maps back to the complete original character, and projected ranges that overlap an earlier match are dropped instead of double-reporting. Every Unicode mark category now counts as part of a word for `wholeWord`, so decomposed accents no longer break matches — in the native matcher and in `findRanges` alike. Search needles are also compiled once per query instead of per text group, which trims per-keystroke highlight cost on long documents.
- 9f4fa9b: Hover ends when the pointer leaves the window. GPUI now clears hover state on the window-exit event (previously hover stuck to the last hit element until the pointer returned), and the test renderer gains `simulateMouseExit` / `nativeSimulateMouseExit(x, y)` so apps can regress the platform's no-final-move exit in GPU-backed tests.
- 811d00a: Keep Animal Island Input UTF-16 length limits from splitting emoji surrogate pairs. Preserve provisional IME text and apply the limit to the final full value, including compositions that end without a final change event. Treat negative and non-finite limits as unrestricted.
  
  Make native `valueRevision` corrections override pending value echoes even when Vue combines a changed value and revision in one render, so length corrections reach the actual editor.
- 05167b2: Paste shortcuts now propagate when the clipboard has no text. `Cmd+V` / `Ctrl+V` on an `<input>` or `<textarea>` reaches `onKeyDown` (element and window) when the clipboard is empty, image-only, or holds Finder-copied files, so applications can handle those pastes themselves. A read-only editor propagates too. Mixed text-and-image clipboard content still pastes its text natively.
- 89705dc: Enable GPUI's Wayland and X11 compositor-selection features explicitly on Linux. Our builds already inherited them through `gpui_linux`'s feature forwarding (and through `test-support`), so nothing was broken here, but published `--no-default-features` release builds now pin them independently of that chain — the same hardening upstream applied after their X11 builds silently opened no window (`cd9493a`, their #93). GPUI selects Wayland when `WAYLAND_DISPLAY` is non-empty, otherwise X11 when `DISPLAY` is; to force X11 under XWayland start with `env -u WAYLAND_DISPLAY`.
- d634380: Four retained-tree/frame-loop costs are gone. A re-render that changed nothing no longer wakes the window to redraw an identical frame. Focus sync visits only the elements that can take focus instead of every retained element each frame. Elements without listeners or custom props no longer allocate maps for them. `<div>` and `<text>` no longer add a hidden canvas child to record their bounds — the element's own paint reports its border box, so a frame lays out and paints far fewer nodes.
  
  `getElementBounds()` and locators now report the element's border box (like a DOM `getBoundingClientRect`). Two consequences: an element with a `borderWidth` is wider by the border than before, and a scroll container reports its viewport box, which no longer shifts with its own scroll offset — its content children still report screen coordinates that move with scrolling.
- 993101d: Keep early focus requests until their elements exist, while respecting later user focus changes.
- 07526d4: Release native input entities and other measurement captures after their UI subtree is removed, using a GPUI compatibility fix for Taffy 0.13 context retention.
- 07526d4: Release cached text and search matches when a highlighted subtree or its highlight declaration is removed.
- 60909c6: Fire focus and blur events in GPU-backed tests without activating the desktop window.

## 0.5.0

### Minor Changes

- e07e390: Expose GPUI accessibility through Vue `role` and `aria-*` props.
  
  A node is in the platform accessibility tree only with both a GPUI id (already set) and a role. VoiceOver, Accessibility Inspector, and other AX clients can now see labelled controls instead of an empty window.
  
  ```tsx
  <div
    role="button"
    aria-label="Delete note"
    aria-id="notes.delete"
    onClick={remove}
  >
    Delete
  </div>
  ```
  
  - Prop names match the DOM: `aria-label`, not `ariaLabel`
  - Role values are ARIA tokens (`"button"`, `"heading"`). `"none"` / `"presentation"` produce no node
  - `<text>` defaults to `Label`, `<input>` to `TextInput`, `<textarea>` to `MultilineTextInput`, `<img>` to `Image` with `alt`
  - `onClick` registers AccessKit Click, so VoiceOver Press fires the same JS handler
  - `<virtual-list>` and `<anchored>` accept `role` / `aria-*` too
  - `renderer.getA11yTree()` on the test renderer dumps the tree for tests
- b728ab4: Add `onAuxClick` for the non-primary mouse buttons.
  
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
- dcddaf3: Add per-side border widths and one structured `boxShadow` style with offset, blur, spread, and color values.
- 4e76b98: Add data URL sources to `<img>` for rendering images created or loaded in memory.
  
  ```tsx
  const src = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`
  
  <img src={src} style={{ width: 240, height: 140 }} />
  ```
  
  Base64 and percent-encoded data URLs support PNG, JPEG, WebP, GIF, SVG, BMP, TIFF, ICO, and Netpbm images. `<svg src>` accepts the same base64 data URLs.
  
  Upstream: remorses/gpuix#35
- 3e76d0e: Add `onFileDrop` for Finder and OS file drops.
  
  Drop files onto any host element and receive the absolute filesystem paths:
  
  ```tsx
  <div
    onFileDrop={(event) => openFiles(event.paths ?? [])}
    style={{ width: 400, height: 300 }}
  />
  ```
  
  - `event.paths` is `string[]` of absolute Unicode paths; `event.x`/`event.y` is the drop point in window pixels
  - an empty drop, or a drop containing a non-Unicode path, never fires
  - nested targets keep working: GPUI stops propagation after a matching drop, so the innermost listener wins
  - works on `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `markdown`, `diff`, and `anchored` — `<virtual-list>` is not a host div, wrap it
  - desktop only
  - tests: `app.renderer.nativeSimulateFileDrop(x, y, paths)` drives the real GPUI drop pipeline
- e81ef0b: Add a window-level `onSelectionChange` callback so apps can react when the text selection changes.
  
  Pass it to `createApp()`, the same way as `onKeyDown`. The payload is a normal `EventPayload`. `value` is the joined selected text, or omitted when the selection is empty.
  
  ```tsx
  createApp(App, {
    onSelectionChange(event) {
      lastSelected.value = event.value ?? ''
    },
  })
  ```
  
  The event fires once per real change, including a clear. An unchanged frame does not fire.
- b596082: Add a `highlight` prop for text search, with `useTextSearch` driving a find bar.
  
  `highlight` paints a wash under every match in a subtree, like browser find. Declare it on any element — the nearest declaration wins, nested declarations are skipped — and `onHighlight` reports the match count after the build that resolved it.
  
  ```tsx
  import { useTextSearch } from '@gpuiv/vue'
  
  const search = useTextSearch({ query: 'needle' })
  
  <div v-bind="search.props">
    <text>one needle here</text>
    <text>another needle</text>
  </div>
  ```
  
  - A match never crosses a line, but it does cross the host nodes the renderer makes for one interpolated line, so `<text>Hello {name}!</text>` matches `Hello Tommy`.
  - Matches are numbered in **paint order**, so `activeIndex` means "the nth match in the document" whether a `<text>` or a `<code>` painted it. `<code>`, `<markdown>` and `<diff>` match the exact string they paint (`query` only; explicit `ranges` index retained text).
  - Explicit `ranges` are `[start, end)` pairs in UTF-16 code units, the units `indexOf` and `RegExp.exec` return.
  - Virtualized content: a `<virtual-list>` only mounts a window of rows, so pass your own bookkeeping — `matches: { total, indexOffset }`, both MATCH counts summed with the exported `findRanges` (the same matcher, in JS).
  - Resolution is cached on two levels: a query change never re-walks the subtree (keyed on a new `searchRevision`, not the general revision), and moving the find cursor only re-colours what was already found.
  
  Tests: `renderer.getPaintedHighlights()` returns every wash painted in the last frame, in paint order, with `active` flags and rects.
- 561668d: Require atomic renderer mutation batches, and decode them into typed ops with styles shared by content.
  
  The renderer no longer exposes separate `createElement`, `setStyle`, `setText`, `setCustomProp`, or `commitMutations` calls. Vue collects these operations and sends one validated `applyBatch(json)` batch per flush, on the live window and in the test renderer.
  
  **Breaking (renderer/test API):** `TestGpuixRenderer` and the `NativeRenderer` TypeScript interface lost the per-op mutation methods; drive mutations through `applyBatch` (the Vue host config and `createTestApp` already do). The wire format is now nine ops; `removeChild` and `setCustomPropValue` are gone (`destroyElement` unlinks from its parent in Rust), and `setStyle` / `setCustomProp` carry raw JSON values instead of nested JSON strings.
  
  Rust now decodes a batch straight from its JSON bytes into typed ops — strings borrow from the input, styles stay raw until apply — and hash-conses identical style payloads into shared `Arc`s before applying, so a failed batch leaves no residue. On the 10k-turn chat benchmark (221k ops), parse+apply drops from ~127 ms to ~30 ms and the retained tree from ~225 MB to ~43 MB.
- 1ac2e1d: Add drag, hover, wheel, and modifier keys to the automation API.
  
  The protocol already carried `mouseDown`, `mouseMove`, `mouseUp`, and `scrollWheel`, but nothing exposed them, so a drag or a pan could not be driven from a test.
  
  ```ts
  await app.getByTestId('clip-7').dragBy(120, 0, { steps: 6 })
  await app.getByTestId('clip-7-trim-end').dragTo(app.getByTestId('clip-8'))
  await app.getByTestId('canvas').wheel(0, 120, { modifiers: 'cmd' })
  await app.getByTestId('row-3').hover()
  
  await app.mouse.drag({ x: 240, y: 500 }, { x: 700, y: 620 })
  await app.mouse.wheel({ x: 700, y: 600 }, -140, 0)
  await app.mouse.down({ x: 100, y: 100 }, { button: 2 })
  ```
  
  | Call | What it does |
  |---|---|
  | `locator.hover()` | Moves the pointer to the center, so hover styles and tooltips fire |
  | `locator.wheel(dx, dy)` | One wheel event over the center |
  | `locator.dragBy(dx, dy)` / `locator.dragTo(target)` | Press, travel, release |
  | `locator.center()` | The center of the last painted bounds |
  | `app.mouse.move / down / up / click / wheel / drag` | Raw pointer input in window coordinates |
  
  A drag sends **interpolated moves**, not one jump, because snapping, live previews, and per-move commits only appear when the pointer travels. Pass `steps` to control how many, and `offset` to press away from the center.
  
  Every mouse call takes **`modifiers`** in the same hyphenated syntax as `press('cmd-a')`, so cmd-wheel zoom, shift-click range selection, and alt-drag duplication become testable.
  
  Three supporting fixes:
  
  - **`launch()` can scroll and type.** The production renderer gained `simulateScrollWheel` and `simulateKeystrokes`/`simulateKeyDown`/`simulateKeyUp`, so automation against a child process no longer throws there.
  - **`<input>` and `<textarea>` are locatable.** Custom elements paint themselves, so nothing registered their box for automation; a locator on an editor failed with "Element has no painted bounds".
  - **`textContent()` reads descendants.** It returned the node's own text only, so `<text testId="x">{value}</text>` came back empty. It now concatenates in document order, like DOM `textContent`.
- 27ed1e8: Launch a window without stealing focus, or with no window at all.
  
  `createApp()` takes two new window options. `focus: false` opens the window behind whatever app you were typing in, exactly like `open -g`. `show: false` opens nothing at all, so the process boots with a live Vue tree and an empty screen.
  
  ```tsx
  createApp(App, { title: 'Notes', focus: false })
  ```
  
  **Turn this on whenever a coding agent runs your app.** An agent that starts the app to check its work otherwise yanks the window in front of you, mid-sentence, once per iteration. Automation never needs focus: `click()` hits the last painted bounds and `screenshot()` reads the GPU surface, so both work on a background window and even on a `show: false` window that is not on screen. Drive it from the environment so a human run still behaves normally:
  
  ```tsx
  createApp(App, { focus: process.env.GPUIX_BACKGROUND !== '1' })
  ```
  
  ```ts
  const app = await launch({
    command: 'bun',
    args: ['app.tsx'],
    env: { GPUIX_BACKGROUND: '1' },
  })
  ```
  
  Before this, `init()` called `cx.activate(true)` unconditionally on every platform, so a GPUIX app always jumped to the front on launch. That call is now gated on `focus`. The window flag alone is not enough: on macOS it only decides whether the window becomes *key inside* the app, while activation is what pulls the whole process forward. Both had to change together.
  
  The new `activateWindow()` brings the window forward and focuses it. It is the only way to reveal a `show: false` window.
  
  ```tsx
  import { useGpuixRequired } from '@gpuiv/vue'
  
  function Reveal() {
    const renderer = useGpuixRequired()
    return <div onClick={() => renderer.activateWindow?.()}>Show</div>
  }
  ```
  
  Platform support comes straight from GPUI's `WindowParams`:
  
  | Platform | `focus: false` | `show: false` |
  | --- | --- | --- |
  | macOS | orders in front without becoming key | honored |
  | Windows | `SW_SHOWNOACTIVATE` | honored |
  | Linux | **ignored** | **ignored** |
  
  The macOS Dock icon still appears. GPUI hardcodes the regular activation policy, so a menu-bar-agent app would need a fork change; nothing upstream configures it today. Use a `launchd` agent for a real background daemon.
  
  `fill()` and `press()` still do not work against `launch()`; the live renderer has no `simulateKeystrokes` and throws `keystrokes are not live yet`. That is unrelated to focus. Use `createTestApp()` when a check needs typing.
- f99e005: Rasterize the separable `globalCompositeOperation` blend modes on `<canvas>`.
  
  Assigning `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, or `exclusion` now blends per the W3C *Compositing and Blending Level 1* spec instead of silently rendering as `source-over`. The blend runs in straight (un-premultiplied) colour space and composites onto the premultiplied buffer, so translucent backdrops, `globalAlpha`, coverage edges, and `drawImage` all keep their alpha semantics.
  
  The non-separable modes (`hue`, `saturation`, `color`, `luminosity`) remain unimplemented and now **throw** when assigned, like the text APIs — they are also removed from the `GpuixCompositeOperation` type. Unknown values are still ignored, matching the DOM.
- c4b174a: Canvas uploads are now dirty-rect: the native store keeps a CPU mirror of each canvas and paints it as a grid of 256×256 texture tiles, so a flush splices only the region the drawing ops touched and re-uploads only the tiles that region intersects. Upload cost scales with the dirty area instead of the canvas size — a 64×64 brush dab on a 2880×1920 canvas moves ~0.4 MB instead of ~22 MB, and a flush with nothing pending uploads nothing and skips the repaint. `GpuixCanvas.uploadPixels` and `renderer.uploadCanvasPixels` accept an optional `[x, y, w, h]` dirty rect for manual buffer control, and the 2D context path (`uploadCanvasFromContext`) tracks its own dirty region from each op's bounding box. Replaced tiles are freed from the sprite atlas on the next render, which also fixes atlas growth during long drawing sessions.
- 86dcd13: Add a native `<canvas>` element with a JS→Rust pixel bridge: `uploadCanvasPixels(elementId, width, height, pixels)` pushes a full RGBA buffer that GPUI paints as a GPU texture (pixels ride a dedicated FFI call, never the mutation JSON), `readCanvasPixels(elementId)` reads the last upload back, and the Vue `<GpuixCanvas>` wrapper exposes both plus its host id through a template ref. Also close three pointer-semantics gaps: a `contextMenu` event (right-button release, like macOS), `setPointerCapture` / `releasePointerCapture` commands on top of gpui's pointer capture, and a `stopWheelPropagation` prop that keeps ancestor scrollers from consuming wheel gestures (the async FFI cannot do the DOM's synchronous `preventDefault`).
- c37efe7: Add canvas PNG export. The `GpuixCanvas` instance gains `toDataURL()` and
  `toBlob(callback)` over a new renderer command `canvasToPng(elementId)`,
  which encodes the last uploaded buffer with Rust's `image` crate. Any
  requested type falls back to PNG (the DOM's unsupported-type behavior);
  before the first upload both report null instead of encoding a transparent
  bitmap. Together with the file dialogs and clipboard image APIs this
  completes the export-image loop for drawing apps. Part of the issue #49 P1
  gap work.
- f9959a4: Moved the `<canvas>` 2D rasterization core into the native package. Drawing
  now records into a Rust-side display list and rasterizes once per flush — on
  upload or on a pixel read — so pixel buffers no longer round-trip through
  JS: `renderer.uploadCanvasFromContext(elementId, ctx)` pulls straight from
  the native core, and `getImageData` reads it synchronously. The complete
  Canvas 2D JS API is unchanged, and the vendored WPT conformance suite keeps
  pinning it (452 green / 141 skipped, same as before the move). Update
  `@gpuiv/native` and `@gpuiv/vue` together — the new facade flushes through
  the new native method.
- b754b13: Add clipboard image read/write. `writeClipboardImage(data, width, height)`
  encodes straight-alpha RGBA pixels as PNG onto the system clipboard
  (GPUI `ClipboardItem::Image`); `readClipboardImage()` decodes whatever image
  the platform stored back to RGBA, or returns null when the clipboard holds no
  image. The test renderer runs the same encode/store/read round trip against
  the test platform's in-memory clipboard. Part of the issue #49 P1 app-shell
  gap work.
- 66a95d8: Add clipboard text read/write via `readClipboardText` and `writeClipboardText`, mirroring the existing clipboard image API.
- 3df90f6: Map the full CSS cursor keyword set onto GPUI's cursor styles. `cursor` now accepts `crosshair`, `text`, `vertical-text`, `grab`, `grabbing`, `move`, `all-scroll`, `context-menu`, `not-allowed`, `no-drop`, `alias`, `copy`, `col-resize`, `row-resize`, the `ew/ns/nesw/nwse` and directional `n/e/s/w/ne/nw/se/sw` resize keywords, and `auto`/`default` — previously only `pointer` and `default` worked and every other value was silently ignored.
  
  Keywords GPUI cannot show (`none`, `url(..)`, `wait`, `progress`, `help`, `cell`, `zoom-in`, `zoom-out`) now log a one-time dev warning instead of failing silently. The `cursor` style type is narrowed to the supported keywords in `@gpuiv/vue`. Hiding the cursor (`cursor: "none"` for brush cursors) and custom image cursors need a GPUI fork change and remain unsupported.
  
  Part of the drawing-app gap audit (#49).
- 59ff89f: Deep links. `onOpenUrls` registers the handler for URLs the platform asks the app to open (deep links, files dropped on the Dock icon); `registerUrlScheme(scheme)` registers the app as the handler for a URL scheme such as `myapp://`, resolving on success and rejecting with the platform's reason otherwise (macOS requires 12+, a bundle id, and an installed app; Windows and Linux report unsupported).
- d48f928: Incremental diff parsing for streamed patches. `<diff>` now keeps a streaming parse state: appending to `patch` reparses only from the last stable boundary (the last file's last hunk, or its header while hunk-less), so completed files are never re-parsed or re-word-diffed as tokens arrive. A source truncated mid-line is completed by the append rather than leaving a stale partial row, and non-append edits reset cleanly. Parsed output is identical to a full parse (parity-tested across streamed corpora, including renames, bare hunks, and truncated tails).
- 66a95d8: Add runtime menu bars via `setMenus(menus, onAction)`. Items fire their `id` back to JS, `system` items keep built-in behaviors (quit, hide, window controls), and `keystroke` items show their key equivalent in the menu. macOS only.
- 1651f7f: **BREAKING:** `getElementBounds` returns `{ x, y, width, height }` instead of `[x, y, width, height]`.
  
  The array form could not grow — extra fields like scroll offsets would have had to sit at magic indexes. The native napi method, `TestGpuixRenderer`, the Vue `TestRenderer`/`app.renderer` facade, and the live automation client all use named fields now. Update destructuring call sites:
  
  ```diff
  -const [x, y, width, height] = renderer.getElementBounds(id)!
  +const { x, y, width, height } = renderer.getElementBounds(id)!
  ```
- b5f2c0d: Add native file dialogs. `promptForPaths` opens the platform file-selection
  panel and `promptForNewPath` the save panel; both answer asynchronously (the
  dialog result arrives on the Node event loop, nothing blocks) and resolve with
  `null` when the user cancels. `@gpuiv/vue` exports Promise wrappers with the
  same names, and the test renderer answers from a canned queue
  (`setNextPathPromptResponse` / `setNextNewPathResponse`) so app flows are
  testable end-to-end. Part of the issue #49 P1 app-shell gap work.
- a344912: Add focus-within APIs and map `visibility: "hidden"` to GPUI `invisible()`.
  
  - `getFocusedElementId()` returns the host id of the focused element, or `null`
  - `focusNextWithin(elementId)` / `focusPreviousWithin(elementId)` move focus to
    the next / previous tab stop inside that subtree, wrapping in it — the
    primitive behind modal focus traps
  - `visibility: "hidden"` now skips painting while keeping the layout box
    (maps onto GPUI `invisible()`)
  
  The walk reads GPUI's painted TabStopMap (`focus_next_among` /
  `focus_prev_among`), so it needs the zed submodule bump that ships with this
  change.
- 566ba4e: Font fallback configuration. The theme now accepts `fontSansFallbacks` / `fontMonoFallbacks` family lists, applied everywhere the theme fonts are used — `<code>`, `<diff>`, and `<markdown>` content and chrome. Absent lists keep the platform's own font cascade (CoreText on macOS); set them to pin CJK/emoji coverage on Windows and Linux.
- 96f9569: Add `getDebugFrameOverlayStats()` so tests and apps can read the same draw times the on-screen overlay shows.
  
  ```ts
  renderer.resetDebugFrameOverlayStats()
  // ... scroll or click ...
  const stats = renderer.getDebugFrameOverlayStats()
  // stats.currentMs, stats.p90Ms, stats.p99Ms, stats.maxMs, stats.frames, stats.samples
  ```
  
  `p90Ms` is the overlay **10%** line. `p99Ms` is the **1%** line. Those are the slow tail, not the fast frames.
  
  The chat example uses this in `examples/chat.perf.test.tsx` to catch mount, wheel, and sidebar regressions.
- 9df699a: Accept the full csscolorparser 0.8.3 string grammar across styles, themes,
  pseudo-states, selection colors, SVG tint, borders, and shadows. This adds
  modern RGB/HSL/HWB, HSV, LAB/LCH, OKLab/OKLCH, named, transparent, alpha,
  `none`, and limited relative-color forms without changing TypeScript types.
- db8bed4: Give every interactive host surface a stable GPUI identity, so the props you can already write actually do something.
  
  **`hover` and `active` work on every element, not only `<div>`**
  
  `StyleDesc` always accepted `hover` and `active`, but only `<div>` consumed them. On `<text>`, `<input>`, `<textarea>`, `<code>`, `<markdown>`, `<diff>`, `<img>`, `<svg>` and `<anchored>` the style type-checked, crossed the bridge, and was dropped. All of them apply it now.
  
  ```tsx
  <code
    code={source}
    language="ts"
    style={{ backgroundColor: '#1e1e2e', hover: { backgroundColor: '#313244' } }}
  />
  ```
  
  `<virtual-list>` is the one exception, and its `style` type no longer accepts them: gpui's `List` has no interactive identity to hold a hovered or pressed state. Put those on a wrapping `<div>`.
  
  **`<text>` is a real element**
  
  `<text>` had its own builder that ignored every interaction prop on the shared props surface. `onClick`, `onMouseEnter`, `onKeyDown`, `autoFocus`, `tabIndex` and pointer capture all registered a listener and then never fired. `<text>` and `<div>` now go through one builder, so a text node behaves like any other element.
  
  ```tsx
  <text style={{ padding: 8, hover: { color: '#f38ba8' } }} onClick={select}>
    {label}
  </text>
  ```
  
  One behaviour change comes with that. A `<text>` with an opaque `backgroundColor` now **takes mouse hits**, like an HTML element with a background, so it stops clicks and hovers reaching whatever is behind it. The wheel still passes through to a scroll container. The old text builder inserted no hitbox at all, so a filled label was transparent to the pointer. Set `pointerEvents: 'none'` to get the old behaviour back.
  
  **Events reach `<img>`, `<svg>` and `<anchored>`**
  
  Those three declared no supported events, so `onClick`, `onMouseEnter` and `onMouseLeave` type-checked, registered a listener, and never fired. This was the same defect as `<text>`, in three more places.
  
  ```tsx
  <img src={avatar} onClick={openProfile} />
  <anchored side="bottom" onMouseLeave={close}>{items}</anchored>
  ```
  
  **`active` no longer needs an unrelated click handler**
  
  An `active` style with no `onClick` painted nothing. gpui only inserted the hitbox that tracks the press when the element had some *other* reason for one, so the press was never recorded. Fixed in gpui itself (submodule bump) rather than by attaching an empty click listener.
  
  **Automation can click anything**
  
  `<img>`, `<svg>` and `<anchored>` accepted `testId`, appeared in the automation tree, and then threw `Element has no painted bounds` on `click()`. They record their box now. An `<anchored>` reports the **overlay's** final position, after deferral and window snapping, not the trigger's.
  
  ```ts
  await app.getByTestId('menu').click()
  ```
  
  **Animated GIFs animate**
  
  `<img>` built a gpui image with no element id, so `ImgState` (the frame index and the delayed loading placeholder) was thrown away every frame and an animation never left frame zero.
  
  **One renderer, one root**
  
  Mounting a second root on a renderer that already drives one throws instead of silently taking over its window, its native root id, and its event map. `createApp()` unmounts the previous tree first, so remounts (including `bun --hot`) are unaffected.
  
  **Test renderer: `getRetainedElementCount()`**
  
  `getTreeJson()` walks from the root, so it cannot see a node that was detached and never destroyed. The new `renderer.getRetainedElementCount()` is the only way a test can prove a removal actually freed a node. The Vue host config already frees removed text nodes (Vue's `remove` op covers them); a regression test now pins that.
- 66a95d8: Emit DOM-style IME composition events from `<input>`/`<textarea>`: `onCompositionStart` fires once when marking begins, `onCompositionUpdate` on every marked-text change, and `onCompositionEnd` on commit or cancel, so apps can gate shortcuts and UI on active composition. The test bridge gains `simulateMarkedText`, `simulateImeCommit`, and `simulateImeCancel`.
- 9e95662: Add http(s) `src` support to `<img>`.
  
  GPUI fetches the URL in the background and paints when decode finishes. The Vue tree does not wait. Pass both `width` and `height` so the box does not jump after load.
  
  ```tsx
  <img
    src="https://example.com/avatar.png"
    objectFit="cover"
    style={{ width: 48, height: 48, borderRadius: 24 }}
  />
  ```
  
  Filesystem paths and data URLs still work. Failed loads still show the existing fallback placeholder. A definite `width` and `height` now also pin `aspect_ratio`, keeping the layout box stable for any source.
- 0994348: Install the macOS application menu bar, so a GPUIV app answers `⌘Q`, `⌘H`, `⌥⌘H`, `⌘M` and `⌘W` instead of showing an empty menu bar.
  
  GPUI never calls `NSApplication.setMainMenu:` on its own, so `NSApp.mainMenu` stayed nil. macOS paints nothing next to the Apple menu, and the standard shortcuts do not exist either, because AppKit only provides them through menu items. There was no way to quit a GPUIV app from the keyboard.
  
  ```
  Apple    <appName>                Window
           ├ Services               ├ (AppKit window tiling)
           ├ Hide <appName>   ⌘H    ├ Minimize          ⌘M
           ├ Hide Others     ⌥⌘H    ├ Zoom
           ├ Show All               ├ Close Window      ⌘W
           └ Quit <appName>   ⌘Q    └ (open windows)
  ```
  
  New `appName` window option for the name inside `Hide X` and `Quit X`. It defaults to `title`.
  
  ```tsx
  createApp(App, { title: 'Todo', appName: 'Todo' })
  ```
  
  The **title of the application menu comes from the executable**, not from `appName`. macOS reads it from the running binary, so `bun app.tsx` shows `bun` and a `bun build --compile` binary shows its own file name. Only a real `.app` bundle changes it.
  
  There is **no Edit menu**, on purpose. AppKit consumes a menu key equivalent before the window sees the key event, so an Edit menu carrying `⌘C` would take the keystroke away from cross-element text selection and from `<input>`.
- d91c23d: Add `layerShell` and `appId` to `WindowOptions` so a window can open as a Wayland `wlr-layer-shell` surface.
  
  `render(App, { layerShell })` opens the window as a compositor-anchored surface (bar, dock, notification overlay, wallpaper) instead of a normal floating window: no native titlebar, positioned by its `anchor` rather than by the window origin, with an optional `exclusiveZone` so tiled windows keep clear of it.
  
  ```tsx
  render(Bar, {
    appId: 'my-panel',
    height: 34,
    focus: false,
    layerShell: {
      namespace: 'my-panel',
      layer: 'top',
      anchor: ['top', 'left', 'right'],
      exclusiveZone: 34,
      keyboardInteractivity: 'none',
    },
  })
  ```
  
  Options map to GPUI's `WindowKind::LayerShell(LayerShellOptions)`: `layer` (`background` | `bottom` | `top` | `overlay`), `anchor` (any of `top` / `bottom` / `left` / `right`; two opposite edges stretch that axis), `exclusiveZone`, `exclusiveEdge`, `margin` (`[top, right, bottom, left]`), `keyboardInteractivity` (`none` | `on-demand` | `exclusive`). Linux/Wayland only; ignored on macOS and Windows. `appId` also sets the Wayland `app_id` / X11 `WM_CLASS` on a normal window.
- d9c32bb: Add native two-stop linear gradients to the `style.background` API (upstream `09e0cae`).
  
  ```tsx
  <div
    style={{
      background: {
        type: 'linear-gradient',
        angle: 90,
        stops: [
          { color: '#7c3aed', position: 0 },
          { color: '#06b6d4', position: 1 },
        ],
        colorSpace: 'oklab',
      },
    }}
  />
  ```
  
  Gradients use GPUI's GPU shaders on every renderer. They support CSS angle
  direction, rounded corners, `srgb` or `oklab` interpolation, and native
  `hover` and `active` styles. A transparent gradient does not block the mouse,
  matching a transparent color.
- 66a95d8: Render standalone markdown images (`![alt](url)`) as image blocks inside `<markdown>`. A paragraph holding only images produces one image block per image, with data-URL and http(s) sources reusing the `<img>` load pipeline; an image among text still renders as its alt text with link styling. Height is capped by the new `mdImageMaxHeight` theme metric (default 320) and an unloadable image falls back to its alt text.
- 8f03c33: Incremental markdown parsing for streamed sources. `<markdown>` now keeps a streaming parse state (ported from Comet's `IncrementalParser`): appending to `source` reparses only from the last stable top-level block boundary, so token-by-token output costs O(tail) per update instead of a full-document reparse. Completed blocks are shared between frames; sources containing link-reference definitions fall back to full reparses for correctness, and non-append edits reset cleanly. Rendered output is byte-for-byte identical to a full parse (parity-tested across streamed corpora).
- 66a95d8: Rasterize the non-separable blend modes: `hue`, `saturation`, `color`, and `luminosity` now paint through the W3C Compositing and Blending §5. operators instead of throwing, completing the `globalCompositeOperation` palette for layer blending.
- 8d7e0fa: Add `openUrl(url)`: hands a URL to the user's default browser / handler via
  GPUI's `App::open_url`, for links that must leave the app (OAuth, payment
  pages). The test bridge records the last URL (`getLastOpenedUrl`) for
  assertions. Part of the issue #49 P1 app-shell gap work.
- 4192dde: Wire pinch gestures end to end. Any element (including `<canvas>`) can now take an `onPinch` listener: each step carries `x`/`y` (the pinch center), `zoomDelta` (0.1 ≈ a 10% zoom-in, accumulate it into a scale like a browser zoom handler), `touchPhase` (`started`/`moved`/`ended`/`cancelled`) and `modifiers`. Trackpad pinches already arrive from GPUI on macOS, Windows and Linux; they now reach Vue handlers.
  
  Automation gained synthetic pinch: the `pinch` protocol method, `app.mouse.pinch(target, delta, { phase, modifiers })`, `locator.pinch(delta, options)`, and `nativeSimulatePinch` / renderer `simulatePinch`, so tests drive the gesture deterministically through the GPUI input pipeline.
- b708e1b: Add native titlebar drag regions and a zoomWindow command for custom desktop app shells. Add cancellable smooth scroll controllers with stable-offset completion, AbortSignal support, and component-unmount cleanup.
- 964e5f5: Extend `<input>`/`<textarea>` into a styled-text editing surface. New props: `spans` (inline styled runs — weight, italic, underline, strikethrough, background, color, family — at UTF-16 offsets with IME preedit underline preserved; boolean `underline`/`strikethrough` inherit the run's text color), `decorations` (search-style range highlight quads), `selection` (programmatic UTF-16 anchor/head), `valueRevision` (authoritative re-sync that bypasses echo suppression) and `interceptClipboard` (clipboard keybindings become events instead of native edits). New events: `selectionChange` (paint-time deduped UTF-16 anchor/head), `copy`/`cut`/`paste` (intercepted clipboard intents), `undo`/`redo`/`selectAll` (routed to the host when a listener is registered, native undo stack / select-all skipped), `backspaceStart` (backspace with empty selection at offset 0, for cross-block joins) and `contextMenu` (right-button release with window coordinates; a right-button press focuses the editor and places the caret when the selection is empty). `style.textAlign` is now honored when painting. New test APIs: `getPaintedInputRuns(elementId)`, `getInputDecorations(elementId)`, `getInputTextPosition(elementId, offset)` and `getInputTextOffset(elementId, x, y)`.
- 66a95d8: Streamed code blocks highlight incrementally: an appended source now resumes Syntect parsing from a stable-prefix checkpoint (the previous last line) instead of re-parsing the whole document, so token-by-token streaming costs work proportional to the new tail. `getSyntaxCacheStats` reports the new `streamHits` counter.
- 6e8ead0: Sync upstream GPUIX changes through `remorses/gpuix@367ef48` (desktop subset):
  
  - **Pointer capture**: `onMouseMove` / `onMouseUp` keep firing after the pointer
    leaves the element that received `onMouseDown`, matching HTML
    `setPointerCapture`. Uses GPUI's native pointer capture.
  - **Virtual-list windowed rows keep `estimatedItemHeight`** when Vue has not
    mounted them, so a jump past the mounted window no longer collapses the
    scrollbar. `itemCount` now requires `estimatedItemHeight` (TypeScript
    enforces it; native ignores `itemCount` without it).
  - **`useWindowInsets()` hook + `getWindowInsets()`**: safe-area and
    software-keyboard geometry, sampled every 100ms by default.
  - **`<markdown>` wraps in flex columns** (`min-width: 0`), fenced code scrolls
    on X like `<code>`, and `<markdown>` / `<code>` / `<diff>` record painted
    bounds so `testId` locators and `getElementBounds` work on them.
  - Copy shortcuts route through the GPUI root key listener; a tap arms text
    selection instead of selecting immediately (drag promotes it).
  - `zed` submodule tracks the `gpuix` branch of `remorses/zed`.
- 13e1ef1: Replace Tree-sitter with **Syntect** for native syntax highlighting. `<code>`, `<diff>`, and Markdown fences still detect language the same way and still paint from the theme palette. Token classes stay `HighlightKind` values, not baked-in colours, so a theme change recolours existing spans without a reparse.
  
  The highlighter now uses Syntect's **pure-Rust fancy-regex** engine. There is no Tree-sitter runtime and no per-language C grammar in the native binary.
  
  ```tsx
  <code code={source} language="typescript" />
  <markdown text={'```rust\nfn main() {}\n```'} />
  <diff patch={unified} />
  ```
  
  Language detection is unchanged: fence tag, then path, then shebang. Unknown languages still render as plain text.
  
  Token colours can shift a little versus Tree-sitter, because Syntect scopes are not the old capture names. The public `HighlightKind` contract and the JS theme override path are the same.
- 9e2e946: System notifications. `showSystemNotification` posts to the OS notification center (same-tag notifications replace each other where the platform supports it; the effective tag is returned so untagged ones can still be dismissed), `dismissSystemNotification` retracts by tag, and `onSystemNotificationResponse` receives body clicks and action-button presses. `setAppIdentity` sets the process identity Windows attributes toasts to and the user-visible app name. On macOS, notifications only deliver from a packaged `.app` bundle — a bare `bun` process is skipped by the platform's bundle guard.
- 33b0bc4: `TestGpuixRenderer` now runs on **Windows** through DirectX, so Windows users can write GPU-backed tests for their own apps. CI runs the full Vue and example suites on a Windows GPU runner.
  
  | Platform | Test renderer | PNG capture |
  |---|---|---|
  | macOS | Metal | Yes |
  | Windows | DirectX | Yes |
  | Linux | Not yet | Waiting for GPUI's wgpu headless renderer |
  
  Also: the test renderer constructor takes an optional window size (`new TestGpuixRenderer(320, 200)`, or `createTestApp(Component, { width, height })`), and the offscreen test window is torn down like a real unmount — tree root cleared, custom element instances destroyed, then one empty frame painted — so entity handles never outlive the app (the gpui leak detector only exposed this once Windows ran the suite).
- 3fbf047: Make `<code>` a bare surface. It paints glyphs only now: no fill, no border, no
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
- 030fede: Virtual-list scroll pinning and a pixel-preserving anchor API, so a feed can prepend rows and an infinite-scroll history can land a page without moving the message the reader is looking at.
  
  - A top-aligned list scrolled to the very top **stays at the top when rows are prepended**, matching the browser. Away from the top, the anchor keeps the rows on screen exactly where they are. A `followTail` list that has not filled its viewport keeps following the tail.
  - `scrollToItem(index, offsetInItem?)` gains a pixel offset that **may be negative**, anchoring the viewport top above the row. gpui resolves it at layout time against freshly measured rows, so a restore after a prepend is pixel-exact rather than estimate-based. Virtual-list scrolls are queued and applied after that frame's child splice, so an index computed against a just-committed child list is never shifted twice.
  - `getListScrollTop(listId)` reports the logical anchor `[itemIndex, offsetInItemPx, viewportHeightPx]` — exact even while row heights are still estimates, unlike the pixel-space `getScrollOffset`. `itemIndex == itemCount` is gpui's at-end sentinel; the viewport height converts it into a position relative to the trailing rows.
  - The Vue `<VirtualList>` wrapper exposes the pair through a template ref — `scrollToItem(index, offsetInItem?)`, `getListScrollTop()` returning `{ itemIndex, offsetInItem, viewportHeight, atEnd }` with the sentinel decoded, and the host element `id` — and widens its mounted window to cover the scroll target before the scroll lands.
- 5a908a4: Add Vue 3 bindings for GPUI as `@gpuiv/vue`: a custom renderer that mounts Vue components on the native GPUI retained tree through the same mutation protocol as the React bindings, with GPU-backed testing (`createTestApp`), automation (`connectTest`), native motion support, and `@gpuix/native` renamed to `@gpuiv/native`.
- dec1f08: Window position read and restore. `getWindowBounds()` returns the window's frame in logical points (origin at the main display's top-left), and the window options now accept `x`/`y` to open at a saved position instead of centered. Save the bounds on quit and pass them back on the next launch to persist the window position. Ignored for `layerShell` surfaces.
- 66a95d8: Add window close interception and Dock relaunch observers: `createApp(App, { onWindowShouldClose })` cancels an OS close attempt and hands the decision to JS, which confirms with the new `closeWindow()`; `onReopen` fires when the running app is relaunched from the Dock icon (macOS).
- 5633c67: Add runtime window controls: `toggleFullscreen()`, `isFullscreen()`, and
  `minimizeWindow()` (GPUI `Window::toggle_fullscreen` / `is_fullscreen` /
  `minimize_window`). The test renderer records the fullscreen parity and
  minimize count, because the offscreen test window applies fullscreen through
  async AppKit animation. Part of the issue #49 P1 app-shell gap work.
- 2bf8088: Add a windowed `VirtualList` so long transcripts do not create every React row at mount.
  
  Pass `itemCount` and `renderItem`. Native keeps the full logical length for the scrollbar. React only mounts the visible window plus overdraw.
  
  ```tsx
  import { VirtualList } from '@gpuiv/vue'
  
  <VirtualList
    itemCount={turns.length}
    estimatedItemHeight={220}
    renderItem={(index) => <ChatTurn key={turns[index].id} turn={turns[index]} />}
  />
  ```
  
  The host `<virtual-list>` still accepts a full `children` map. Use `VirtualList` when the first mount of thousands of rows is too slow.
  
  `onVisibleRange` reports `startIndex` and `endIndex` after a scroll.

### Patch Changes

- 45304e6: Align input carets, selection highlights, search decorations, and pointer hit testing with centered and right-aligned text, including Markdown table cells. Clear Markdown selections when clicking editor whitespace; let application shells forward outside clicks through the editor's clearSelectionAtPoint method.
- a476ce4: Apply per-corner radii, `flexBasis`, and `alignContent` styles that were already declared in the public React style type.
- 7820d80: Keep text selection and native inputs working after Comet's later generic editor fixes (upstream `fb75c1c`, `1cd46cd`).
  
  **Selection**
  
  - Soft-wrapped highlight and selection washes include the first glyph on the next visual row.
  - A drag that starts in a virtual list keeps selecting after the anchor row unmounts.
  - Dragging near a list edge scrolls the list and extends the selection into newly painted rows, and stops when the list can no longer move.
  
  **Input and textarea**
  
  - Double-click selects the word under the pointer; triple-click selects the whole value. Neither arms a drag that would collapse the selection.
  - Dragging a textarea selection past the visible box scrolls the field.
  - Adjacent typing or deletion undoes as one step for 700 ms, with a 200-step history cap.
  
  **Testing**
  
  - `TestRenderer.advanceTime(ms)` advances GPUI's deterministic test dispatcher and runs due timers (caret blink, drag autoscroll, list edge scroll). It is not `clockFastForward`, which moves the motion clock only.
- affc60f: Keep the starting Markdown block selected through its boundary when dragging into another block, regardless of horizontal pointer position. Preserve the original anchor when dragging upward or returning to the starting block.
- e9a2416: Synchronize custom-element props only when retained values change, avoiding repeated parsing and allocation on every frame.
- 6d70a1c: Queue `focusElement()` requests that arrive before the element has a native focus handle.
  
  A focus request fired from a mount effect ahead of the first frame used to be
  dropped. It is now applied by the first render that creates the element's focus
  handle. If several requests arrive before that render, the latest request wins,
  and an explicit request beats `autoFocus`.
- ce298d4: Enable live-app mouse input, locator bounds, and timeline clock controls on Windows, Linux, and FreeBSD.
- 5a91f3a: Export `TestGpuixRenderer` on every platform. Construction on Linux (or any build without the GPU test renderer) throws instead of failing with `TypeError: TestGpuixRenderer is not a constructor`.
  
  ```ts
  import { TestGpuixRenderer } from '@gpuiv/native'
  
  // macOS / Windows with test-support: constructs the GPU test renderer
  // Linux: throws, because wgpu cannot read a rendered image back yet
  new TestGpuixRenderer()
  ```
  
  Upstream: remorses/gpuix#30
- 0b18c3d: `getElementBounds()` now returns the real border box of an element.
  
  The bounds recorder's canvas is absolutely positioned at an element's
  content-box origin and sized to its padding box, so the recorded box was
  translated from the real hitbox by the element's padding and border. A
  locator-driven `click()` still worked (the center is always inside), but
  corner-region clicks and any code working from the recorded coordinates
  silently missed. The record is now converted back to the border box, the
  same box GPUI hit-tests, for `<div>`, `<text>`, `<code>`, and the input
  elements.
- 4d8fd2c: Prevent live-app mouse automation from aborting the GPUI process when a locator clicks, hovers, wheels, or drags.
  
  Mouse input now enters through the window without already holding the root view, so GPUI event listeners can safely update that view during dispatch.
  
  Upstream: remorses/gpuix#38
- 6c59cf4: Fix a live-window panic on ordinary mouse clicks and text-selection drags.
  
  A physical left click aborted the app with `cannot update GpuixView while it is already being updated`. AppKit dispatches the event with the root view already leased, and GPUIV then nested-updated that same view from the text-selection mouse-up listener.
  
  A tap now skips drag-end cleanup when no drag was active. Real selection-drag move and end work run after the current GPUI effect cycle, so the root lease is released first.
- a60ec98: Make Enter insert a newline in `<textarea>` unless `onSubmit` is set.
  
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
- 97d7dbf: Fix blurry text on Windows when display scaling is above 100%.
  
  GPUI only declares **Per-Monitor V2** DPI awareness in the host executable manifest ([zed#8936](https://github.com/zed-industries/zed/pull/8936)). GPUIV is a napi `.node` loaded into `node.exe` / `bun.exe`, so that manifest never applies and Windows bitmap-stretched the window. The UI thread now requests Per-Monitor V2 awareness itself before creating any window.
  
  Upstream: remorses/gpuix#31
- 97d7dbf: Exit the process when the last window closes on Windows and Linux.
  
  `GpuixRenderer.tick()` now reports whether the UI thread is still inside `Platform::run` (it returns `false` after the last window closes, as on macOS), and `requiresTick()` is true on every desktop platform so the JS frame loop polls it and `createApp()` exits. Later UI commands after the last window no longer log `window not found`.
  
  Upstream: remorses/gpuix#32
- 6d2fc40: Fix Windows x64 native binding failing to load with `ERR_DLOPEN_FAILED`.
  
  `require('@gpuiv/native')` no longer dies with `LoadLibrary failed: The specified procedure could not be found`. The published `.node` was statically importing `TaskDialogIndirect` from comctl32 v6 and `u_strlen` from `icuuc.dll`. Node and Bun do not activate comctl32 v6, so Windows resolved the old comctl32 and `LoadLibrary` failed before any JS ran.
  
  ```bash
  bun -e "require('@gpuiv/native'); console.log('OK')"
  ```
  
  Fixes #1
  Closes #2
- a60ec98: Single-line `<input>` now vertically centers text when given extra height,
  and clips content to its own `borderRadius` automatically.
  
  Previously, text sat at the top of the box and could paint outside
  rounded corners. This matches how HTML inputs behave.
- 81c5566: Size `<input>` and `<textarea>` rows from `style.fontSize` and `style.lineHeight`.
  
  Row height used to be pinned to GPUI's default 16×φ no matter what the style said — a 28px font sat in a 26px box. The row now comes from the element's text style: an explicit `lineHeight` sets the row in pixels, and without one a larger `fontSize` grows the box (default leading). `minRows`/`maxRows` still multiply that height, and an explicit `height` still wins.
- 9a7705f: Keep Bun responsive while GPUIV pumps embedded AppKit events on macOS.
  
  `GpuixRenderer.tick()` now drains only native work that is ready. It no longer
  waits for a display-link wake, so continuously producing PTYs, timers, promises,
  and sockets can make progress between frames.
  
  Upstream: remorses/gpuix#39
- cfd3afb: Normalize CRLF line endings in `<code>` content so rendered, selected, and copied source does not contain stray carriage returns. A final newline continues to produce the same final empty row.
- 96559c0: Deliver `onClick` from primary-button mouse-up for retained and custom native elements so embedded macOS windows receive clicks reliably.
  
  Upstream: remorses/gpuix#41
- 33b0bc4: `getWindowSize()` now reports the real viewport instead of a hardcoded `800x600`.
  
  Anything that turned a mouse position into layout coordinates pointed at the wrong place on every window that was not exactly that size — including `useWindowInsets()`' keyboard geometry. macOS reads the viewport directly; Windows and Linux ask the UI thread.
- d45e5ef: Preserve file and deep-link requests received during startup until the application registers its callback. Add disposable open-request subscriptions and platform-aware file URL decoding, keeping valid files and deep links when another file URL is malformed.
- ecc95cd: Stop binding Tab and Shift+Tab to focus traversal. Both keys now reach normal element keyboard handlers and the render-level `onKeyDown` callback, so terminals and editors can process them without a capture prop.
  
  Applications that want Tab traversal can call the direct GPUI wrappers from the render-level callback:
  
  ```tsx
  const app = createApp(App, {
    onKeyDown(event) {
      if (event.key !== 'tab') return
      if (event.modifiers?.shift) app.renderer.focusPrevious?.()
      else app.renderer.focusNext?.()
    },
  })
  ```
  
  `createApp` and `createTestApp` accept `onKeyDown` / `onKeyUp` observers, and each mounted root owns a key-event generation so queued events from an old root cannot enter its replacement after a `bun --hot` remount.
  
  Upstream: remorses/gpuix#36
- 381e574: Fix the `setMenus` test bridge rejecting submenu items: the recorded-menus validation now converts the submenu alongside its root, so a `submenu`-only item records instead of erroring.
- a60ec98: Draw the `<input>` and `<textarea>` caret at about 75% of `fontSize`, not full line height.
  
  A 13px mail composer used to paint a bar as tall as the line box, so it stuck out above and below the text. The caret now matches typical cap height and sits in the middle of the line.
- 41dea57: Speed up long virtual lists and automation locators.
  
  A 5,000-row chat used to rebuild virtual-list focus maps on every GPUI frame, even when the row ids had not changed. Sidebar motion and caret blink then paid that cost on every tick. Unchanged lists now return before that work.
  
  `getAutomationTree()` also stops serializing style, events, and custom props. Locators only need `id`, `type`, `testId`, `text`, and bounds. On a 5k-row tree that dropped tree JSON from about 110ms to about 22ms, so `getByTestId().click()` is no longer dominated by encoding unused style maps.
- 001d7d4: Start a text selection from the empty space before the glyphs.
  
  A press in parent padding, a code gutter, or the empty start of a line now clamps to the nearest text on that row. Before this, the mouse-down had to land inside the tight `TextLayout` box, so a drag that started just before the first character selected nothing.
  
  ```
    [padding] hello world
        ^
        press here, drag right  →  "hello world"
  ```
  
  A press above or below every line still does not start a selection. That keeps a composer or titlebar from claiming the nearest paragraph. A click without movement still selects nothing.
  
  `userSelect: "none"` now also blocks the start. A sidebar or other chrome on the same row as a paragraph will not start a selection on that paragraph. Native `<input>` and `<textarea>` own their own selection and do the same.
- 299c377: Improve `<markdown-editor>` editing consistency: support drag selection across blocks, use a natural full-line caret, let source documents fill and scroll the editor while keyboard navigation keeps the caret visible, show a centered checkmark in selected task items, preserve Markdown during copy and cut, switch list types without nesting, and include table cells in search and the shared editing pipeline.
- be1a4d0: Use the Markdown theme's selectionColor for local, cross-block, table, and source selections. Paint selections above inline code and highlight backgrounds so selected text remains visibly selected. Match the Elegant example's selection to its warm brick-red palette.
- b293d25: Initialize the Syntect grammar set when a renderer is constructed instead of on the first highlighted code block, and exclude the one-time load from the chat mount budget.
  
  Syntect loads and compiles the full two-face grammar set on first use — hundreds of milliseconds on slower machines. That cost previously landed inside the first paint of any tree containing `<code>`, `<markdown>`, or `<diff>` content, and it made the 1000-turn chat mount exceed its budget on CI runners. Renderer construction now pays it once up front, before any frame can race it, and the perf suite primes the highlighter with a single minimal `<code>` before timing mounts.
