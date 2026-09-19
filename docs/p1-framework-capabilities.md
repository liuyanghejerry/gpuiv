# P1 framework capabilities — ColaMD comparison

Issue: [#101](https://github.com/liuyanghejerry/gpuiv/issues/101).
Reviewed against local ColaMD on 2026-09-19. This is framework work, not a
port of its Electron shell. ColaMD is a read-only reference; no source is copied.

## First delivery

- [x] `windowDragRegion`: native GPUI titlebar hit area on Windows;
  press-time move on macOS/Linux. Buttons are siblings, not nested exclusions.
- [x] `zoomWindow()`: native zoom/maximize-restore, separate from fullscreen.
- [x] `createScrollController` / `useScrollController`: smooth scroll,
  cancellation/replacement, AbortSignal, component cleanup, stable-offset
  completion and timeout. No additional scroll parent and no editor dependency.
- [x] `examples/window-shell.tsx`: reusable composition of these APIs.
- [ ] OS drag/snap/double-click manual acceptance on macOS, Windows, Linux.
- [ ] Native wheel/momentum `scrollend` event (the controller does not claim it).

Reference: ColaMD `src/renderer/themes/base.css` uses drag/no-drag regions;
`src/renderer/editor/editor.ts:flashHeadingOnArrival` waits for scrollend with a
stable-position fallback before flashing a heading. We expose the underlying
capability, not its DOM IDs, document state, or theme.

## Continued delivery: single-instance bootstrap

The file-open delivery is tracked separately in
[PR #104](https://github.com/liuyanghejerry/gpuiv/pull/104). This topic branches
from main independently and does not require that PR's APIs.

- [x] `acquireSingleInstance`, including a native-free package subpath, runs
  before createApp and elects one process per app/profile.
- [x] Subsequent launches preserve argv/cwd, including empty relaunches,
  relative arguments, Chinese and spaces. Apps own flag parsing and tabs.
- [x] Queue before UI readiness, bounded authenticated IPC, acknowledged
  delivery, explicit collision/timeout/overload errors, idempotent teardown.
- [x] Kernel-owned lifetime: no stale-file deletion or PID reuse races after
  an owner crash. Five-process elections and abrupt-kill recovery pass under
  Node, Bun and a compiled Bun executable on macOS.
- [x] Standalone example and [documented delivery guarantees](./single-instance.md).
- [ ] Windows/Linux OS file-association registration and packaged acceptance.
- [ ] Native multi-window lifecycle; this API elects processes, not windows.

Validation: Vue TypeScript build and complete suite (60 files, 977 passed,
141 existing skips; two workers, unrelated untracked debug file excluded).
The 11 single-instance tests include Node, Bun and compiled Bun multi-process
runs. The macOS example `.app` also passes packaging and automation screenshot
smoke. Windows execution is left to CI; no local Windows/Linux run is claimed.

ColaMD reference: `src/main/index.ts` single-instance section (#99/#100) passes
second-launch argv to file-opening logic and reveals the existing window on an
empty launch. The reusable API carries that input without adopting ColaMD's
Markdown filtering, window selection or save queues.

### HTML clipboard upstream findings (2026-09-19)

Zed already has three open implementations of actual HTML clipboard flavors:
[#56452](https://github.com/zed-industries/zed/pull/56452),
[#62706](https://github.com/zed-industries/zed/pull/62706), and
[#64112](https://github.com/zed-industries/zed/pull/64112), associated with
[#61966](https://github.com/zed-industries/zed/issues/61966). They modify GPUI and
the platform clipboard backends rather than storing HTML in string metadata.
Per `docs/agents/zed-workflow.md`, follow those PRs instead of maintaining a
competing GPUI workaround. Revisit when one merges into the GPUI fork: audit
**read** support as well as the advertised HTML **write** path, bump the
submodule, then add napi/Vue APIs and editor integration. This does not mark
HTML clipboard complete.


## Remaining P1 queue and acceptance

| Capability | Layer and next step | Acceptance |
| --- | --- | --- |
| HTML clipboard | GPUI first: current `ClipboardEntry` supports String/Image/ExternalPaths only. Add real HTML flavor beside plain text in GPUI platform backends, following `docs/agents/zed-workflow.md`; then napi + Vue. Never use String metadata as external HTML. | Native HTML/plain round-trip on macOS/Windows/Linux; external rich-text paste; plain fallback; then safe HTML→MD import and styled export in editor layer. |
| Popup context menus | ColaMD main `tab-context-menu` / `entry-context-menu` use `Menu.popup`. GPUIV `setMenus` is a macOS menubar, not a popup. Audit native GPUI popup support before a framework API; any FloatingLayer alternative must be explicitly called an app-rendered menu. | Pointer and keyboard invocation, disabled items, separators, submenu focus, Escape/outside close, callback ownership and cleanup; platform scope documented. |
| Multi-window | Renderer/window lifecycle and per-window state isolation first. Do not simply call singleton `createApp` twice. | Independent roots, input focus/IME, event maps, scroll/selection, close veto, and final-window exit; app owns save queues and tabs. |
| File association / open-file | **macOS OS delivery + bundle declarations delivered below.** Windows/Linux association registration, CLI parsing and single-instance IPC remain pending. | macOS packaged cold/warm delivery passed; still needs Windows/Linux packaged acceptance and cross-platform second-instance argument/cwd forwarding. |
| PDF/printing | Decide vector document export vs platform printing; requires layout/font/image policy. A screenshot PDF is not text PDF. | Selectable/searchable Unicode text, page breaks, table splits, images and links; cancellable export and error reporting. |
| Native scroll completion | Inspect GPUI wheel/touch-phase and frame lifecycle, rather than synthesizing a native event from timers. | Momentum/no-op/interruption/removed element; exactly-once completion; no unnecessary polling after teardown. |

HTML clipboard requires an upstream GPUI change and PR before a submodule
bump, not OS-specific clipboard calls hidden in `packages/native`. Multi-window
and file association are coupled infrastructure, not MarkdownEditor props.
Math/Mermaid remain P0 and are outside this P1 delivery.

## Second delivery: reusable file opening

Reference: ColaMD `src/main/index.ts` queues paths before app readiness, handles
`open-file`, and forwards a second process's arguments into existing tabs.
This delivery covers the OS delivery and macOS packaging portion; it does not
claim the combined issue #101 file-association/single-instance item is complete.

- [x] Preserve GPUI URL batches received before the JS callback registers.
  Production and the native test bridge share the same queue implementation.
- [x] `onOpenRequests` delivers paths, deep links and per-file decode errors
  together. It preserves order within each category, duplicates, spaces,
  Unicode and encoded punctuation. No reads, shell commands, Markdown coupling,
  automatic extension filtering or tab/window policy.
- [x] `onOpenUrls` / `onOpenRequests` return idempotent disposers. Replacement
  owns pending JS callbacks; stale disposers cannot unregister the replacement.
  Native `onOpenUrls(null)` releases the callback and queues later deliveries.
  Callbacks already on Node are ignored while unsubscribed. The native API is
  process-wide; use one owning renderer, not multiple competing subscriptions.
- [x] `mac.documentTypes` generates `CFBundleDocumentTypes`; typed UTI
  declarations generate imported/exported definitions. `mac.plist` supports
  nested dictionaries/arrays and remains the explicit override mechanism.
  Default rank is `Alternate`, not ownership or forced-default registration.
- [x] `examples/open-files.tsx` and `open-files.package.ts` show reuse without
  an editor dependency. No ColaMD source was copied or changed.
  The example builds with an explicit relative `--config` path and passes
  the packager's automation screenshot smoke test. Config module loading now
  resolves relative paths from cwd and encodes spaces/`#` as file URLs.
- [x] Real macOS packaged acceptance (`bun scripts/test-file-associations.ts`):
  cold launch with two files before a deliberately delayed subscription;
  warm launch of another file plus a deep link; repeated file intent; paths
  containing Chinese, spaces, `#` and `%`; exactly one process; cleanup.
- [ ] Windows/Linux file association registration and packaged acceptance.
- [ ] Portable single-instance lock/IPC, including concurrent startups, stale
  owner recovery and second-instance argv/cwd delivery. macOS Launch Services
  reusing a running app is **not** a portable single-instance guarantee.
- [ ] CLI argument policy remains application-owned; do not guess executable
  and entry-point positions or treat arbitrary option values as documents.

No GPUI fork change is needed: `gpui::Application::on_open_urls` is wired before
`run_embedded`, and `gpui_macos/src/platform.rs` implements
`application:openURLs:` using NSURL absolute strings. Apple documents that this
[delegate replaces openFile/openFiles callbacks](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/application%28_%3Aopen%3A%29?language=objc).
Bundle metadata follows Apple's
[CFBundleDocumentTypes](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundledocumenttypes)
and [UTI declaration rules](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/understanding_utis/understand_utis_declare/understand_utis_declare.html).

Next P1 work: HTML clipboard in GPUI first; native popup support also needs
a platform API, since the checked-out GPUI Platform/Window interface has no
OS popup-menu command. Multi-window and single-instance routing need a separate
lifecycle design. PDF layout/export remains independent of these shell APIs.

## Validation scope

Automated tests cover scroll interpolation, real native clamping, cancellation,
replacement, missing targets, timeout/errors, drag-prop mutation and sibling
button routing, and zoom command recording. The offscreen test renderer records
zoom instead of resizing; these tests do **not** prove OS snapping or live drag.

Local verification (2026-09-19): release native build and `cargo test --lib`
(311 passed); Vue suite with `--maxWorkers=2` (59 files, 966 passed, 141 skipped).
The user's unrelated untracked `combobox-aschild-debug.test.tsx` is excluded.
An initial unrestricted parallel run hit two subprocess timeouts; each passed
in isolation and the complete bounded-concurrency rerun passed.

Second delivery verification (2026-09-19): release native build, Vue TypeScript
build, Rust unit suite (311 passed), full Vue suite (60 files, 972 passed,
141 skipped, two workers and the same unrelated debug file excluded), packager
suite (9 passed, including Apple's `plutil` parsing), and the packaged macOS
acceptance script above. Windows/Linux OS behavior is not claimed as tested.
