# iOS IPA shipping plan

Upstream commits: `e082247` (705-line `plans/ios.md`), `6b4be86` (in-bundle
`dlopen` is legal).

## What upstream did

A design investigation for shipping GPUIX (React) apps as iOS IPAs:
Xcode project shape, framework embedding, code-signing, the Node/hermes
runtime story, and the dyld constraints around loading a `.node` addon from
an app bundle. The follow-up concluded in-bundle `dlopen` is legal, which
unblocks their approach.

## Why declined

- It is a plan for **their** packaging surface. Our packaging story is
  `@gpuiv/packager` targeting macOS `.app` and a Windows portable folder;
  there is no iOS target here to attach this work to.
- GPUIV's platform story is the embedded-AppKit pump on Node's main thread
  (macOS) and a dedicated UI thread elsewhere; an iOS target would be a
  platform decision first (does `gpui` + napi-rs even build for iOS?), not
  a port of a markdown plan.
- Nothing user-facing in `@gpuiv/vue` or `@gpuiv/native` changes either way.

## Revisit triggers

- We commit to an iOS target for `@gpuiv/packager` (or a customer asks for
  an IPA build).
- `remorses/zed` `gpuix` branch grows real iOS platform support that our
  submodule bump would pick up anyway.
