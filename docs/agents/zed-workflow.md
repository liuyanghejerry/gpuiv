# Working with the Zed fork

GPUIV sits at the end of a fork chain:

```
zed-industries/zed (main)  →  remorses/zed (gpuix)  →  this repo's zed/ submodule
```

The `zed/` submodule tracks the `gpuix` branch of `remorses/zed` (until a
recorded divergence repoints it at our own fork — see below). This file covers
searching upstream before writing code, fixing GPUI, bumping the submodule, and
opening PRs to Zed.

## Search Zed before you touch GPUI

Before you debug a GPUI behaviour, add a GPUIV feature that needs a new GPUI
API, or patch the fork, **search `zed-industries/zed` first**. Zed is a large
project with an active roadmap. The answer is often one of:

- someone already reported the same bug
- an open PR already implements the API, so **wait and bump the submodule**
- a merged PR already added it, so **bump the submodule** instead of writing code
- a closed issue says the Zed team declined it, so plan a fork-only fix

Search issues and PRs together, then search code:

```bash
# issues + PRs, full text
gh search issues --repo zed-industries/zed --include-prs --limit 30 'TransformationMatrix' \
  --json number,title,url,state,isPullRequest \
  --jq '.[] | [.number, .isPullRequest, .state, .title, .url] | @tsv'

# title only, to find the feature rather than every mention
gh search issues --repo zed-industries/zed --include-prs --match title --limit 30 'transform'

# where the API already exists in the tree
gh search code --repo zed-industries/zed --language Rust --limit 30 'TransformationMatrix'
```

Then read the promising ones in full. A closed issue is the important signal, and
its `stateReason` and comments explain whether the idea was rejected or shipped:

```bash
gh issue view 53303 -R zed-industries/zed --json number,title,state,stateReason,body,comments
gh pr view 59413 -R zed-industries/zed --json title,state,body,files,comments,reviews
```

**Use the `--repo` and `--match` flags. Do not put `repo:` or `in:title` inside the
query string.** `gh search` mangles the inline form: `repo:` first fails with
`Invalid search query`, and `in:title ... repo:owner/name` silently drops the repo
filter and returns results from unrelated repositories.

Search the real symbol names, not concepts. `TransformationMatrix`,
`with_element_offset`, and `request_animation_frame` find the discussion.
"animation is slow" does not.

Record the outcome in the changeset or PR body, with issue and PR URLs, so the
next session does not repeat the search.

## Fixing GPUI for GPUIV

The `remorses/zed` fork is part of GPUIV's implementation boundary — but we are
a **fork of GPUIX**, without write access to `remorses/zed`, and every commit we
carry on our own zed fork is one more thing to rebase at every upstream sync.
So the order for a GPUI fix is:

1. **PR to `zed-industries/zed` main** when it is a general GPUI improvement or
   platform correction (see "PRs to Zed" below). It flows into `remorses/zed`'s
   `gpuix` branch on the next upstream merge, and into GPUIV with a submodule
   bump.
2. **PR to `remorses/zed` `gpuix`** (from a branch on our own fork of
   `remorses/zed`) when the fix serves the embedded/binding use case — the same
   things upstream GPUIX needs. Once merged, upstream GPUIX bumps its zed
   pointer and our next sync brings the fix in with **zero divergence**.
3. **Carry it in our own zed fork** only when neither upstream will take it, the
   fix is genuinely GPUIV-specific, or we cannot wait. Fork `remorses/zed` under
   our account, keep one branch based on `gpuix` (e.g. `gpuix-gpuiv`), repoint
   `.gitmodules` at the fork, and **record the patch stack in `docs/upstream/`**
   as a diverged topic with revisit triggers. Keep that stack tiny: each
   upstream sync that moves the `gpuix` pointer means rebasing it.

Whichever tier lands the fix, the rules are the same. Normal commits on a
`gpuix`-based branch, pushed to a **reachable remote branch** before this
submodule points at them — never pin GPUIV to a detached commit. Do the work in
a separate Zed worktree; do not develop or commit inside the `zed/` build
checkout.

```bash
# from a local clone of our zed fork (or a fresh fork of remorses/zed)
git fetch origin gpuix
git worktree add ../zed-gpuix-<change> -b gpuix-<change> origin/gpuix

# after review: open the PR against remorses/zed gpuix, or push to our own fork
git push origin HEAD:gpuix-<change>

# once the commit is reachable on the remote this submodule tracks
git -C zed fetch origin gpuix && git -C zed switch gpuix
git -C zed merge --ff-only origin/gpuix   # or origin/gpuix-gpuiv while diverged
```

Commit the resulting `zed` submodule pointer in GPUIV with the code that uses
the new API. While diverged, `.gitmodules` points at our fork; otherwise it
stays on `remorses/zed`, branch `gpuix`.

## Bumping the gpui revision

Steps 1–2 happen upstream in `remorses/zed`; if we need them done, that is a PR
there, not a local operation:

1. Merge upstream Zed into the `gpuix` branch in `remorses/zed`.
2. Resolve any embedded `gpui_macos` conflicts in a new commit; do not rewrite history.

Then in this repository:

3. Fast-forward the `zed/` submodule to the updated `gpuix` branch — or, while
   diverged, rebase our `gpuix-gpuiv` patch stack onto it.
4. Match `rust-toolchain.toml` to `zed/rust-toolchain.toml`.
5. Run `cargo check --all-targets`, `bun run build`, and the test suites.

## PRs to Zed

A "PR to Zed" means **upstream** [`zed-industries/zed`](https://github.com/zed-industries/zed)
`main`. Never open that PR from this checkout. Never point it at `remorses/zed`.

Do **not** branch, commit review markers, or reset `zed/` inside this checkout.
That submodule is what GPUIV builds against. A dirty or switched `zed/` breaks
the native addon and the test renderer.

```bash
# from a separate local clone of zed, never this repo's zed/ build checkout
git remote add upstream https://github.com/zed-industries/zed.git  # once
git fetch upstream
git worktree add ../zed-<branch-name> -b <branch-name> upstream/main
```

Commit only in that worktree. Do not add comments to Zed source. Push the branch
to `remorses/zed`, then open the PR with `--repo zed-industries/zed --base main`.
After merge, cherry-pick onto `gpuix` and fast-forward the submodule
here. Never run `git reset` in `zed/` to "undo" PR work.
