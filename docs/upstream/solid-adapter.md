# Solid adapter

**Status:** declined
**Commits:** `919a736` (first-party Solid renderer, ~3k lines), `9d39e7f`
(document + publish, CI), `db3b9b4` (Solid chat example, preload, mount-memory
scripts), `7d40fb6` (solid.mdx guide, presence tests in `Show`), `9b78e77`
`9898020` `9fcd628` (Solid consumer install tests + CI), plus the
`bun.lock`/root-package.json wiring inside `919a736`.
**Decided:** 2026-09-26 (upstream-sync round `7ac9880..9fcd628`)

## What upstream shipped

A `@gpuix/solid` package: JSX runtime, host config, AnimatePresence / motion /
Combobox / Select / Tooltip ports, a bun plugin, testing facade, universal
renderer, and a 1.9k-line Solid chat example with memory benchmarks — riding
on the shared adapter runtime they extracted into `@gpuix/native` (see the
pending *Shared adapter runtime* row).

## Why we decline

GPUIV **is** the Vue binding. Upstream's multi-adapter strategy (React + Solid
off one shared runtime in the native package) exists to serve frameworks we do
not carry. Porting a Solid adapter here would add a package nobody in this
fork consumes, plus CI surface, for zero user value.

The AnimatePresence / motion / floating logic upstream built for Solid is
already ported where it matters: the Vue `AnimatePresence` (PR #121) covers
exit animations, and `452ea21`'s generation-aware completion fix rode along in
that same PR.

## Revisit triggers

- GPUIV decides to ship a non-Vue adapter (then the *Shared adapter runtime*
  pending topic becomes the prerequisite, not this one).
- A downstream consumer asks for a Solid target with a concrete use case.
