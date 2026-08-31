# Tablet input (pen pressure / tilt / touch / coalesced events)

Topic: what it would take for GPUIV to get tablet-class input (数位板), and the
state of that support in the zed submodule (`remorses/zed`, `gpuix` branch) and
in [`zed-industries/zed`](https://github.com/zed-industries/zed) upstream.

**Status:** researched, not implemented. This is not a `remorses/gpuix` topic —
it lives in the zed submodule. Investigated 2026-08-31 while sizing the
Draw.live (茶绘君) port; see the PR for the canvas bridge that ships without it.

## What the fork already has (local facts)

| Item | Fact | Where |
|---|---|---|
| `MousePressureEvent` | macOS **force trackpad** pressure (`pressure: f32` 0..=1, `PressureStage` Zero/Normal/Force). Not tablet pen pressure. | `crates/gpui/src/interactive.rs:234`, wired in `crates/gpui_macos/src/events.rs:190-209` |
| `TouchEvent` / `TouchId` / `TouchClickEvent` | API surface exists ("finger or stylus contact", `force: Option<f32>`), but the comment says *"Dispatch contract (core implementation pending)"* and `PlatformInput::mouse_event()` returns `None` for touch — **touch is never dispatched to elements**. | `crates/gpui/src/interactive.rs:109-135` |
| `PinchEvent` | Trackpad pinch (magnification) is generated on macOS and dispatches; `on_pinch` exists. | `crates/gpui/src/elements/div.rs:383` |
| macOS mouse events | Down/move/up read only `eventType`, `buttonNumber`, `locationInWindow`, `clickCount`, `modifierFlags`. **`NSEvent.pressure` is dropped**, and tablet strokes arrive as synthetic `NSMouseMoved`/`Dragged` with subtype `NSTabletPointEventSubtype` — lines draw, pressure is lost. No `NSEventTypeTabletPoint` match arm at all. | `crates/gpui_macos/src/events.rs:142-164, 288-321, 333` |
| Coalesced events | Nothing. macOS does not need them (`NSMouseMoved` is per-sample); Windows would need `GetPointerPenInfoHistory`. | — |

## Upstream zed status

| Ref | What | State | Verdict |
|---|---|---|---|
| [PR #63250](https://github.com/zed-industries/zed/pull/63250) | **Stylus pressure on the three mouse events** (`pressure: f32`), wired on all four platforms (macOS `NSEvent.pressure`, Windows `WM_POINTER`, X11 XInput2, Wayland `zwp_tablet_v2`); mouse defaults to 1.0 | OPEN since 2026-08-26, awaiting first review | **Best path.** Bump the submodule once merged; mirror the field contract so the future bump is a no-op |
| [PR #60496](https://github.com/zed-industries/zed/pull/60496) | Mobile/touch API surface | MERGED 2026-07-11 — this is where the local `TouchEvent` comes from | API only; implementation explicitly deferred |
| [Issue #13698](https://github.com/zed-industries/zed/issues/13698) | Touch input support (canonical) | OPEN | Whole-platform touch has no owner |
| [PR #40139](https://github.com/zed-industries/zed/pull/40139) | Wayland touch events | OPEN, no reviews since 2025 | Not worth waiting on |
| tilt (`tiltX`/`tiltY`) | No upstream issue, PR, or code anywhere | — | **Fork-only.** macOS `NSEvent` has `tilt` (pen-only); the cocoa binding for `pressure()` already exists in `gpui_macos`, tilt likely needs a hand-written `msg_send!` |
| coalesced events | No upstream discussion | — | Fork-only; macOS doesn't need it, Windows does for full sample curves |

zed itself consumes pressure only for trackpad force-click word selection
(`crates/editor/src/element/mouse.rs:962`). No drawing consumer exists upstream.

## Recommended path per capability

1. **Pen pressure** — track #63250. If it stalls, fork it: add `pressure: f32`
   to the three mouse events in `crates/gpui/src/interactive.rs` and read
   `native_event.pressure()` in the mouse branches of
   `crates/gpui_macos/src/events.rs` (the binding already exists — see line
   192). Copy #63250's contract (mouse = 1.0, not 0.0) so bumping later is
   trivial.
2. **Tilt** — fork-only, one PR: event fields + macOS read. Use CSS
   PointerEvent names (`tiltX`/`tiltY`).
3. **Multi-touch** — the API surface is in the tree but nothing dispatches it.
   For desktop drawing this rarely matters (macOS has no touch screen; trackpad
   gestures arrive as `Pinch`/`ScrollWheel`). Revisit only for touch-screen
   Windows or a mobile backend; tracking issue #13698.
4. **Coalesced events** — skip on macOS. Windows: fork
   `crates/gpui_windows/src/events.rs` toward `GetPointerPenInfoHistory` if
   full-sample strokes ever matter there.

Once GPUI carries the fields, the GPUIV side is small: `EventPayload` gains
`pressure`/`tiltX`/`tiltY` (`element_tree.rs`), `wire_host_events` forwards
them, and `EVENT_TYPES` on the JS side lists them.

## Revisit triggers

- PR #63250 merges (or moves) → bump the submodule and wire `pressure` through.
- A drawing app actually ships on gpuiv and needs tilt → fork PR.
- Touch lands on any desktop platform upstream → re-evaluate pinch/two-finger
  gestures on the canvas element.
