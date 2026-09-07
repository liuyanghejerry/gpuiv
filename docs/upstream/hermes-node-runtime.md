# Hermes-node runtime docs

Upstream commit: `2d6e599`.

## What upstream did

A `hermes/` example directory (app, build script, shims for automation and
safe-MDX) plus website guide documentation for running a GPUIX React app on
**hermes-node** — a Hermes-engine build of the Node runtime — as part of
their packaging experiments.

## Why declined

- It documents a runtime we do not support and have no demand for:
  GPUIV runs on Node and Bun through the embedded platform pump, and every
  test, example, and the packager assume that.
- The website half (`website/docs.json`, `guides/hermes.mdx`) extends the
  already-declined wasm/website topic ([wasm-web-rendering.md](./wasm-web-rendering.md)).
- The shims (`shim-automation.js`, `shim-safe-mdx.js`) patch React-binding
  specifics we do not share.

## Revisit triggers

- We need to ship GPUIV apps on a non-V8/JSC engine (e.g. embedded Hermes
  for app bundles), or Bun/Node stop being viable hosts.
- Upstream's hermes runtime becomes load-bearing for a feature we port
  (then the shim design is the interesting part, not the docs).
