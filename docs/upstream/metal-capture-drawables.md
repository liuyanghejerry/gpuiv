# Metal screenshot drawable lifetime

Live-window screenshot capture in the embedded macOS host could leave
autoreleased Metal drawables alive after returning to JavaScript. The host
calls capture between AppKit pump turns, outside the pump's autorelease pool.
After a few captures, the three-drawable pool was exhausted and subsequent
presentation repeatedly blocked in `CAMetalLayer.nextDrawable` for about one
second. Layout and synthetic input dispatch remained fast, masking the stall.

The GPUI fix scopes `MetalRenderer::render_to_image` in an autorelease pool.
Readback finishes before that pool drains, and the returned image owns its CPU
pixels. No drawable or Metal texture escapes the capture call. Presentation,
vsync, scroll handling, and the screenshot API are unchanged.

Fix commit: `e62e58de66`, prepared in the separate Zed worktree
`/Users/liuyanghejerry/develop/zed-gpuiv-drawable-pool` on
`fix/metal-drawable-pool`. The maintainer requested on 2026-10-08 that this remain local for now;
no upstream submission or remote push is planned in this task. The running local release addon was built from that
worktree; until the pointer is updated, rebuilding from the old submodule
will omit this fix.

## Verification

`packages/native/examples/capture_present.rs` uses the real embedded MacPlatform,
captures outside a host autorelease pool, then explicitly presents cached
frames. It works with an unfocused window and does not depend on the display
link running while a window is occluded. It checks screenshot pixels and
repeats capture/presentation twice.

```sh
cd packages/native
cargo run --release --example capture_present
```

Measured on the same machine (release, 2026-10-08):

- Original GPUI: regression fails at presentation, **1,012 ms**.
- Fixed GPUI: both rounds pass; slowest presentations **6.38 / 2.57 ms**.
- A JS live-window reproduction: 20 scroll/present cycles after four captures
  take **9,499 ms** before the fix and **383 ms** after it, including 16 ms waits.
- The private 98-PR workbench fixture: eight full-window captures followed by
  60 scroll/present cycles; maximum combined dispatch/presentation **3.51 ms**.
  Private PR data and screenshots are not committed.

The earlier frame-pump and visible-row optimizations did not fix this resource
lifetime bug. Pure `dispatchScrollWheel` or headless renderer timings do not
cover presentation; include an actual `present_cached_frame` call in this
regression. Disabling display synchronization or flushing Core Animation
transactions did not remove the reproduced stall.

## Upstream research

- [Zed #53390](https://github.com/zed-industries/zed/issues/53390) reports a
  `nextDrawable` hang, but does not establish this capture-lifetime cause.
- [Zed #64099](https://github.com/zed-industries/zed/pull/64099) scopes
  **headless** rendering in an autorelease pool. The window-backed
  `render_to_image` path still needs this scope.
- Searches in `zed-industries/zed` and `remorses/zed` for
  `render_to_image next_drawable` / `screenshot drawable` found no existing
  window-capture fix at the time of this change.

Offer the embedded-host fix to `remorses/zed:gpuix`; carry it in our fork until
it lands there. Drop the divergence when an upstream pin includes equivalent
window-capture lifetime handling and passes the regression above.
