# Upstream topic: Wasm / browser rendering

- **Status:** Declined — investigated 2026-08-27, not synced
- **Upstream range inventoried:** `367ef48..64241ce`
- **Decision:** recorded in [`README.md`](./README.md); revisit triggers at the
  end of this file

## What upstream built

Upstream compiles the **same Rust renderer** (`RetainedTree` + `GpuixView` +
GPUI) to `wasm32-unknown-unknown` and runs it in the browser on **WebGPU**. It
is not a second web implementation — it is one crate with two targets:

| | Desktop | Browser |
|---|---|---|
| Bridge | napi-rs (`.node`) | wasm-bindgen (`gpuix-web.js`) |
| GPU backend | Metal / Vulkan | wgpu (WebGPU) |
| Platform | `gpui_platform` (AppKit / Windows / Linux) | `gpui_platform::single_threaded_web()` → `gpui_web` |
| JS binding code | unchanged | unchanged — same `NativeRenderer` calls |

## The layers

### 1. Rust: `WebGpuixRenderer` (`packages/native/src/renderer.rs`)

A `#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]` export parallel
to the desktop `GpuixRenderer`, with matching method names (`createElement`,
`setStyle`, `applyBatch`, …). `init()` calls `start_web_app()`:
`gpui_platform::web_init()` + `single_threaded_web().run_embedded(...)`, which
opens one full-screen GPUI window — in practice a `<canvas>` appended to
`<body>`. Init is once-only ("GPUIX web is already running"). Events flow back
to JS through a `js_sys::Function` callback queued via `queue_microtask`.
napi dependencies are cfg'd out of the wasm build entirely.

### 2. Cargo: target-conditional dependencies

- wasm: `gpui` with `default-features = false`, `gpui_platform` without
  wayland/x11/font-kit
- non-wasm: napi + the desktop platform features
- **Syntect dual engine** (`75a1fe6`): native uses Oniguruma (C, ~10× faster
  grammar load), wasm uses fancy-regex, because `onig_sys` cannot compile for
  `wasm32-unknown-unknown` (no libc; the Cargo.toml comment says "Do not try
  again"). The two dependency sections must stay exactly complementary —
  syntect rejects both engines at once.

Our fork already builds with Oniguruma only (PR #4), so we already have the
native half of this split.

### 3. JS: the `"browser"` package field

`packages/native/package.json` adds `"browser": "browser.mjs"`. Any bundler
doing a browser build swaps the package entry to the wasm loader —
`browser.mjs` is three lines: `init()` the module, re-export `GpuixRenderer`.
Because of this, the React binding source has **zero changes** for the web;
it never knows which backend it is talking to. The published npm package ships
the `.wasm` files in `packages/native/wasm/`.

### 4. Build and serve

- `scripts/web.ts` (in-repo dev): `cargo +nightly build --target
  wasm32-unknown-unknown --no-default-features --release` → `wasm-bindgen
  --target web` → `packages/native/wasm/` (gitignored) → Bun's dev server with
  React Fast Refresh. Its header comment explains in detail why HMR never
  re-initializes the wasm module (Bun re-runs only changed modules and walks
  importers upward).
- `example-app/web.ts` (the copied starter): `Bun.build` + `Bun.serve`, same
  isolation headers.

### 5. Website deployment

`website/` deploys to **gpuix.dev** on Cloudflare Workers (Spiceflow +
holocron docs). `/chat-example` serves the full chat example rendered by
WebGPU in the page — the marketing payoff: the same component code runs on
desktop and in the browser unchanged.

## Browser adaptations (all hard-won)

- The wasm links with `--shared-memory`, so `WebAssembly.Memory` needs
  `SharedArrayBuffer`, which requires a **cross-origin isolated document**.
  Every response — dev server and Cloudflare alike — carries
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Bun.serve cannot add headers
  to an HTML route, so the document is re-served from a private path.
- `web.html` disables native text selection, the iOS long-press callout, and
  the tap highlight, because GPUI paints every glyph itself and owns
  selection; the hidden GPUI IME `<textarea>` is the exception and keeps a
  real selection for composition, backspace context, and clipboard.
- Web-only fixes in the range: reversed diagonal resize cursors (`bbcea1f`,
  zed submodule), browser word navigation, hidden IME input, a wasm build
  break after the highlight prop landed (`711945f`).

## What this fork already has

- The zed submodule at our current pin (`773208d`) already contains
  `zed/crates/gpui_web/` and `gpui_platform::single_threaded_web()` /
  `web_init()` — the platform layer upstream calls into exists in our tree
  today.
- `@gpuiv/vue` only depends on the `NativeRenderer` interface, so a
  `"browser"` field would swap the backend with **zero changes to the Vue
  renderer source**.

## Why we are not syncing it

1. **Its value today is a demo**, not a production path — upstream uses it for
   the gpuix.dev chat example and the installable starter's web target.
2. **Real port cost**: the `WebGpuixRenderer` block (~500 lines of
   wasm-bindgen boilerplate), three Cargo cfg dependency sections (and our
   syntect would need the fancy-regex wasm branch added), `browser.mjs`,
   `scripts/web.ts`, `.cargo/config.toml`, CI, plus a Vue-flavored example and
   HTML shell.
3. It drags in upstream **CI and website changes we have already declined**
   (one-target-per-OS matrix, archive shipping, docs-site deploy).
4. Nobody has asked to run a GPUIV app in a browser yet.

## Revisit triggers

Sync this topic when any of these becomes true:

- We want a public browser demo of GPUIV (the "same Vue code, GPU on the web"
  pitch).
- Upstream promotes wasm to a supported production target (not just the demo
  site) — watch for user-facing `"browser"` bug fixes in their changesets.
- Zed upstream stabilizes `gpui_web` materially (multithreaded mode without
  SharedArrayBuffer isolation would remove the COOP/COEP hosting constraint).

## Upstream commits in this topic

`75a1fe6` (Oniguruma/fancy split), `92082a3` (docs site), `7d6e1f9` (Bun dev
server + Fast Refresh), `711945f` (wasm build fix), `7f6732a` (ignore browser
bundle), `bbcea1f` (web resize cursors), `291b92d` (deploy WebGPU chat
example), `a906cf9` (website backout), `f52fa54` (changelog nav).
