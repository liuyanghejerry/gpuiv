# cargo-packager configs / Dock icon

Upstream commit: `e892721` ("Add cargo-packager configs so a compiled GPUIX
app gets a Dock icon").

## Reason

The commit adds `packager.json` configs for upstream's cargo-packager flow
(`examples/packager.json`, `hermes/packager.json`) plus a README guide for
that tool. This fork ships its own packager (`packages/packager`), which
produces the macOS `.app` and the Windows portable exe directly and already
bundles Dock/file icons (`src/icons.ts` generates `AppIcon.icns` / app-icon.ico;
`src/macos.ts` wires the bundle). Adopting a second packaging tool would only
drift the two pipelines apart.

Design docs: `docs/packaging-plan.md`.

## Revisit triggers

- we adopt cargo-packager as the bundler under `packages/packager`
  (phasing P1/P2 of the packaging plan)
- our packager grows a resource-bundle case the configs solve better
