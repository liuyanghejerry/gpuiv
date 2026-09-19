# @gpuiv/vue

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
- 7717a48: Add app packaging: `@gpuiv/packager` (new workspace package) turns an app into a distributable product — a macOS `.app` (plist, icon, ad-hoc codesign, zip) and a Windows portable GUI exe (icon + version info, zip) — by compiling with `bun build --compile` and pinning exactly one native binding into the executable. Every build smoke-tests its own artifact through the automation protocol. `@gpuiv/vue` gains `isPackaged()` and `resourcesPath()` for packaged-app contexts. Design record: `docs/packaging-plan.md`.
- 561668d: Require atomic renderer mutation batches, and decode them into typed ops with styles shared by content.
  
  The renderer no longer exposes separate `createElement`, `setStyle`, `setText`, `setCustomProp`, or `commitMutations` calls. Vue collects these operations and sends one validated `applyBatch(json)` batch per flush, on the live window and in the test renderer.
  
  **Breaking (renderer/test API):** `TestGpuixRenderer` and the `NativeRenderer` TypeScript interface lost the per-op mutation methods; drive mutations through `applyBatch` (the Vue host config and `createTestApp` already do). The wire format is now nine ops; `removeChild` and `setCustomPropValue` are gone (`destroyElement` unlinks from its parent in Rust), and `setStyle` / `setCustomProp` carry raw JSON values instead of nested JSON strings.
  
  Rust now decodes a batch straight from its JSON bytes into typed ops — strings borrow from the input, styles stay raw until apply — and hash-conses identical style payloads into shared `Arc`s before applying, so a failed batch leaves no residue. On the 10k-turn chat benchmark (221k ops), parse+apply drops from ~127 ms to ~30 ms and the retained tree from ~225 MB to ~43 MB.
- 7717a48: Add S3-backed auto-update for packaged apps: `createUpdater()` checks a signed channel feed, downloads with progress, verifies sha256 + an ed25519 signature against keys pinned at package time, and applies a two-phase per-platform swap (`.app` rename on macOS, running-exe rename on Windows) before relaunching; the Windows replacement cleans the renamed old exe at startup. `isPackaged()` now also detects bun 1.3 compiled executables (`$bunfs` entry path). The packager gains `keygen`/`publish`/`promote` commands (aws4fetch, any S3-compatible endpoint) and `updatePublicKeys`/`updateFeedUrl` config baked into products via define injection; a manual-dispatch CI job verifies the full self-update on macOS and Windows against an in-process mock S3. Design record: `docs/auto-update-plan.md`.
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
- f9959a4: Add a `CanvasRenderingContext2D` implementation for `<canvas>`: `GpuixCanvas` template refs now expose `getContext("2d")`, a pure-TypeScript software rasterizer that draws into a JS-owned buffer and uploads through the existing pixel bridge (one coalesced upload per JS task, no Rust changes, no new dependencies). Covers the path vocabulary (`moveTo`…`roundRect`, arcs, béziers), `fill`/`stroke`/`clip`/`isPointInPath` with nonzero and even-odd rules, the transform stack, linear and radial gradients, line styles with dashes/caps/miter joins, anti-aliased rasterization, `globalAlpha`, `source-over`/`destination-out`/`copy` compositing, `clearRect`, `getImageData`/`putImageData`/`createImageData`, and `drawImage` from another `GpuixCanvas` with nearest or bilinear sampling. Text APIs (`fillText`/`strokeText`/`measureText`) throw `NotSupported` — glyph rasterization is follow-up work; `toDataURL`, shadows, `filter`, patterns, and WebGL are documented as not implemented. New `examples/canvas-paint.tsx` is a small drawing pad built on the context.
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
- f9959a4: Pin the canvas 2D context to a vendored subset of the W3C web-platform-tests canvas suite (593 cases; 452 run green, 141 skipped with the missing API named), and fix the spec deviations it uncovered.
  
  Behavior fixes, all matched to the WPT expectations:
  
  - **Path transforms are baked in at construction time** (`2d.path.transformation.*`): `ctx.translate()` between path calls now affects only the segments added after it, and `fill`/`clip`/`isPointInPath` no longer re-transform the finished path. `isPointInPath` takes device-space points and counts path-boundary points as inside.
  - **`setTransform(a, b, c, d, e, f)` with six numbers works.** The first numeric argument was being swallowed by the matrix-object overload, so every six-argument call built a shifted matrix. `setTransform()` with no arguments resets to the identity.
  - **`fillStyle`/`strokeStyle` getters return the DOM serialization** (`#0a141e` for opaque colors, `rgba(r, g, b, a)` otherwise) instead of the raw input string. Setters also accept CSS color objects (`{ r, g, b, a? }`) and anything with a `toString`, and parse `color(srgb …)` values.
  - **`roundRect` follows the spec**: negative width/height mirror the rectangle (and flip the traced winding), radii accept `DOMPointInit` objects, more than four radii or a negative radius throw `RangeError`, and non-finite radii make the call a no-op.
  - **Composite operations**: every mode name the DOM accepts is now settable (`xor`, `clear`, `lighter`, `source-in/out/atop`, `destination-in/atop/over` render natively; separable blend modes are accepted but still rasterize as `source-over`). `"darker"` and unknown names stay rejected.
  - **`ImageData` is a real constructor** (`new GpuixImageData(w, h)` / `(data, w, h)` with DOM exception types), `pixelFormat` is exposed, and instances have properly readonly dimensions. `createImageData`/`getImageData`/`putImageData` follow WebIDL conversions (truncate + absolute magnitude, `TypeError` on non-finite) and `putImageData` normalizes negative dirty rectangles.
  - **Gradients match the spec's radial algorithm** (the circle family painted from ω = +∞ down; the largest root with a positive radius wins, and points no circle reaches are left untouched), zero-length linear gradients and identical radial circles paint nothing, and `addColorStop` throws `IndexSizeError`/`SyntaxError` DOM exceptions.
  - **Strokes prune zero-length subpaths** (no round-cap dots), miter joins survive duplicate closing vertices, stroke flattening tightens for wide curves so the offset outline stays within the WPT ±2 channel tolerance, and `ctx.reset()` clears back to a fresh context.
  
  The `ctx.lineWidth = "1e1"`-style WebIDL string coercions work, exceptions carry DOM exception names (`IndexSizeError` etc.), and `drawImage`, `fillRect`, `strokeRect` keep their DOM argument semantics.
  
  The suite lives in `packages/vue/wpt/` and regenerates with `bun scripts/convert-canvas-wpt.ts`; the still-missing surface (`Path2D`, `createPattern`, text, shadows, filters, color-mix, non-sRGB spaces) is skipped with the reason in the test title so it reads as a worklist.
- b754b13: Add clipboard image read/write. `writeClipboardImage(data, width, height)`
  encodes straight-alpha RGBA pixels as PNG onto the system clipboard
  (GPUI `ClipboardItem::Image`); `readClipboardImage()` decodes whatever image
  the platform stored back to RGBA, or returns null when the clipboard holds no
  image. The test renderer runs the same encode/store/read round trip against
  the test platform's in-memory clipboard. Part of the issue #49 P1 app-shell
  gap work.
- 66a95d8: Add clipboard text read/write via `readClipboardText` and `writeClipboardText`, mirroring the existing clipboard image API.
- 7c25fc4: Automation protocol: `getComponentTree` and `getComponentState` expose the Vue component tree to agents and tests — names, source files, props, and reactive `setup()` state, linked to automation element ids. Live apps attach the inspector automatically; in-process sessions pass `createComponentInspector(app)` to `connectTest`. State reads run with dependency tracking paused, so inspecting a component never triggers its re-render.
- 3df90f6: Map the full CSS cursor keyword set onto GPUI's cursor styles. `cursor` now accepts `crosshair`, `text`, `vertical-text`, `grab`, `grabbing`, `move`, `all-scroll`, `context-menu`, `not-allowed`, `no-drop`, `alias`, `copy`, `col-resize`, `row-resize`, the `ew/ns/nesw/nwse` and directional `n/e/s/w/ne/nw/se/sw` resize keywords, and `auto`/`default` — previously only `pointer` and `default` worked and every other value was silently ignored.
  
  Keywords GPUI cannot show (`none`, `url(..)`, `wait`, `progress`, `help`, `cell`, `zoom-in`, `zoom-out`) now log a one-time dev warning instead of failing silently. The `cursor` style type is narrowed to the supported keywords in `@gpuiv/vue`. Hiding the cursor (`cursor: "none"` for brush cursors) and custom image cursors need a GPUI fork change and remain unsupported.
  
  Part of the drawing-app gap audit (#49).
- 59ff89f: Deep links. `onOpenUrls` registers the handler for URLs the platform asks the app to open (deep links, files dropped on the Dock icon); `registerUrlScheme(scheme)` registers the app as the handler for a URL scheme such as `myapp://`, resolving on success and rejecting with the platform's reason otherwise (macOS requires 12+, a bundle id, and an installed app; Windows and Linux report unsupported).
- 66a95d8: Add runtime menu bars via `setMenus(menus, onAction)`. Items fire their `id` back to JS, `system` items keep built-in behaviors (quit, hide, window controls), and `keystroke` items show their key equivalent in the menu. macOS only.
- 1651f7f: **BREAKING:** `getElementBounds` returns `{ x, y, width, height }` instead of `[x, y, width, height]`.
  
  The array form could not grow — extra fields like scroll offsets would have had to sit at magic indexes. The native napi method, `TestGpuixRenderer`, the Vue `TestRenderer`/`app.renderer` facade, and the live automation client all use named fields now. Update destructuring call sites:
  
  ```diff
  -const [x, y, width, height] = renderer.getElementBounds(id)!
  +const { x, y, width, height } = renderer.getElementBounds(id)!
  ```
- fc07f86: Restyle the runtime error overlay to match webpack-dev-server.
  
  Title becomes "Uncaught runtime errors:", the message sits in a red-tinted
  scroll pane above the frames, frames keep webpack-style indent with a
  platform mono font (Menlo / Consolas / DejaVu Sans Mono), the overlay is
  near-black `#000000e6` with a bright red Reload button, and empty or
  duplicate `Error:` message lines are stripped so the pane shows frames only.
  `console.error` now prints the formatted stack once instead of dumping a
  second inspect object.
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
- 47a45ea: Live-window automation now supports keyboard and scroll input (upstream `53b3a89` follow-through).
  
  `fill()`, `press()`, `nativeSimulateKeystrokes`, `nativeSimulateKeyDown/Up`, and `nativeSimulateScrollWheel` now work against `launch()` — the client forwards to the live renderer's `simulateKeystrokes` / `simulateKeyDown` / `simulateKeyUp` / `simulateScrollWheel`, which dispatch through the real GPUI window input pipeline. They previously threw `keystrokes are not live yet`.
  
  Every example entry (`counter`, `diff`, `native-text`, `infinite-chat`, `blurred-window`, `chat`) now honors `GPUIX_BACKGROUND=1` by passing `focus: false`, so agent-driven windows never take the user's keyboard.
- 07a6c95: Add `<markdown-editor>`, a WYSIWYG Markdown editor component: a headless ProseMirror document rendered as one native editable block per textblock. Supports GFM (tables with alignment, task lists, strikethrough, footnotes), `==highlight==`, remark-breaks semantics, input rules (`# `, `- `, `1. `, ``` ``` ``` `, `> `, `==x==`, `[x] `), format shortcuts (⌘B/⌘I/⌘E/⌘K/⌘⇧X/⌘⇧H), block splitting on enter, task checkbox toggles, marker-style-preserving markdown round-trip, document-wide ⌘A select-all, a right-click context menu (Copy/Cut/Paste/Select All), cross-block selection with markdown copy/cut and structured paste, undo/redo through the ProseMirror history, search highlighting via decorations, source mode with scroll-ratio restore, and heading anchor jumps with a flash indicator. See `examples/markdown-editor.tsx`.
- 66a95d8: Rasterize the non-separable blend modes: `hue`, `saturation`, `color`, and `luminosity` now paint through the W3C Compositing and Blending §5. operators instead of throwing, completing the `globalCompositeOperation` palette for layer blending.
- 8d7e0fa: Add `openUrl(url)`: hands a URL to the user's default browser / handler via
  GPUI's `App::open_url`, for links that must leave the app (OAuth, payment
  pages). The test bridge records the last URL (`getLastOpenedUrl`) for
  assertions. Part of the issue #49 P1 app-shell gap work.
- 4192dde: Wire pinch gestures end to end. Any element (including `<canvas>`) can now take an `onPinch` listener: each step carries `x`/`y` (the pinch center), `zoomDelta` (0.1 ≈ a 10% zoom-in, accumulate it into a scale like a browser zoom handler), `touchPhase` (`started`/`moved`/`ended`/`cancelled`) and `modifiers`. Trackpad pinches already arrive from GPUI on macOS, Windows and Linux; they now reach Vue handlers.
  
  Automation gained synthetic pinch: the `pinch` protocol method, `app.mouse.pinch(target, delta, { phase, modifiers })`, `locator.pinch(delta, options)`, and `nativeSimulatePinch` / renderer `simulatePinch`, so tests drive the gesture deterministically through the GPUI input pipeline.
- d45e5ef: Preserve file and deep-link requests received during startup until the application registers its callback. Add disposable open-request subscriptions and platform-aware file URL decoding, keeping valid files and deep links when another file URL is malformed.
- b708e1b: Add native titlebar drag regions and a zoomWindow command for custom desktop app shells. Add cancellable smooth scroll controllers with stable-offset completion, AbortSignal support, and component-unmount cleanup.
- aba82ef: Native event handler errors now flow through Vue's error handling, matching web `v-on` semantics: `onErrorCaptured` boundaries catch them, and returning `false` stops the error from reaching the global runtime error overlay.
  
  `createApp()` options gain `onRuntimeError(error, info)` — observe every routed runtime error (render, event handlers, frame-loop ticks, process-level throws) in parallel with the overlay, the Sentry-style integration point — and `errorOverlay: false` to turn the overlay off.
- 77bfa69: Select now follows Base UI's split between Root label data and mounted Item interaction data. `items` on `Select` is optional and only a label lookup for `SelectValue` while the popup is closed; keyboard navigation and clicks read the mounted `SelectItem` children through a provide/inject registration registry, so a styled wrapper around `SelectItem` works and a late-mounted selected item becomes the highlight. Without `items`, `SelectValue` shows the raw value. `SelectItem`'s `textValue` prop is removed.
- 9063223: Add `asChild` to `SelectItem` and `ComboboxItem`.
  
  With `asChild`, the item renders no wrapper of its own: its click/hover
  handlers, state-driven style, and remaining props merge onto the single child
  element via `cloneVNode`, so a custom row's root becomes the item and owns the
  one native hit target. A filled custom row no longer covers the item's hitbox
  (GPUI paints a flat hit list and does not hover-gate clicks through filled
  children). Component children receive the merged props through Vue's
  fallthrough attrs and must render a single root element.
- cd11d43: Add `acquireSingleInstance` to elect one application process before opening a window and forward later launches with their arguments and working directory. Queue requests until the application is ready, authenticate local delivery, and release ownership automatically when the primary process exits or crashes. Provide a standalone `@gpuiv/vue/single-instance` entry that does not load the native renderer.
- 66a95d8: Add a `Spinner` loading primitive to `@gpuiv/vue`: three pulsing dots by default, or an indeterminate sliding bar with `variant="pulse"`. Size, color, track width, and the accessibility label are props, and `phase` pins the animation for deterministic screenshots and tests.
- 964e5f5: Extend `<input>`/`<textarea>` into a styled-text editing surface. New props: `spans` (inline styled runs — weight, italic, underline, strikethrough, background, color, family — at UTF-16 offsets with IME preedit underline preserved; boolean `underline`/`strikethrough` inherit the run's text color), `decorations` (search-style range highlight quads), `selection` (programmatic UTF-16 anchor/head), `valueRevision` (authoritative re-sync that bypasses echo suppression) and `interceptClipboard` (clipboard keybindings become events instead of native edits). New events: `selectionChange` (paint-time deduped UTF-16 anchor/head), `copy`/`cut`/`paste` (intercepted clipboard intents), `undo`/`redo`/`selectAll` (routed to the host when a listener is registered, native undo stack / select-all skipped), `backspaceStart` (backspace with empty selection at offset 0, for cross-block joins) and `contextMenu` (right-button release with window coordinates; a right-button press focuses the editor and places the caret when the selection is empty). `style.textAlign` is now honored when painting. New test APIs: `getPaintedInputRuns(elementId)`, `getInputDecorations(elementId)`, `getInputTextPosition(elementId, offset)` and `getInputTextOffset(elementId, x, y)`.
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
- 9e2e946: System notifications. `showSystemNotification` posts to the OS notification center (same-tag notifications replace each other where the platform supports it; the effective tag is returned so untagged ones can still be dismissed), `dismissSystemNotification` retracts by tag, and `onSystemNotificationResponse` receives body clicks and action-button presses. `setAppIdentity` sets the process identity Windows attributes toasts to and the user-visible app name. On macOS, notifications only deliver from a packaged `.app` bundle — a bare `bun` process is skipped by the platform's bundle guard.
- 33b0bc4: `TestGpuixRenderer` now runs on **Windows** through DirectX, so Windows users can write GPU-backed tests for their own apps. CI runs the full Vue and example suites on a Windows GPU runner.
  
  | Platform | Test renderer | PNG capture |
  |---|---|---|
  | macOS | Metal | Yes |
  | Windows | DirectX | Yes |
  | Linux | Not yet | Waiting for GPUI's wgpu headless renderer |
  
  Also: the test renderer constructor takes an optional window size (`new TestGpuixRenderer(320, 200)`, or `createTestApp(Component, { width, height })`), and the offscreen test window is torn down like a real unmount — tree root cleared, custom element instances destroyed, then one empty frame painted — so entity handles never outlive the app (the gpui leak detector only exposed this once Windows ran the suite).
- 96f9569: Add `THROTTLE` for macOS CPU clamps on profile runs.
  
  `THROTTLE=utility` restarts the process under `taskpolicy -c utility`. That pins work to E-cores. Use it as an M1/M2 Air CPU proxy. `background` and `maintenance` are slower.
  
  ```bash
  THROTTLE=utility bun run test chat.perf.test.tsx
  THROTTLE=utility bun --hot chat.tsx
  ```
  
  This is not Chrome 6x. GPU and RAM stay on the host machine. Do not set `THROTTLE` in CI.
- fe9b519: Add `TestRenderer.findByTestId()` and expose `testId` on `TestElement`, so tests can locate marked elements and click their painted bounds instead of fixed window coordinates.
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
- 1797c68: Vue DevTools integration: `connectVueDevtools()` connects a running app to the standalone Vue DevTools server (`bun x vue-devtools`) — the component tree, props, and `setup()` state appear in the devtools UI. Call it before `createApp()` so the hook installs in time; it no-ops on repeat calls after a `bun --hot` reload and returns `false` with a console hint when `@vue/devtools` is not installed (optional peer dependency). DOM-dependent devtools features (element highlight, select-element, open-in-editor) stay inert.
- c792ede: Vue Fast Refresh under `bun --hot`: register the shipped Bun preload (`preload = ["./node_modules/@gpuiv/vue/hmr-preload.js"]` in bunfig.toml) and a save reloads the edited components in place through Vue's HMR runtime instead of remounting the whole app. The edited component's local `ref` state resets (Vue reload semantics); its ancestors, siblings, and their subtrees keep theirs. A change to module-level code reloads every component in that file, and a save with no reloadable component change keeps the classic remount. Adds the `@gpuiv/vue/hmr` export that the injected registration calls import.
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
- ec522c7: Fix user event handlers firing twice on `Select`, `Combobox`, `Tooltip`, `VirtualList`, `GpuixCanvas` and `motion.div`. These components forward `$attrs` by hand and still let Vue merge the same attrs onto their root element, which chains an overridden handler with the user's copy. A user `onKeyDown` on `SelectContent` ran twice per key, as did `onMouseDownOutside` on the Select/Combobox content and `onMouseEnter`/`onMouseLeave` on the Tooltip parts. Attributes are now forwarded exactly once.
- 1ed9642: Add a macOS frosted-glass window example that combines `windowBackground: 'blurred'` with a transparent titlebar and translucent Vue surfaces (upstream `3e3249b`).
  
  ```tsx
  createApp(App, {
    titlebarTransparent: true,
    windowBackground: 'blurred',
  })
  ```
  
  Run it with `bun run blurred-window` in `examples/`.
- 482dc8b: Improve Markdown editor typography with distinct heading spacing and rules, more readable body text, padded code blocks and tables, aligned list markers, and muted strikethrough for completed tasks. Keep table borders single-width and center the example's reading column with consistent source and visual mode margins.
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
- f480cdf: Fix `onValueChange` / `onOpenChange` / `onInputValueChange` never firing in uncontrolled mode.
  
  `useControllableState`'s setter compared the next value against `current`
  after mutating the internal ref, so the comparison always reported
  "unchanged" and the change callback was skipped. It now captures the previous
  value before assigning. Affected uncontrolled `Select`/`Combobox` usage with
  change callbacks; controlled mode was unaffected.
- 6d70a1c: Queue `focusElement()` requests that arrive before the element has a native focus handle.
  
  A focus request fired from a mount effect ahead of the first frame used to be
  dropped. It is now applied by the first render that creates the element's focus
  handle. If several requests arrive before that render, the latest request wins,
  and an explicit request beats `autoFocus`.
- 7355de9: Vue DevTools: `connectVueDevtools()` rolls the `window`/`document` shims back when `@vue/devtools` cannot be imported or the devtools client fails to start, so a failed connect no longer leaves a fake browser visible to the rest of the process. Its `scroll to component` action no longer throws, and `installDevtoolsShims` is no longer part of the public API.
- 66b8c4c: Add an error-handling example that tours the runtime error story end to end: a render throw and a click-handler throw landing on the overlay with Reload restoring the app, an `onErrorCaptured` boundary falling back locally, and an `onRuntimeError` report log.
  
  Run it with `bun run error-handling` in `examples/`.
- 5a91f3a: Export `TestGpuixRenderer` on every platform. Construction on Linux (or any build without the GPU test renderer) throws instead of failing with `TypeError: TestGpuixRenderer is not a constructor`.
  
  ```ts
  import { TestGpuixRenderer } from '@gpuiv/native'
  
  // macOS / Windows with test-support: constructs the GPU test renderer
  // Linux: throws, because wgpu cannot read a rendered image back yet
  new TestGpuixRenderer()
  ```
  
  Upstream: remorses/gpuix#30
- f859d1b: Keep abandoned concurrent renders out of the native mutation queue.
  
  React may throw away a Suspense render. GPUIX now waits until commit before it creates native elements, so fallback text paints and abandoned text does not.
  
  Unchanged click handlers also stay registered across rerenders. GPUIX no longer clears the whole handler map before every update.
- 7d24720: Keep click, keyboard, and other event handlers active after `bun --hot` remounts an app on its existing native window.
  
  Renderer event ownership and element IDs now survive JavaScript module reloads for the full life of the native renderer. Late events from the previous tree still cannot enter its replacement, and the render-level `onEvent` option is rebound to each mount instead of only the first.
  
  Upstream: remorses/gpuix#37
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
- 97d7dbf: Exit the process when the last window closes on Windows and Linux.
  
  `GpuixRenderer.tick()` now reports whether the UI thread is still inside `Platform::run` (it returns `false` after the last window closes, as on macOS), and `requiresTick()` is true on every desktop platform so the JS frame loop polls it and `createApp()` exits. Later UI commands after the last window no longer log `window not found`.
  
  Upstream: remorses/gpuix#32
- 77bfa69: Fix `FloatingLayer` duplicating fallthrough attrs onto its `anchored` root in addition to the content div. `tabIndex`/`autoFocus` landing on both elements raced for popup focus, and when the `anchored` element won, keyboard navigation in `SelectContent` was silently swallowed.
- 8d49402: Reject automation calls after close and make session shutdown idempotent across in-process and SSE backends.
- 52e1287: Harden Fast Refresh against duplicate watch reports. Bun's Windows watcher can report one save more than once; a re-evaluation whose content matches the just-applied generation previously took the classic-remount path and discarded the state the in-place reload had preserved. The HMR runtime now recognizes an identical re-evaluation directly behind a changed one (within a 50 ms coalescing window) and keeps the live tree; an asset save — identical hashes with no just-applied change — still remounts so the new data is applied. The remount e2e that exposed this skips on Windows, where bun additionally delivers a stale pre-write evaluation no runtime-side change can absorb (documented in the test).
- fed3bcb: Vue Fast Refresh under `bun --hot` no longer breaks multi-file apps: the
  preload used to abort startup ("Expected module mock to return an object")
  on any matched `.ts`/`.tsx` it declined — a component-less `theme.ts`, or any
  `.ts` file under `node_modules` — because Bun rejects an onLoad that returns
  nothing for a matched path. Exclusions now live in the plugin's path filter
  and a matched file always resolves to a module.
  
  Fast Refresh also survives a classic remount (an asset save, the error
  overlay's Reload button) again: the runtime pins the HMR runtime of the vue
  copy that mounted the live tree, and re-pins it on every mount, so a later
  component save reloads instead of being silently dropped.
  
  The source transform no longer emits a module that cannot parse when a
  `defineComponent(...)` statement has a tail it cannot follow (`as T`,
  `satisfies T`, a comma, a ternary); that file keeps the classic remount.
  
  One Bun caveat applies to Fast Refresh in multi-file apps: a file the preload
  served is not watched by `bun --hot`, so a save only re-evaluates when the
  edited file is the entry or one the preload does not match (a `.json`
  import). Saving any other module is a no-op until this Bun gap closes
  ([oven-sh/bun#4689](https://github.com/oven-sh/bun/issues/4689)).
- a0a84bf: Give each React root its own event handler map. Two `createTestRoot()` trees can both start at id `1` without overwriting each other's handlers. `resetIdCounter()` is gone.
  
  A remount on the same native renderer keeps allocating new ids. A late event from the old tree cannot hit a new handler that reused id `1`.
  
  `handleGpuixEvent` now needs the renderer that produced the event:
  
  ```ts
  handleGpuixEvent(event, renderer)
  ```
- 8042072: Keep the macOS window alive after a JavaScript runtime error.
  
  A throw used to kill the frame loop that pumps AppKit, so the window froze
  while bun exited. `startFrameLoop` now catches errors from `tick()` and
  schedules the next pump. Native event callbacks catch throws from Vue
  handlers. `createApp()` also installs `uncaughtException` and
  `unhandledRejection` listeners so bun stays alive, and starts the frame loop
  before the first mount flush. The error is logged; save under `bun --hot` to
  remount.
  
  Upstream: remorses/gpuix (2487521)
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
- a5af8fc: `useWindowSize()` now samples the window every **100 ms** instead of reading it once on mount, so a resized or late-opening window no longer reports a stale size forever.
  
  The old hook seeded state with a hardcoded `800x600` and read the renderer a single time from an effect. Two failures came out of that:
  
  - the first read can land **before** the platform window has a size, so the hook kept `800x600` for the whole life of the app
  - a **window resize** was never observed at all
  
  Both matter for code that converts a mouse position into layout coordinates. A stale height silently points at the wrong row.
  
  ```ts
  useWindowSize()                      // 100ms, the default
  useWindowSize({ intervalMs: 250 })   // slower
  useWindowSize({ intervalMs: false }) // read once, never poll
  ```
  
  State is seeded from the renderer during setup, and the ref only updates when the width or height actually changes, so a drag-resize cannot flood Vue with renders. This mirrors what `useWindowInsets()` already does; the two hooks now share the same pull-based shape and the same `intervalMs` option.
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
- e2e4f6b: Show a runtime error overlay with a Reload button after a JavaScript throw.
  
  A throw used to keep the process alive but the window stayed on its last frame with no feedback. `createApp()` now replaces the tree with the error message and stack, and **Reload** remounts the last tree. Component render errors, event handlers, frame-loop ticks, and `uncaughtException` / `unhandledRejection` all take this path. Saving under `bun --hot` still remounts.
- ec522c7: Fix `Select` losing keyboard focus after choosing an item. Selecting closed the popup through the raw state setter, so the focused content element was destroyed without focus returning to the trigger: ArrowDown no longer reopened the menu and Tab order started over. Enter/Space selection now restores focus to the trigger, as Escape already did.
- 299c377: Improve `<markdown-editor>` editing consistency: support drag selection across blocks, use a natural full-line caret, let source documents fill and scroll the editor while keyboard navigation keeps the caret visible, show a centered checkmark in selected task items, preserve Markdown during copy and cut, switch list types without nesting, and include table cells in search and the shared editing pipeline.
- be1a4d0: Use the Markdown theme's selectionColor for local, cross-block, table, and source selections. Paint selections above inline code and highlight backgrounds so selected text remains visibly selected. Match the Elegant example's selection to its warm brick-red palette.
- 482dc8b: Support Markdown prose fonts, body line height, emphasis colors, code-block text colors, and quote backgrounds through the editor theme. Match the example to ColaMD's Elegant appearance with warm paper surfaces, Songti serif text, brick-red emphasis, and coordinated light toolbar and outline colors.
- Updated dependencies [e07e390]
- Updated dependencies [b728ab4]
- Updated dependencies [dcddaf3]
- Updated dependencies [4e76b98]
- Updated dependencies [3e76d0e]
- Updated dependencies [e81ef0b]
- Updated dependencies [b596082]
- Updated dependencies [45304e6]
- Updated dependencies [a476ce4]
- Updated dependencies [561668d]
- Updated dependencies [1ac2e1d]
- Updated dependencies [27ed1e8]
- Updated dependencies [f99e005]
- Updated dependencies [c4b174a]
- Updated dependencies [86dcd13]
- Updated dependencies [c37efe7]
- Updated dependencies [f9959a4]
- Updated dependencies [b754b13]
- Updated dependencies [66a95d8]
- Updated dependencies [7820d80]
- Updated dependencies [affc60f]
- Updated dependencies [3df90f6]
- Updated dependencies [59ff89f]
- Updated dependencies [e9a2416]
- Updated dependencies [6d70a1c]
- Updated dependencies [d48f928]
- Updated dependencies [66a95d8]
- Updated dependencies [1651f7f]
- Updated dependencies [ce298d4]
- Updated dependencies [5a91f3a]
- Updated dependencies [b5f2c0d]
- Updated dependencies [0b18c3d]
- Updated dependencies [4d8fd2c]
- Updated dependencies [6c59cf4]
- Updated dependencies [a60ec98]
- Updated dependencies [97d7dbf]
- Updated dependencies [97d7dbf]
- Updated dependencies [6d2fc40]
- Updated dependencies [a344912]
- Updated dependencies [566ba4e]
- Updated dependencies [96f9569]
- Updated dependencies [9df699a]
- Updated dependencies [db8bed4]
- Updated dependencies [66a95d8]
- Updated dependencies [9e95662]
- Updated dependencies [a60ec98]
- Updated dependencies [81c5566]
- Updated dependencies [0994348]
- Updated dependencies [d91c23d]
- Updated dependencies [d9c32bb]
- Updated dependencies [66a95d8]
- Updated dependencies [8f03c33]
- Updated dependencies [66a95d8]
- Updated dependencies [9a7705f]
- Updated dependencies [cfd3afb]
- Updated dependencies [8d7e0fa]
- Updated dependencies [4192dde]
- Updated dependencies [96559c0]
- Updated dependencies [33b0bc4]
- Updated dependencies [d45e5ef]
- Updated dependencies [ecc95cd]
- Updated dependencies [b708e1b]
- Updated dependencies [381e574]
- Updated dependencies [a60ec98]
- Updated dependencies [41dea57]
- Updated dependencies [964e5f5]
- Updated dependencies [001d7d4]
- Updated dependencies [299c377]
- Updated dependencies [66a95d8]
- Updated dependencies [6e8ead0]
- Updated dependencies [13e1ef1]
- Updated dependencies [9e2e946]
- Updated dependencies [33b0bc4]
- Updated dependencies [be1a4d0]
- Updated dependencies [3fbf047]
- Updated dependencies [030fede]
- Updated dependencies [5a908a4]
- Updated dependencies [b293d25]
- Updated dependencies [dec1f08]
- Updated dependencies [66a95d8]
- Updated dependencies [5633c67]
- Updated dependencies [2bf8088]
  - @gpuiv/native@0.5.0
