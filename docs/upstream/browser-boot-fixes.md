# Browser boot fixes (process guards, wasm key-event queue)

Upstream commit: `af9c8bb` ("Stop the browser chat example from dying before
WebGPU opens").

## Reason

Every hunk exists for the browser/Wasm build, which we do not ship (see
[wasm-web-rendering.md](./wasm-web-rendering.md)):

- `PENDING_WINDOW_KEY_EVENTS` queues `setWindowKeyEvents` until the async
  WebGPU window exists. Our desktop platforms open the window synchronously
  before napi calls can arrive, so there is nothing to queue.
- The `typeof process === "undefined"` guards (`readMacCpuThrottle`,
  `render()`'s `process.exit`) are no-ops under bun/Node, where `process`
  always exists.
- The `OVERLAY_MONO` change replaces the per-platform monospace pick
  (`Consolas`/`Menlo`/`DejaVu Sans Mono`) with a CSS font stack
  (`"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`). Desktop
  GPUI resolves `fontFamily` as a single family name, not a CSS list, so
  porting it would silently un-mono our runtime-error overlay
  (`packages/vue/src/renderer.ts`).

## Revisit triggers

- we ever build the wasm target — then port this together with the rest of
  the wasm topic
- desktop GPUI learns to resolve comma-separated font stacks — then the
  single-constant `OVERLAY_MONO` becomes safe to adopt
