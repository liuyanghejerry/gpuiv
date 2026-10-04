# Measured-layout context release

The memory gate finds `TextEditorState` entity handles surviving subtree
removal even when all GPUIV ownership maps are empty. Taffy 0.13.0's
`TaffyTree::clear()` clears nodes/parents/children but strands `node_context_data`.
GPUI's measurement closures capture entities, so shrinking a frame leaves
captured views alive until the corresponding slot is reused by another context.

[Taffy PR #1181](https://github.com/DioxusLabs/taffy/pull/1181) already fixes
`clear()` and `remove()`, but is part of 0.14. Current GPUI and upstream Zed
still pin exactly 0.13.0. Searches for `taffy clear memory` and
`node_context_data` found no matching Zed issue/PR on 2026-10-04.

The fix belongs in GPUI, so [remorses/zed PR #9](https://github.com/remorses/zed/pull/9)
tracks measured node IDs and calls Taffy's `set_node_context(id, None)` while
those IDs are still live, before `clear()`. A shrinking-frame regression test
checks every captured value is dropped. GPUIV does not change input state or
reach around GPUI's invariants in its native translation.

To run a strict gate now, `.gitmodules` temporarily tracks
`liuyanghejerry/zed:gpuix-gpuiv`, containing this patch atop `ea042f2`.
The build checkout still uses its local `gpuix` branch. The patch is committed
and reachable on the remote; development takes place in a separate worktree.

Revisit when remorses/zed merges PR #9, or GPUI upgrades Taffy to a revision
containing #1181. Return `.gitmodules` to `remorses/zed:gpuix` as soon as the
equivalent fix is upstream. If upgrading to fixed Taffy, remove the GPUI
measurement-ID tracking as well. Until then, rebase this small patch onto
future upstream pins and retain the same-window entity regression.
