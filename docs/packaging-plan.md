---
title: Packaging Plan
description: Multi-platform app packaging for GPUIV applications — macOS .app and Windows portable exe first, bun compile as the bundler, napi .node embedded per target, signing and CI distribution. Implemented (P0); this document records the design and the build findings.
---

# Packaging Plan

Closes the "`.app` packaging script" item in the desktop-chat gap inventory
(#50). P0 is **implemented** (`packages/packager`, CI `package-macos` /
`package-windows` jobs); the "Implementation record" section lists what the
build surfaced beyond the original design.

## Goal

Turn a GPUIV app (any app, not just `chat.tsx`) into a distributable,
double-clickable desktop product with one command:

```
bunx @gpuiv/packager build          # current platform
bunx @gpuiv/packager build --target win32-x64
```

Priorities:

1. **macOS**: `Foo.app` (correct name/icon/metadata, runs from Finder and Dock)
2. **Windows**: portable `Foo/` folder with a GUI-subsystem `Foo.exe`
3. **Linux**: same mechanism, AppImage packaging deferred (P2)

Non-goals for v1: auto-update, installers (MSIX/NSIS/dmg), tray/deep-link
(those ride on this in later phases, and the layout must not preclude them).

## Current state

- `examples/compile-chat.ts` is a working prototype: `Bun.build({ compile })`
  → bare binary, hand-wrapped `.app` with icon pipeline (`rsvg-convert` /
  `magick` / `iconutil`), Windows `windows: { icon, hideConsole, … }` options.
  It is example-specific, has no story for pinning the native binding, no
  signing, no CI, no smoke test.
- CI (`.github/workflows/ci.yml`) already builds and uploads per-target
  `.node` artifacts for all six napi targets, so packaging jobs never rebuild
  Rust.
- The napi loader (`packages/native/index.js`) resolves the binding at runtime
  through ~20 `require` branches: `./gpuiv-native.<platform>.node` → optional
  dependency package → `NAPI_RS_NATIVE_LIBRARY_PATH`.

## Research findings that shape the design

Verified against Bun 1.4.x docs/blog (2026-09):

1. **`.node` embedding in compiled executables is an official feature.**
   `require("./addon.node")` from a bundle is embedded and extracted at first
   load to a **content-hashed file in the temp dir**, reused across restarts
   (Bun 1.4.0 deduped the temp copies; the 1.3.x multi-module export bug is
   fixed). The loader's *dynamic* platform resolution, however, is exactly the
   "node-gyp-style indirect require" Bun warns about — **the packager must pin
   the binding to one explicit `.node` per target** (see the shim below).
2. **All 8 `bun-<os>-<arch>` targets cross-compile from any host** (Bun
   downloads the target runtime via `bun-bin`). Exceptions that matter:
   - Windows `icon/title/publisher/version/description` **cannot be set while
     cross-compiling** — the Windows product must be built on a Windows host.
   - There is **no `bun-darwin-universal` target**. A universal app would need
     `lipo` over two compiled exes plus re-codesign; whether Bun's embedded
     filesystem survives `lipo` is unverified — treat as a spike, ship
     per-arch `.app`s first.
3. `windows.hideConsole` (GUI subsystem) is available even cross-compiled;
   version metadata needs Bun ≥ 1.3, icons ≥ 1.1.41. No UAC/manifest support —
   fine for a chat app.
4. Assets imported `with { type: "file" }` (how every example already loads
   icons) land in the embedded `/$bunfs/` filesystem; `node:fs` reads them
   natively since 1.4. **Resource handling needs no new mechanism.**
5. `--bytecode` (ESM supported) and embedded zstd sourcemaps both work with
   `--compile`; stacks resolve back to source paths. Bytecode cuts startup for
   large bundles but does **not** hide source (JS stays recoverable — note it
   in docs, don't claim obfuscation).
6. macOS notarization on GitHub Actions is standard
   (`apple-actions/import-codesign-certs` + `codesign --options runtime` +
   `xcrun notarytool submit --wait` + `stapler`). One GPUIV-specific caveat:
   the `.node` is extracted to `/tmp` at runtime and is not covered by the
   bundle signature — accepted practice (Gatekeeper gates the first launch of
   the .app itself), documented here.
7. Windows signing in 2026: Azure Trusted Signing (~$10/mo, individual tier,
   US/CA residents, CI-friendly) or a reseller OV cert (~$200/yr). Unsigned
   distribution works but earns long-lived SmartScreen warnings. v1 ships a
   signing *hook*, not a requirement.

## Design

### 1. Product layout

**macOS** — classic single-executable bundle:

```
Chat.app/
  Contents/
    Info.plist                 ← generated from config (below)
    MacOS/Chat                 ← bun-compiled exe; CFBundleExecutable == exe name
    Resources/AppIcon.icns     ← optional; from config
```

The compiled binary is the *only* content. No `Frameworks/`, no loose files —
JS, assets and the `.node` all live inside the executable's embedded
filesystem. `CFBundleIdentifier`, display name, version, and
`LSMinimumSystemVersion` (default `13.0`, matching what GPUI actually needs)
come from the config. Reserve optional plist extras (`CFBundleURLTypes` for
deep links later) as a pass-through map.

**The menu-bar title follows the executable name** (AGENTS.md: AppKit takes it
from the executable). Naming the compiled binary `Chat` is what makes the app
menu say `Chat`, not `bun`. The packager enforces `productName == exe name ==
CFBundleExecutable`.

**Windows** — portable folder (P0), installer later:

```
Chat/
  Chat.exe                     ← GUI subsystem, icon + version metadata
  Chat.exe.authors.md / LICENSE (copied by extraResources, if configured)
```

Distributed as a zip. No registry writes, runs from anywhere. Installers are
P2 and must not change this layout.

### 2. Pinning the native binding (the load-bearing piece)

The generated napi loader tries `darwin-universal` first, then arch-specific
paths, then optional packages — all as try/catch `require`s. Bundled
unmodified this either embeds several `.node` copies or misses them all.

The packager stages a **one-line shim** and aliases the package to it for the
bundle:

```js
// .gpuiv-packaging/native-binding.<target>.js (generated)
const binding = require('./gpuiv-native.darwin-arm64.node')
module.exports = binding
for (const k of ['GpuixCanvas2DCore', 'GpuixRenderer', 'TestGpuixRenderer',
                 'hasTestGpuixRenderer']) module.exports[k] = binding[k]
```

- `Bun.build` pins the specifier through a **build plugin `onResolve`** for
  `/^@gpuiv\/native$/` (the `alias` option does not intercept it on bun
  1.3.14). See the implementation record for why the shim — rather than
  resolving to the `.node` directly — is load-bearing.
- The matching `.node` is copied next to the shim so the literal relative
  `require` resolves at build time and Bun embeds exactly one binding.
- Export list is read from `packages/native/index.js` tail at build time, not
  hardcoded — it already re-exports every napi class.
- `.node` resolution order for a target: local `packages/native/*.node` (repo
  dev) → installed optional package (`@gpuiv/native-darwin-arm64`, how
  end-user apps get foreign targets) → `--node-path` flag. Error names all
  three if missing.
- CI packaging jobs download the `bindings-<rust-target>` artifact from the
  existing build job instead of rebuilding Rust.

### 3. `@gpuiv/packager` (new workspace package)

A Bun-run TS CLI + programmatic API (`buildPackage(config)`) so apps can drive
it from their own scripts. Single config file at the app root,
`gpuiv.package.ts` (or `.json`):

```ts
export default {
  entry: './chat.tsx',
  productName: 'Chat',              // exe name, menu title, CFBundleExecutable
  bundleId: 'dev.gpuiv.chat',       // CFBundleIdentifier
  version: '0.1.0',
  publisher: 'GPUIV',               // Windows version-info only
  icon: {                           // .icns/.ico files as-is; no rasterizing
    darwin: './build/app.icns',
    win32: './build/app.ico',
  },
  minSystemVersion: '13.0',
  extraResources: ['./THIRD_PARTY.md'],   // → Contents/Resources / beside exe
  mac: { plist: { /* pass-through keys */ } },
  win:  { },                        // version/description metadata
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'],
}
```

Deliberate choice: the packager **places** icons, it does not **generate**
them. Icon generation (`rsvg-convert`/`magick`/`iconutil`) is a dev-machine
concern — keeping it out keeps the packager free of external tool
dependencies and CI free of apt/choco installs. `examples/compile-chat.ts`'s
`buildIcons()` moves to a separate `examples/icons.ts` script.

Pipeline per target (fail-fast, every step logs what it staged):

```
validate config → resolve .node → stage shim + copy binding
  → Bun.build({ compile, target, minify, bytecode, sourcemap: 'linked',
                alias: {'@gpuiv/native': shim}, define: {PROD} })
  → macOS: emit Info.plist, wrap .app (+icns, extraResources), ad-hoc codesign
    Windows: only on a Windows host, windows: { icon, hideConsole: true, … }
  → smoke test (below)
  → out/Chat-<os>-<arch>[-unsigned].{app|zip}
```

- `--target` uses the Bun spellings (`darwin-arm64`, `win32-x64`, …); the
  packager owns the mapping to napi target triples and `.node` filenames.
- Cross-compile is allowed **except** Windows targets: the CLI refuses
  `win32-*` unless `process.platform === 'win32'` (metadata + icon can't be
  written cross-host) and points at CI.
- macOS smoke output is zipped (not dmg) in P0 — zip is what notarytool
  accepts; a pretty dmg is P1.
- Every produced artifact carries the config hash in its build log line so a
  bug report can name exactly what produced it.

### 4. Smoke test: the packaged binary must prove it renders

The automation protocol already exists; use it instead of eyeballing. The
packager (and CI) launches the artifact with `GPUIX_BACKGROUND=1` and drives
it through `launch()` from `@gpuiv/vue/automation`:

```ts
const app = await launch({
  command: packagedExePath,
  cwd: appDir,
  env: { GPUIX_BACKGROUND: '1' },
})
await app.getByTestId('app-root').waitFor({ timeoutMs: 30_000 })
await app.screenshot({ path: `out/smoke-${target}.png` })
await app.close()
```

Requirements on apps: an entry file that honors `GPUIX_BACKGROUND` (examples
already do) and a stable `testId` on the root (packager config names it,
default `'app-root'`). This validates the whole chain in one step — binding
pinned correctly, `.node` extraction works, window opens without stealing
focus, first frame paints. One risk to watch: `hideConsole` GUI-subsystem
exes keep working over stdio pipes when spawned programmatically; if that
breaks, the Windows smoke test is where it shows up first, and the fallback is
a console build for debug targets.

### 5. Runtime support in `@gpuiv/vue` (small, additive)

- `isPackaged()` — `Bun.isStandaloneExecutable` (display name only; behavior
  should not branch on it beyond telemetry/update checks).
- `resourcesPath()` — resolves `extraResources` on both platforms:
  macOS `<exe>/../../Resources`, Windows `resources/` beside the binary
  (portable folders have no `Resources` dir). Documented as read-only shipped
  data; user state goes to `~`-based dirs the app already owns.
- Nothing else. Embedded assets need no API (`with { type: 'file' }` imports
  already work, `/$bunfs` is readable by `node:fs`).

### 6. CI: a `package` stage on the existing workflow

Add to `.github/workflows/ci.yml` (reusing `build`'s artifacts), or a sibling
workflow triggered by `workflow_dispatch` + `app-v*` tags:

- **`package-macos`** (runs-on macos-latest): downloads both darwin bindings,
  builds `.app` per arch (arm64, x64), zip + ad-hoc codesign; if
  `MACOS_CERT_P12` secret exists → Developer ID sign + notarytool + stapler,
  mirroring the fork-tolerance pattern of the `publish` job (`if:
  github.repository == …` or secret presence, so forks stay green).
- **`package-windows`** (runs-on windows-latest): native build on-host
  (mandatory for icon/metadata), x64 first, arm64 same job, zip artifacts.
- Each job runs the §4 smoke test against its own artifacts before upload.
- Release flow (P1): tag `app-v*` → artifacts attach to a GitHub Release via
  `softprops/action-gh-release`; notarized macOS zip + Windows zips + a
  `latest.json` (version + per-platform URLs) whose *shape* is the auto-update
  contract later, even though v1 nothing consumes it.

### 7. Signing policy

| | Dev (`bunx @gpuiv/packager build`) | CI release |
|---|---|---|
| macOS | ad-hoc `codesign -` (runs locally, no account) | Developer ID + notarization + staple, skipped cleanly when secrets absent |
| Windows | unsigned | optional `signtool` hook (`--sign` flag runs a configured command against the exe); Azure Trusted Signing or OV cert is the app owner's choice |

Windows GUI apps without a console log anywhere by default — the smoke test
in CI is the only automated verification a packaged Windows build gets, which
is why §4 is non-optional.

## Phasing

**P0 — usable products (this design's first PR series)**
1. `packages/packager` with the config schema, shim staging, macOS wrap +
   ad-hoc sign, Windows on-host build, zip outputs.
2. `resourcesPath()` / `isPackaged()` in `@gpuiv/vue`.
3. CI `package-macos` / `package-windows` jobs + automation smoke test.
4. Migrate `chat.tsx` off `compile-chat.ts` (kept for icon generation only),
   ship `Chat.app` + `Chat-win32-x64.zip` as CI artifacts.

**P1 — distributable with confidence**
Developer ID signing + notarization in CI, GitHub Release attach +
`latest.json`, dmg, Windows signing hook, universal-macOS `lipo` spike
(accept-or-reject).

**P2 — the rest of the desktop story**
Linux AppImage (native build already exists sans test-support), NSIS/MSIX
installer, deep-link registration (plist `CFBundleURLTypes` + installer
registry writes), Sparkle-style update client consuming `latest.json`.

## Risks & open questions

- ~~**`alias` over a workspace symlink**~~ — resolved during implementation:
  `Bun.build({ alias })` does not intercept the specifier on bun 1.3.14.
  The pin uses a **build plugin `onResolve`** for `/^@gpuiv\/native$/`, and
  resolving the specifier directly to the `.node` file fails differently
  ("No matching export … for import" — the bundler cannot see named exports
  inside a binary module), so the **shim with explicit named re-exports** is
  load-bearing, not an implementation detail.
- **Universal macOS via `lipo`**: depends on Bun's embedded filesystem living
  inside per-slice Mach-O sections rather than a file appendix. If the spike
  fails, per-arch distribution is the permanent answer (it's also what Zed
  ships today).
- **GUI-subsystem stdio on Windows**: `hideConsole` + piped stdio for the
  automation smoke test is expected to work (pipes are independent of the
  console subsystem) but is verified, not assumed, in P0 — the
  `package-windows` CI job runs the smoke test on a real Windows host.
- **Binary size**: a compiled exe carries the whole Bun runtime (tens of MB)
  plus the GPUI `.node` (chat: 81 MB uncompressed, 32 MB zipped). Not a
  blocker. The alternative — embedding the JS into the Rust binary and
  dropping Bun — loses `Bun.file`/native fetch/sockets the chat app already
  uses and buys maybe half the size back. Revisit only if size becomes a
  complaint.
- **Source visibility**: bytecode is a startup optimization, not obfuscation;
  the docs must not imply otherwise. Nothing in GPUIV needs secret JS.
- **`.node` in `/tmp` is unsigned post-extraction**: Gatekeeper passes the
  .app at first launch; the extracted binding is out of its scope. Standard
  for embedded-addon runtimes; recorded here so it isn't rediscovered.

## Implementation record (P0)

What the actual build (bun 1.3.14, macOS arm64 host) surfaced beyond the
design above:

- **`.node` resolution walks up from the app, not from the packager.** Bun's
  workspace installs are isolated: `packages/packager/node_modules` carries
  only its declared deps, so `require.resolve` inside the packager never
  sees the app's `@gpuiv/native`. `resolveFromApp` walks
  `<dir>/node_modules/<pkg>/<file>` from the config directory upward —
  which is also the correct answer for end-user apps in monorepos.
- **`bytecode: true` is off, deliberately.** On bun ≤1.3.14 bytecode bundles
  are parsed as CJS; any app with top-level await fails with `"await" can
  only be used inside an "async" function`. (It also combined with
  sourcemaps into a ~15-minute silent hang on the first chat build.) Revisit
  on bun ≥1.4.
- **`sourcemap: "linked"` writes an external `.map` next to the executable**
  on bun ≤1.3.14 (embedding lands in 1.4). The packager relocates it out of
  the product (`<outDir>/<target>-chat.js.map`) so debug data never ships
  inside the `.app` or the portable folder, but stays available for bug
  reports.
- **`Bun.isStandaloneExecutable` is `undefined` on bun 1.3.14** compiled
  binaries — `Bun.main === import.meta.path` still holds inside them, and
  both are `$bunfs` virtual paths. `isPackaged()` uses the flag but chat's
  entry check ORs it with the path equality so it works on both bun
  generations.
- **Windows extraResources land in `resources/` beside the exe** (the design
  sketch said `<exe>.resources/`); `resourcesPath()` resolves both layouts'
  contract (`Contents/Resources` on macOS, `resources/` on Windows/Linux)
  with platform-matched path semantics (`path.win32` for win32 inputs — a
  POSIX `dirname` collapses `C:\…` to `.`).
- **No ImageMagick anywhere.** The `.ico` is written by a pure-TS PNG-in-ICO
  packer (`src/icons.ts`); icon generation needs only `rsvg-convert`
  (librsvg) + `sips` + `iconutil`, all macOS-default except librsvg.
- **Per-platform optional packages are not published yet** — the
  `@gpuiv/native-darwin-x64`-style fallback path exists in the resolver and
  is covered by the error message, but today foreign targets need either a
  local cross build (`cargo build --target x86_64-apple-darwin` — verified)
  or the CI bindings artifact. Publishing them (napi pre-publish already
  emits them) unlocks `bunx`-driven packaging for external apps.
- **`darwin-x64` cross-compiles and smoke-tests from an arm64 host** —
  verified green in CI (`package-macos`), including the Rosetta smoke run.
  The target-runtime download is the fragile part (a stalled download held
  one CI attempt for 20+ minutes before timeouts were added); every packager
  subprocess now carries a 2-minute `spawnSync` timeout, the build itself a
  10-minute race, and the CI steps `timeout-minutes: 25`.
- **Live-window screenshots are macOS-only in this fork**
  (`render_to_image` gates on `target_os = "macos"` + test-support), so the
  Windows smoke test asserts the load-bearing part — launch, binding load,
  window open, root `testId` painted — and skips the screenshot with a log
  line. The CI `package-windows` job proved the packaged GUI exe serves
  automation over stdio pipes exactly as designed.
- **chat's debug HUD hides itself in packaged products**
  (`debugFrameOverlay: isPackaged() ? undefined : 'full'`) — a development
  aid should not ship on the user's screen.
