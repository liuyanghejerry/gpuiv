# Terminal rendering mode (`terminal: true`)

Upstream renders GPUI apps **inside a terminal**, speaking the kitty graphics
protocol (plus ASCII fallbacks), including over SSH, with an embedded mode for
hosts that own the run loop and wgpu offscreen rendering on Linux. The Rust
side lives in `packages/gpui-terminal` upstream and in the zed fork
(`crates/gpui_terminal`, brought in by the 2026-10 submodule bump).

## Upstream commits

`eae33e8` (render apps inside the terminal with `terminal: true`),
`4aa2fca` (works over SSH), `2d274f5` (kitty-graphics terminals),
`4bf7ae6` (Linux through wgpu offscreen rendering), `a6c4fda` (embedded mode
for hosts that own the run loop), `8dfbcaa` (forward only SIGWINCH),
`ca1c94c` (inline frames when shared memory is unreachable), `9b100ef`
(crate moved to `packages/gpui-terminal`); zed `8a346ab79`…`f77e5cfe9`
+ `44e8b726a` (offscreen Metal for non-window hosts).

## Status: pending

A whole new platform surface (window creation, frame transport, input decode,
resize signals) riding a new crate. GPUIV is a desktop Vue binding; nothing
here asks for terminal output yet, and the port is not mechanical: the JS side
would need a `terminal: true` init path plus a frame/pacing contract, and the
Linux wgpu path pulls a large dependency tree into the addon.

## Revisit triggers

- A user asks for terminal or SSH rendering of GPUIV apps.
- The `gpui_terminal` crate stabilizes an embedded-host contract we can call
  without forking its run loop.
- Packaging work (P1/P2) wants a headless preview surface.
