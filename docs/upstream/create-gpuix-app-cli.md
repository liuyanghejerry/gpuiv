# `create-gpuix-app` CLI scaffolder

**Upstream commits:** `6e75327` `4a24b43` `3e2d121`
**Status:** declined (2026-08-29 inventory round)

## What upstream shipped

A `cli/` workspace package published to npm as `create-gpuix-app`. It scaffolds
a starter project (their `example-app/`) with pinned dependency versions, plus
CI to publish the CLI independently of the library packages, and a fix so the
package-manager entry detection works when the CLI is invoked through `npm
create` / `bun create` / `pnpm create`.

## Why we decline

- It is an **upstream-only publishing surface**: the package name, the starter
  it generates, and its version pinning all advertise `@gpuix/*` (the React
  binding). We publish `@gpuiv/*` and have no starter to scaffold — the same
  reason the `example-app/` starter topic was declined.
- The CI changes (`4a24b43`) add a release job for a package we do not have;
  our CI already publishes both of our packages in the required order.
- Maintaining a scaffolder here would mean duplicating upstream's template
  with our package names and Vue entry points, for a starter we do not ship.

## Revisit triggers

- We ship an official starter / template app for `@gpuiv/vue`.
- Users repeatedly ask for `bun create gpuiv`-style bootstrap.
- Upstream's CLI grows framework-agnostic plumbing (a template registry rather
  than a hard-coded React starter) that we could consume instead of forking.
