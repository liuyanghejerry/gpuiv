# Diff scrolling work

Fork-local performance change after a PR workbench scrolling report. GPUI still
owns scrolling and virtualization. `DiffElement` now invalidates parsed data
when a data prop changes, instead of hashing the patch on every frame. Theme
updates remain paint-only. Overdraw uses four code rows from the current theme
instead of a fixed 1024 px; GPUI measures newly encountered offscreen rows.

`examples/diff.perf.test.tsx` exercises scrolling and selection with 300 and
8000 changed Objective-C lines, and checks that scrolling actually changes the
painted content. `DIFF_PERF_PATCH=/absolute/path/to/local.patch` can reproduce
a private patch without checking it into the repository. Draw/dispatch timing
is distinct from live automation RPC latency and display refresh cadence;
these tests do not claim to measure either of the latter.

Revisit when upstream changes its diff adapter or GPUI list measurement model.
