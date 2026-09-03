# Third-party notices

## Ported source

GPUIX's text selection, syntax highlighting, markdown renderer and diff viewer
are ported from **[Comet](https://github.com/zeronsh/comet)** (MIT, Copyright (c)
2026 Wing). The ported files carry a header naming their original.

The selection port includes Comet's
[`f6911c3`](https://github.com/zeronsh/comet/commit/f6911c311dc654734d31bc3097a84fb73659939f)
soft-wrap geometry fix and
[`3536a37`](https://github.com/zeronsh/comet/commit/3536a3702ca405fec1321e95f54e280240c5d38f)
virtualized drag fix. Input is not a wholesale Comet port. Its caret blink,
double-click, drag autoscroll, and bounded undo follow generic composer
behavior reviewed at
[`b3fa518`](https://github.com/zeronsh/comet/commit/b3fa51872f70c8f973c241b659cf0c166766f4f5).

| GPUIX file | Comet original |
| --- | --- |
| `packages/native/src/text/selection.rs` | [`crates/ui/src/markdown/selection.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/markdown/selection.rs) |
| `packages/native/src/text/paint.rs` | [selection sections of `crates/ui/src/markdown/render.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/markdown/render.rs) |
| `packages/native/src/text/runs.rs` | `runs_for_syntax_line_with_plain` in `crates/ui/src/markdown/render.rs` |
| `packages/native/src/syntax/mod.rs` | `crates/syntax/src/lib.rs` |
| `packages/native/src/syntax/cache.rs` | `crates/ui/src/syntax_cache.rs` |
| `packages/native/src/markdown/parser.rs` | `crates/ui/src/markdown/parser.rs` |
| `packages/native/src/markdown/render.rs` | `crates/ui/src/markdown/render.rs` |
| `packages/native/src/diff/mod.rs` | pure sections of `crates/ui/src/changes.rs` |
| `packages/native/src/custom_elements/diff.rs` | rendering sections of `crates/ui/src/changes.rs` |
| `packages/native/src/custom_elements/code.rs` | `render_code_block` in `crates/ui/src/markdown/render.rs` |
| `packages/native/src/custom_elements/input.rs` | [caret blink sections of `crates/ui/src/composer.rs`](https://github.com/zeronsh/comet/blob/main/crates/ui/src/composer.rs) |
| `packages/native/src/theme.rs` | `crates/ui/src/theme.rs` |

## Example icons

The chat example uses **[Lucide](https://github.com/lucide-icons/lucide)** SVG
icons (ISC, Copyright (c) 2026 Lucide Icons and Contributors). The OpenAI mark
is ported from **[Comet](https://github.com/zeronsh/comet)** (MIT, Copyright (c)
2026 Wing).

## Canvas conformance tests

`packages/vue/wpt/yaml/` vendors canvas test cases from the **W3C
web-platform-tests** project (3-Clause BSD, Copyright © web-platform-tests
contributors), taken from
[`html/canvas/tools/yaml/`](https://github.com/web-platform-tests/wpt/tree/master/html/canvas/tools/yaml).
The assertion-comment rewrite in `scripts/convert-canvas-wpt.ts` follows the
same rule set as WPT's gentest and Automattic/node-canvas's
[`test/wpt/generate.js`](https://github.com/Automattic/node-canvas/blob/master/test/wpt/generate.js)
(MIT) port of it.

## Bundled grammars

Syntax highlighting bundles the following Tree-sitter components. Versions are
pinned in `packages/native/Cargo.lock`.

| Component | License | Source |
| --- | --- | --- |
| Tree-sitter | MIT | https://github.com/tree-sitter/tree-sitter |
| Tree-sitter highlight | MIT | https://github.com/tree-sitter/tree-sitter |
| Rust grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-rust |
| JavaScript grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-javascript |
| TypeScript grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-typescript |
| Python grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-python |
| Go grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-go |
| JSON grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-json |
| Bash grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-bash |
| HTML grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-html |
| CSS grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-css |
| C grammar and queries | MIT | https://github.com/tree-sitter/tree-sitter-c |
| TOML grammar and queries | MIT | https://github.com/tree-sitter-grammars/tree-sitter-toml |
| Markdown grammar and queries | MIT | https://github.com/tree-sitter-grammars/tree-sitter-markdown |
| YAML grammar and queries | MIT | https://github.com/tree-sitter-grammars/tree-sitter-yaml |

## Other dependencies

| Component | License | Source |
| --- | --- | --- |
| pulldown-cmark | MIT | https://github.com/pulldown-cmark/pulldown-cmark |
| arboard | MIT / Apache-2.0 | https://github.com/1Password/arboard |
| GPUI | Apache-2.0 | https://github.com/zed-industries/zed |

GPUIX itself is licensed under the terms in `LICENSE`.
