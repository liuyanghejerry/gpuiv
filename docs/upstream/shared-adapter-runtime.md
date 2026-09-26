# Shared adapter runtime in `@gpuix/native`

**Status:** pending (deferred by the maintainer, 2026-09-27)
**Commits:** `239acc4` (JS/package half) `2f0a298` `452ea21` (JS half)
`1881927` `072edb6` `f1293a3`
**Inventoried:** 2026-09-25 round (`7ac9880..9fcd628`), recorded in PR #122;
deferral decided 2026-09-27 after an architecture review.

## What upstream did

`@gpuix/native` became a TS+Rust package: the framework-neutral runtime
(host contract, mutation queue, renderer ownership/event dispatch, testing,
automation client+protocol, observers, cpu-throttle) moved from
`@gpuix/react` into `packages/native/js`, compiled to `dist/` and published
as subpath exports (`./host`, `./testing`, `./automation`, `./runtime`)
alongside ESM (`index.js`) + CJS (`index.cjs`) napi loaders, napi CLI 3.10,
and runtime deps `zod` / `eventsource-parser`. React deleted ~3.7k lines and
consumes the shared runtime; Solid was added as a second adapter.
`NativeRenderer` was split into small host contracts (`MutationHost`,
`WindowSizeHost`, …) in `1881927`.

We did **not** port this. All `.rs` hunks of these commits are already in
(motion via PR #121, img/scroll via PR #120) — the divergence is purely the
JS packaging/ownership layer.

## Current fork shape vs upstream

```
upstream:  @gpuix/native (Rust + shared JS runtime) ← react, solid
ours:      @gpuiv/native (napi-only, Rust) ← @gpuiv/vue (owns all JS runtime)
```

Our `packages/vue` holds: `reconciler/` (host config + batch-renderer queue
+ event-registry), `automation/` (client + protocol, our own copy with fork
additions), `testing.ts` (TestRenderer core + Vue facade), hooks polling
cores, `cpu-throttle`, components, `dialogs.ts`.

## What a future port would look like

Move into `@gpuiv/native`: the mutation queue, event-registry/renderer-state,
automation client+protocol, testing core, observers, cpu-throttle — exposed
as subpath exports mirroring upstream. Keep in `@gpuiv/vue`: the Vue host
config (`patchProp` semantics, host `<text>` string-child normalization),
all components (Vue reactivity, never shareable), `createApp`/`createTestApp`
scheduler integration, error overlay, `bun --hot` registry, Vue composables.
The microtask `schedule` hook becomes a public parameter of `./mutations`
instead of a vue-private detail.

Known risks, in the order they bite:

1. **Fork deltas in the shared files.** Our automation/testing copies carry
   things upstream lacks (component-inspector, the dialogs answer queue,
   window-shell, devtools). Port as separate modules in `native/js` rather
   than editing upstream's files, so future syncs stay mechanical.
2. **Publishing surface.** `@gpuiv/native` gains TS build, dual loaders, and
   runtime deps; `prepublishOnly` and the AGENTS.md mutation-protocol paths
   must follow.
3. **Size.** Largest single topic in the ledger (~+5k/−4k lines across the
   two packages). Suggested split: (a) `239acc4`+`452ea21` — create
   `native/js`, loaders, exports; (b) `2f0a298`+`1881927` — slim
   `packages/vue` onto the shared runtime, split host contracts.

## Why deferred

Single adapter, no second consumer on the horizon; our napi-only native
package is simpler to publish and reason about. Hand-porting upstream's
JS-side changes into `packages/vue` has so far stayed tractable (the JS-side
delta this round was small).

## Revisit triggers

- Upstream JS-side churn (automation protocol, testing surface) starts
  requiring non-trivial hand-ports each round.
- We decide to ship a second adapter (e.g. `@gpuiv/solid`) — this topic is
  the prerequisite for that one.
- Fork additions in our `automation/` / `testing.ts` copies begin to
  conflict with upstream's versions of the same files.
