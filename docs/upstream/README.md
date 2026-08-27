# Upstream tracking

This fork (`liuyanghejerry/gpuiv`, Vue 3 binding) tracks upstream
[`remorses/gpuix`](https://github.com/remorses/gpuix) (React binding). This
directory is the ledger of that relationship: what we have synced, what we have
refused and why, and what is still open.

**Hard constraint:** upstream has no shared git history with us (its history
was squash-rewritten). Never `git merge upstream/main` — port per-file or
per-diff. The zed submodule protocol is in the root
[`AGENTS.md`](../../AGENTS.md#building).

## The process

An agent skill wrapping this loop (including this machine's build quirks)
lives at `.agents/skills/upstream-sync/SKILL.md`.

1. **Inventory** — `git fetch upstream`, then
   `git log --oneline <last-inventoried>..upstream/main`. Group commits by
   topic (a topic is anything that would be ported or refused as a unit).
   Update the *Last inventoried* line in the ledger.
2. **Decide** — take the grouped topics to the maintainer. Every topic gets
   exactly one status:
   - `synced` — ported here; record the PR number
   - `pending` — not synced yet; a candidate for a future round
   - `declined` — we will not port it unless a revisit trigger fires;
     **requires a topic file** in this directory with the reason and triggers
   - `diverged` — upstream moved in a direction we deliberately reject; a
     row-level reason is enough until the reasoning outgrows the row, then
     promote it to a topic file
3. **Port** — one topic per PR, never stacked on an unmerged branch (a stacked
   PR is auto-closed when its base is squash-merged and deleted — PR #5 died
   that way). React→Vue differences in the binding layer are a port, not a
   copy. Follow the PR body rules in the root `AGENTS.md`.
4. **Record** — the same PR that ports, declines, or diverges a topic updates
   the ledger below. No sync work is done until the ledger says so.

## Ledger

Inventoried range: `367ef48..64241ce` (2026-08-27). Earlier history is in
[Sync log](#sync-log) below.

| Topic | Upstream commits | Status | Notes |
|---|---|---|---|
| Wasm / browser rendering, website | `75a1fe6` `92082a3` `7d6e1f9` `711945f` `7f6732a` `7a3e356` `bbcea1f` `291b92d` `a906cf9` `f52fa54` | declined | [wasm-web-rendering.md](./wasm-web-rendering.md) |
| CI / release plumbing | `0b257d0` `301b834` `ac0426c` | declined | one-target-per-OS matrix and archive shipping serve their matrix, not ours; our CI publishes both packages |
| Example app / starter / timeline | `7d45d36` `691ca1f` `9472574` `6c5b0b5` `3d759b2` `813ece4` `555fa30` `8210a38` | declined | upstream-only surfaces (`example-app/` starter, timeline demo); revisit if we ship a starter |
| Occlude semantics relaxation | `d96413d` | diverged | upstream lets the wheel pass under absolutely positioned items; we keep absolute/fixed occluding (documented in root AGENTS.md). Revisit if it causes real scroll bugs |
| VirtualList wrapper removal | `3d759b2` | diverged | upstream deleted the React wrapper ("there must not be one"); we keep the Vue wrapper — `chat.tsx` depends on it. Revisit if windowed mounting moves fully native |
| macOS application menu bar | `7baa36f` `d804d93` | pending | native `app_menu` install; needs a Vue-side API decision (`appName`?) |
| Text-search highlight | `bb138ba` `9a18172` `c444c28` `8aef438` `12fb344` `848c617` | pending | `<text>`/`<code>` highlight prop + paint-order match numbering; React prop API must be redesigned for Vue |
| Virtual-list pinning / anchoring | `01f5788` `ae4766f` `a8f302a` `c8a96b8` | pending | top pin on prepend, followTail hole, anchoring-by-index docs; touches the same native list code we synced in PR #6 |
| Mutation wire format / retained-tree perf | `230400e` `2daf988` `fd06111` `f948f50` | pending | typed batch ops, styles shared by content, style-table reclaim; core `retained_tree.rs` we have modified — port carefully |
| Automation API expansion | `c2b60e8` `ff6daf5` `5805701` `64241ce` | pending | drag/wheel/hover/modifiers, `<input>`/`<textarea>` reachability, live keyboard; large and useful for our tests |
| Test renderer hardening | `3505f68` `20483dd` `5719d7f` `3cb50c2` `6ad8f83` `bde0ca7` `f93e891` `d1d58e0` `e4fb1c3` | synced | PR #15 — Windows DirectX suite in CI, constructor window sizing, real `getWindowSize`, teardown Drop; test-file-only parts (screenshots-in-repo, wrap literals, word chord) moot for our corpus |
| `onAuxClick` + click button | `280d6ec` | synced | PR #11 |
| Window size polling | `f587575` | synced | PR #12 |
| `<code>` as bare surface | `5033808` `f81e087` | synced | PR #14 — breaking: `showHeader` gone, `codePaddingX`→`mdCodePaddingX` etc.; card moved into app code (chat `CodeBlock`) |
| Hygiene | `f921bec` `d1e4c98` `a9cda59` | synced | PR #13 |

Already accounted for: `4006d99` (thin-layer-first docs) was ported with the
AGENTS.md batch in PR #8.

**Last inventoried upstream head:** `64241ce` (2026-08-27)

## Sync log

Fork point: `9f0fb6d` (upstream PR #17 merge). Content selectively ported
from upstream through `367ef48`:

| PR | What came over |
|---|---|
| #3 | Apache-2.0 LICENSE (root + native package) |
| #4 | Syntect replaces Tree-sitter (`syntax/` rewrite, Cargo deps) |
| #6 | zed submodule `4d80927` → `773208d` (`gpuix` branch), pointer capture, virtual-list `estimatedItemHeight`, `getWindowInsets()`, markdown wrap/bounds, Vue-side ports + tests |
| #7 | Syntect warmup at renderer construction (fixes first-mount latency; our own fix, not upstream's) |
| #8 | AGENTS.md guidance port for synced code + framework-agnostic workflow |
| #11 | `onAuxClick` (gpui `on_aux_click`), `simulateClick` button param, automation `click({ button })` — upstream `280d6ec` |
| #12 | `useWindowSize` polls with `intervalMs` instead of reading once — upstream `f587575` |
| #13 | `<code>` CRLF normalize + regression test, `*.tsbuildinfo` ignored, vue `build`/`clean` split — upstream `f921bec` `d1e4c98` `a9cda59` |
| #14 | `<code>` bare surface: glyphs only, `style` is the surface, `showHeader` removed, `code*` card metrics → `mdCode*`; card moved into app code — upstream `5033808` `f81e087` |
| #15 | Test renderer hardening: Windows DirectX + full CI suite, `new TestGpuixRenderer(w, h)` / `createTestApp` sizing, real `getWindowSize`, Drop teardown, `build:release --no-default-features` for Linux — upstream `3505f68`…`e4fb1c3` (9 commits) |

(#5 was auto-closed by branch deletion after its base was squash-merged; its
content re-landed as #6.)
