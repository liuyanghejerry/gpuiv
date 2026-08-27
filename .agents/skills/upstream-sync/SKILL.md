---
name: upstream-sync
description: Track and port changes from upstream remorses/gpuix (React binding) into this Vue 3 fork (liuyanghejerry/gpuiv). Use when the user asks to 检查/同步/跟进上游变更, inventory new upstream commits, port, decline, or record an upstream topic, or update the docs/upstream/ tracking ledger. Covers the inventory → decide → port → record loop, per-file porting (never git merge), and this machine's build/test quirks.
---

# Upstream sync

This fork (`liuyanghejerry/gpuiv`, Vue 3) tracks upstream
[`remorses/gpuix`](https://github.com/remorses/gpuix) (React). The ledger at
[`docs/upstream/README.md`](../../docs/upstream/README.md) is the **source of
truth** for what is synced / pending / declined / diverged. Read it before
doing anything, and update it as part of every change (see
[Record](#4-record)).

The `upstream` remote is already configured. Build/test/PR conventions live in
the root [`AGENTS.md`](../../AGENTS.md); this skill adds the sync-specific
procedure and this machine's quirks.

## Hard rules

1. **Never `git merge upstream/main`.** Upstream shares no git history with us
   (squash-rewritten). Port per-file (`git checkout upstream/main -- <path>`
   then adapt) or per-diff. Never rebase our history onto upstream.
2. **One topic per PR, never stacked.** Merge is squash + `--delete-branch`;
   a stacked PR is auto-closed when its base branch disappears (PR #5 died
   this way). Always branch from a fresh `main`.
3. **PR body** must carry `Harness / Agent / Model` plus every user prompt of
   the session verbatim in a `<details>` block (see root AGENTS.md). PRs go to
   `liuyanghejerry/gpuiv`, not `remorses`.
4. **`zed/` submodule** tracks `remorses/zed` branch `gpuix`; this account
   cannot push there. A bump is a fast-forward to a commit that already exists
   upstream. Never commit inside `zed/` in this checkout. If a topic needs a
   newer submodule, the bump lands before/with the code that depends on it.
5. **React → Vue is a port, not a copy.** Upstream prop/event/composite
   shapes become Vue props, emits, composables, or wrapper components.
   Examples and `bun --hot` load `packages/vue/dist`, so **rebuild
   `packages/vue` after renderer changes** — vitest uses `src` and will lie to
   you. Add a changeset for user-facing package changes; docs-only PRs skip
   it.
6. **Standing divergences — do not reopen without the user asking:**
   - occlude semantics (we keep absolute/fixed occluding; upstream relaxed it)
   - the Vue `VirtualList` wrapper stays (upstream deleted theirs; our
     `chat.tsx` depends on it)

## The loop

### 1. Inventory

```bash
git fetch upstream
git log --oneline <last-inventoried>..upstream/main   # SHA from the ledger
git diff <last-inventoried>..upstream/main -- zed      # submodule movement?
```

Group commits by topic (a topic = what would be ported or refused as one
unit). Compare against the ledger: some commits extend an existing `pending`
topic, some open new ones. Note any commits already accounted for.

### 2. Decide

Present the topics to the user with a proposed status each:
`sync now` / `pending` / `declined` / `diverged`. Flag anything that needs a
Vue-side API design decision (new props/emits) — those are not mechanical
ports. Only the user decides; record whatever they choose.

### 3. Port

```bash
git checkout main && git pull --ff-only
git checkout -b <kind>/<topic>       # e.g. feat/on-aux-click
# port files, adapt React→Vue, add/adjust tests
```

Then verify on this machine:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd packages/native && CARGO_NET_OFFLINE=true bun run build   # release only
cd ../vue && bun run build && bun run test                    # vitest!
cd ../../examples && bun run test
cd ../packages/native && CARGO_NET_OFFLINE=true cargo test --lib
```

PR → watch CI (`gh pr checks <n> --watch`) → squash-merge `--delete-branch`
when green → `git checkout main && git pull --ff-only`.

### 4. Record

In the same PR: update the ledger rows (move commits to `synced` with the PR
number, or mark declined/diverged with reasons), add
`docs/upstream/<topic>.md` for anything `declined` (reason + revisit
triggers), update the *Last inventoried* line, and touch root `AGENTS.md`
only if behavior or conventions changed. Sync log gains one row per merged
PR.

## This machine's quirks

Not in AGENTS.md — these are local-environment facts:

- `bun` is not on the default PATH: prefix every shell with
  `export PATH="$HOME/.bun/bin:$PATH"`.
- **`CARGO_NET_OFFLINE=true` on every cargo invokation.** Direct downloads
  from static.crates.io time out (~30s low-speed). Dependencies are pre-seeded
  in `~/.cargo/registry/cache/index.crates.io-…/`. If a genuinely new crate is
  required, fetch the `.crate` file by hand (`curl`) into that cache dir.
- macOS has no `timeout` command.
- Test runner is vitest — `bun run test`, never `bun test`.
- `examples/chat.perf.test.tsx` mount budget is tight on CI's M1 runner; a
  flaky red usually clears on one rerun. Local **first** mount (~420ms) has no
  diagnostic value — compare **warm** mounts only (~44–99ms for 1000 turns).
- Known fork bug (unfixed): a function child (`() => h("text", …)`) produces
  no text node — JSX and string children are fine. Write tests with string
  children.

## Decision checklist for a topic

- Touches files we already diverged on (`retained_tree.rs`, virtual-list,
  occlude/hitbox)? Expect hand-porting, not checkout.
- Needs new Vue-facing API? Design it first; don't inherit React prop shapes
  blindly (e.g. upstream's `renderItem` vs our `VirtualList` slots/props).
- Test-support only? Port both the native `test-support` surface and the
  `packages/vue` testing/automation surface.
- Submodule moved in the range? Bump first, rebuild native, then port.
- Perf topic? Measure before and after on warm mounts / `profile-chat-scroll`,
  not on first mount.
