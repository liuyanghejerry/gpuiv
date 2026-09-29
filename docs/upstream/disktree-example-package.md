# Disktree example → standalone npm package

**Upstream commits:** `ad218e7` `cbc4065` `b3c2823` `193f9c9` `0846f89` `e8efacb` `4ecca30`
**Status:** declined (2026-09-29 inventory round)

## What upstream shipped

A new `examples/disktree` app — a light frosted port of
[tobi/disktree](https://github.com/tobi/disktree), a GPU-rendered treemap of
disk usage (`ad218e7` `cbc4065`) — then extracted it into a top-level
`disktree/` workspace package published to npm as **`disktree` 0.2.0**: a
`bunx disktree` CLI plus an embeddable app entry, a scan worker with reduced
memory and no `bun:ffi` iCloud check, README/screenshot, and release plumbing
(local publish instead of CI) (`b3c2823` `193f9c9` `0846f89` `e8efacb`
`4ecca30`).

## Why we decline

- It is an **upstream-only product surface**: the package name, npm presence,
  CLI, and release flow advertise GPUIX. We publish `@gpuiv/*` libraries and
  have no equivalent product — the same reasoning as the declined
  `create-gpuix-app` CLI topic.
- **No binding-layer changes ride along.** Every commit in the range touches
  only `examples/`, `disktree/`, CI workflows, README/AGENTS docs, and
  `bun.lock` — nothing in `packages/native` or the adapter packages, so there
  is nothing to port for our users.
- The CI hunks (`193f9c9` `e8efacb`) add publish jobs for a package we do not
  have, extending the already-declined CI/release-plumbing topic.

## Revisit triggers

- We want a flagship demo of a blurred-window + worker-driven scan app in
  `examples/` — the *example* half (`ad218e7` `cbc4065`) could then be ported
  as a Vue demo without adopting the npm package.
- Upstream's `disktree` starts requiring binding changes (new window, worker,
  or filesystem APIs) that our users would also want.
