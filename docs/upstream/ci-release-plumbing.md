# Upstream topic: CI and release plumbing

- **Status:** Declined; the latest extension is `c00fd93` (2026-09-26).
- **Decision:** The upstream matrix and release instructions describe its
  React/Solid adapter packages and archive distribution. GPUIV publishes its
  native and Vue packages through its own changeset and CI pipeline.

## Why we are not syncing it

Upstream builds one native target per operating system and creates separate
GitHub releases for the React and Solid adapters. Our CI builds both GPUIV
packages and our releases use changesets. Copying upstream's job names, tag
rules, or adapter-specific instructions would describe a different release
process and could mislead maintainers.

## Revisit triggers

- We add another first-party adapter that needs its own release notes and tag.
- Our CI switches to the same one-target-per-OS artifact and archive layout.
- We adopt upstream's release toolchain instead of the current changeset flow.

The ledger lists all upstream commits assigned to this topic.
