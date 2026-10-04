# Build and contribute

[Project overview](../README.md) · [API reference](reference.md) · [Architecture](architecture.md)

For your own app, the [published-package quick start](../README.md#quick-start)
uses prebuilt native binaries. Build from source to run the repository's
examples, change Rust code, or contribute a fix.

## Building

Install [Bun](https://bun.sh), the Rust toolchain pinned in
[`rust-toolchain.toml`](../rust-toolchain.toml), and the host tools required by
GPUI. On macOS, install Xcode and its Metal toolchain:

```bash
xcodebuild -downloadComponent MetalToolchain
```

Clone with the pinned GPUI submodule. In the fresh clone, create its local
`gpuix` branch at that pinned commit:

```bash
git clone --recurse-submodules https://github.com/liuyanghejerry/gpuiv.git
cd gpuiv
git -C zed switch -C gpuix
bun install
bun run build
bun run --cwd packages/beautiful-ui build
cd examples
bun --hot chat.tsx
```

The root build compiles `@gpuiv/native` in release mode, then `@gpuiv/vue`.
`beautiful-ui` is a separate, private workspace package; build it before
running its gallery. Examples import the built packages, so rebuild Vue after
editing its source. See [the build notes](../AGENTS.md#building) for pinned
GPUI dependencies and [the Zed workflow](agents/zed-workflow.md) for changes
to the submodule.

## Testing

Run the vitest scripts with `bun run test`:

```bash
cd packages/vue && bun run test
cd ../../examples && bun run test
cd ../packages/native && cargo test --lib
```

The [testing guide](agents/testing.md) covers platform support, native text
assertions, and performance budgets. For application tests, start with the
[automation API](reference.md#automation) and
[GPU-backed test renderer](reference.md#testing).

## README screenshots

After building the packages, regenerate the committed screenshots on macOS or
Windows with a GPU available:

```bash
bun scripts/screenshots.ts
```

The script runs the visual tests and captures the real example components via
[`examples/readme-screenshots.ts`](../examples/readme-screenshots.ts). It renders
offscreen and writes the curated images into [`docs/images/`](images/).
ImageMagick is optional; when available, it compresses the PNGs losslessly.

## Developing the Rust side

JS remount is covered above. There is **no hot reload for the native half**,
and there cannot be: `require()` of a `.node` file calls `process.dlopen`, Node
has no matching unload, and the live state (GPUI's platform, GPU device, open
window, UI thread, and selection registry) stays inside the loaded library. A
second load would create independent native state while the first library
remains loaded.

Always build the native addon in **release** mode (`bun run build` in
`packages/native`). Debug builds make GPU rendering much slower and cannot
be used to judge app performance.

`bun run dev` provides a rebuild loop: it watches `packages/native/src`,
rebuilds, and re-renders the screenshot tests. **Rust edit to fresh PNGs is
about 4 seconds.**

```bash
bun run dev                      # rebuild, re-render the showcase screenshots
bun scripts/dev.ts --shots diff  # only tests matching "diff"
bun scripts/dev.ts --app native-text   # rebuild, restart an example app
```

Screenshot mode is the better default. Open
`packages/vue/screenshots/showcase.png` in Preview.app, which reloads on
write, and unlike a live window the PNG can also be read by an agent.

Two things avoid the rebuild entirely:

- **Content** already lives in props. Change `patch` or `source` and the next
  frame shows it.
- **Design numbers** live in `theme.metrics`. Tuning a row height or heading
  scale is a Vue re-render.

The test renderer uses `VisualTestAppContext` with a `TestDispatcher` for deterministic scheduling. Event simulation goes through GPUI's coordinate-based hit testing and dispatch — not synthetic JS events.
