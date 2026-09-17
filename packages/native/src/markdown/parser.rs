//! Block-level markdown parsing over pulldown-cmark.
//!
//! Ported from Comet (https://github.com/zeronsh/comet), MIT.
//! Original: `crates/ui/src/markdown/parser.rs`.
//!
//! pulldown-cmark emits a flat event stream. This turns it into a block tree
//! with pre-flattened inline runs, because the renderer needs one string plus a
//! run list per paragraph to hand to `gpui::StyledText`, not a nested AST.
//!
//! The streaming path ([`IncrementalParser`]) reparses only from the last
//! stable top-level block boundary: text before the start of the last top-level
//! block cannot be affected by an append, so each streamed delta costs roughly
//! O(delta + last block) instead of O(document).
//!
//! Soundness guard: link-reference definitions (`[label]: url`) have non-local
//! effects (a definition anywhere resolves references anywhere), so a source
//! containing one drops to full reparses. The parity unit tests stream corpora
//! through both paths and assert equality.
//!
//! Comet also mends hanging inline markers for its display tree
//! (`super::mend`); GPUIV renders the canonical tree as-is, so that half is
//! not ported.

use std::ops::Range;
use std::sync::Arc;

use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

/// Inline styling flags, threaded through nested emphasis and links.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InlineStyle {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub strikethrough: bool,
    /// Destination URL when inside a link.
    pub link: Option<String>,
}

/// One run of identically-styled inline text.
#[derive(Debug, Clone, PartialEq)]
pub struct InlineRun {
    pub text: String,
    pub style: InlineStyle,
}

/// A markdown block. Containers nest.
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Paragraph {
        runs: Vec<InlineRun>,
    },
    Heading {
        level: u8,
        runs: Vec<InlineRun>,
    },
    /// A paragraph holding nothing but `![alt](url)` images. Images that sit
    /// among other inline content are not blocks — they degrade to link-styled
    /// runs, because `InlineRun` is text-only.
    Image {
        url: String,
        alt: String,
    },
    CodeBlock {
        language: Option<String>,
        code: String,
    },
    BlockQuote {
        children: Vec<Block>,
    },
    List {
        ordered_start: Option<u64>,
        items: Vec<Vec<Block>>,
    },
    Table {
        header: Vec<Vec<InlineRun>>,
        rows: Vec<Vec<Vec<InlineRun>>>,
        /// Per-column GFM alignment. Unspecified renders as Left.
        align: Vec<TableAlign>,
    },
    Rule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TableAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// A top-level block plus its byte range in the source. The range start is
/// the stable-boundary anchor for incremental reparses.
#[derive(Debug, Clone, PartialEq)]
pub struct TopBlock {
    pub range: Range<usize>,
    pub block: Block,
}

/// The parse result: top-level blocks in document order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BlockTree {
    // Completed blocks are immutable; streamed tail updates share their
    // contents with earlier trees.
    pub blocks: Vec<Arc<TopBlock>>,
}

impl BlockTree {
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    pub fn len(&self) -> usize {
        self.blocks.len()
    }
}

fn options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

/// Parse a whole source into a [`BlockTree`].
pub fn parse_full(source: &str) -> BlockTree {
    parse_at(source, 0)
}

fn parse_at(source: &str, offset: usize) -> BlockTree {
    let events: Vec<(Event, Range<usize>)> = Parser::new_ext(source, options())
        .into_offset_iter()
        .map(|(event, range)| (event, range.start + offset..range.end + offset))
        .collect();
    let mut cur = Cursor {
        events: &events,
        ix: 0,
    };
    let mut blocks = Vec::new();
    while let Some((event, range)) = cur.peek() {
        let range = range.clone();
        match event {
            Event::Rule => {
                cur.bump();
                blocks.push(Arc::new(TopBlock {
                    range,
                    block: Block::Rule,
                }));
            }
            Event::Start(_) => {
                for block in parse_started_block(&mut cur) {
                    blocks.push(Arc::new(TopBlock {
                        range: range.clone(),
                        block,
                    }));
                }
            }
            // Stray inline events at the top level should not happen; skip.
            _ => cur.bump(),
        }
    }
    BlockTree { blocks }
}

struct Cursor<'a, 'e> {
    events: &'a [(Event<'e>, Range<usize>)],
    ix: usize,
}

impl<'e> Cursor<'_, 'e> {
    fn peek(&self) -> Option<&(Event<'e>, Range<usize>)> {
        self.events.get(self.ix)
    }

    fn peek_event(&self) -> Option<&Event<'e>> {
        self.peek().map(|(e, _)| e)
    }

    fn bump(&mut self) {
        self.ix += 1;
    }

    fn next_event(&mut self) -> Option<Event<'e>> {
        let event = self.events.get(self.ix).map(|(e, _)| e.clone());
        if event.is_some() {
            self.ix += 1;
        }
        event
    }
}

fn is_block_tag(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::CodeBlock(_)
            | Tag::BlockQuote(_)
            | Tag::List(_)
            | Tag::Item
            | Tag::Table(_)
            | Tag::HtmlBlock
            | Tag::FootnoteDefinition(_)
    )
}

/// Consume a `Start(tag)` and everything through its matching `End`.
/// Unknown containers are transparent: their children splice in.
fn parse_started_block(cur: &mut Cursor) -> Vec<Block> {
    let Some(Event::Start(tag)) = cur.next_event() else {
        return Vec::new();
    };
    match tag {
        Tag::Paragraph => {
            if let Some(images) = take_standalone_images(cur) {
                return images;
            }
            vec![Block::Paragraph {
                runs: parse_inline_container(cur, &InlineStyle::default()),
            }]
        }
        Tag::Heading { level, .. } => vec![Block::Heading {
            level: heading_level(level),
            runs: parse_inline_container(cur, &InlineStyle::default()),
        }],
        Tag::CodeBlock(kind) => {
            let language = match kind {
                CodeBlockKind::Fenced(info) => {
                    let lang = info.split_whitespace().next().unwrap_or("");
                    (!lang.is_empty()).then(|| lang.to_string())
                }
                CodeBlockKind::Indented => None,
            };
            let mut code = String::new();
            loop {
                match cur.next_event() {
                    Some(Event::Text(t)) => code.push_str(&t),
                    Some(Event::End(_)) | None => break,
                    Some(_) => {}
                }
            }
            // Fenced blocks carry a trailing newline. Keeping it would render
            // a phantom final line, and the block's height is line-exact.
            if code.ends_with('\n') {
                code.pop();
            }
            vec![Block::CodeBlock { language, code }]
        }
        Tag::BlockQuote(_) => vec![Block::BlockQuote {
            children: parse_block_sequence(cur),
        }],
        Tag::List(ordered_start) => {
            let mut items = Vec::new();
            loop {
                match cur.peek_event() {
                    Some(Event::Start(Tag::Item)) => {
                        cur.bump();
                        items.push(parse_block_sequence(cur));
                    }
                    Some(Event::End(_)) | None => {
                        cur.bump();
                        break;
                    }
                    Some(_) => cur.bump(),
                }
            }
            vec![Block::List {
                ordered_start,
                items,
            }]
        }
        Tag::Table(align) => {
            let align = align
                .iter()
                .map(|a| match a {
                    Alignment::Center => TableAlign::Center,
                    Alignment::Right => TableAlign::Right,
                    Alignment::None | Alignment::Left => TableAlign::Left,
                })
                .collect();
            vec![parse_table(cur, align)]
        }
        Tag::HtmlBlock => {
            // Raw HTML renders as plain text. Rendering it for real would mean
            // an HTML engine, and swallowing it silently loses content.
            let mut text = String::new();
            loop {
                match cur.next_event() {
                    Some(Event::Html(t)) | Some(Event::Text(t)) => text.push_str(&t),
                    Some(Event::End(_)) | None => break,
                    Some(_) => {}
                }
            }
            let text = text.trim_end_matches('\n').to_string();
            if text.is_empty() {
                Vec::new()
            } else {
                vec![Block::Paragraph {
                    runs: vec![InlineRun {
                        text,
                        style: InlineStyle::default(),
                    }],
                }]
            }
        }
        _ => parse_block_sequence(cur),
    }
}

/// Parse a block sequence until the container's `End`, which is consumed.
/// Bare inline events (tight list items) accumulate into an implicit paragraph.
fn parse_block_sequence(cur: &mut Cursor) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let mut inline_acc: Vec<InlineRun> = Vec::new();
    while let Some(event) = cur.peek_event() {
        match event {
            Event::End(_) => {
                cur.bump();
                break;
            }
            Event::Start(tag) if is_block_tag(tag) => {
                flush_paragraph(&mut out, &mut inline_acc);
                out.extend(parse_started_block(cur));
            }
            Event::Rule => {
                flush_paragraph(&mut out, &mut inline_acc);
                cur.bump();
                out.push(Block::Rule);
            }
            _ => parse_inline_event(cur, &mut inline_acc, &InlineStyle::default()),
        }
    }
    flush_paragraph(&mut out, &mut inline_acc);
    out
}

fn flush_paragraph(out: &mut Vec<Block>, acc: &mut Vec<InlineRun>) {
    if !acc.is_empty() {
        out.push(Block::Paragraph {
            runs: autolink_runs(merge_runs(std::mem::take(acc))),
        });
    }
}

fn parse_table(cur: &mut Cursor, align: Vec<TableAlign>) -> Block {
    let mut header = Vec::new();
    let mut rows = Vec::new();
    loop {
        match cur.peek_event() {
            Some(Event::Start(Tag::TableHead)) => {
                cur.bump();
                header = parse_table_cells(cur);
            }
            Some(Event::Start(Tag::TableRow)) => {
                cur.bump();
                rows.push(parse_table_cells(cur));
            }
            Some(Event::End(_)) | None => {
                cur.bump();
                break;
            }
            Some(_) => cur.bump(),
        }
    }
    Block::Table {
        header,
        rows,
        align,
    }
}

/// Consume a paragraph that holds nothing but images — and optional
/// whitespace between them — as one `Block::Image` per image, through the
/// paragraph's `End`. Returns `None` (consuming nothing) the moment any other
/// inline content appears, so mixed paragraphs take the normal path where an
/// image degrades to a link-styled run of its alt text.
fn take_standalone_images(cur: &mut Cursor) -> Option<Vec<Block>> {
    let events = cur.events;
    let mut ix = cur.ix;
    let mut blocks = Vec::new();
    loop {
        while matches!(
            events.get(ix).map(|(event, _)| event),
            Some(Event::Text(text)) if text.trim().is_empty()
        ) {
            ix += 1;
        }
        match events.get(ix).map(|(event, _)| event) {
            Some(Event::Start(Tag::Image { dest_url, .. })) => {
                let url = dest_url.to_string();
                ix += 1;
                let alt = collect_image_alt(events, &mut ix)?;
                blocks.push(Block::Image { url, alt });
            }
            Some(Event::End(TagEnd::Paragraph)) if !blocks.is_empty() => {
                cur.ix = ix + 1;
                return Some(blocks);
            }
            _ => return None,
        }
    }
}

/// Collect the alt text of one image, stopping at the image's own `End`.
/// Nested inline formatting contributes its text but not its styling; any
/// event that cannot be alt text fails the standalone match.
fn collect_image_alt(events: &[(Event, Range<usize>)], ix: &mut usize) -> Option<String> {
    let mut alt = String::new();
    let mut depth = 0usize;
    loop {
        match events.get(*ix).map(|(event, _)| event) {
            Some(Event::Text(text)) => {
                alt.push_str(text);
                *ix += 1;
            }
            Some(Event::Code(text)) => {
                alt.push_str(text);
                *ix += 1;
            }
            Some(Event::SoftBreak) | Some(Event::HardBreak) => {
                alt.push(' ');
                *ix += 1;
            }
            Some(Event::Start(_)) => {
                depth += 1;
                *ix += 1;
            }
            Some(Event::End(TagEnd::Image)) if depth == 0 => {
                *ix += 1;
                return Some(alt);
            }
            Some(Event::End(_)) => {
                depth -= 1;
                *ix += 1;
            }
            _ => return None,
        }
    }
}

fn parse_table_cells(cur: &mut Cursor) -> Vec<Vec<InlineRun>> {
    let mut cells = Vec::new();
    loop {
        match cur.peek_event() {
            Some(Event::Start(Tag::TableCell)) => {
                cur.bump();
                cells.push(parse_inline_container(cur, &InlineStyle::default()));
            }
            Some(Event::End(_)) | None => {
                cur.bump();
                break;
            }
            Some(_) => cur.bump(),
        }
    }
    cells
}

/// Parse inline events until the container's `End`, which is consumed.
fn parse_inline_container(cur: &mut Cursor, style: &InlineStyle) -> Vec<InlineRun> {
    let mut runs = Vec::new();
    while let Some(event) = cur.peek_event() {
        if matches!(event, Event::End(_)) {
            cur.bump();
            break;
        }
        parse_inline_event(cur, &mut runs, style);
    }
    // Autolink AFTER merging: pulldown splits `Text` events at would-be
    // emphasis characters, so `…/Foo_(bar)` arrives as three events and a
    // per-event scan would truncate the URL at every underscore.
    autolink_runs(merge_runs(runs))
}

fn parse_inline_event(cur: &mut Cursor, runs: &mut Vec<InlineRun>, style: &InlineStyle) {
    let Some(event) = cur.next_event() else {
        return;
    };
    let push = |runs: &mut Vec<InlineRun>, text: String, style: InlineStyle| {
        if !text.is_empty() {
            runs.push(InlineRun { text, style });
        }
    };
    match event {
        Event::Text(t) => push(runs, t.into_string(), style.clone()),
        Event::Code(t) => {
            let mut s = style.clone();
            s.code = true;
            push(runs, t.into_string(), s);
        }
        Event::SoftBreak => push(runs, " ".into(), style.clone()),
        Event::HardBreak => push(runs, "\n".into(), style.clone()),
        Event::Html(t) | Event::InlineHtml(t) => push(runs, t.into_string(), style.clone()),
        Event::TaskListMarker(done) => push(
            runs,
            if done { "[x] ".into() } else { "[ ] ".into() },
            style.clone(),
        ),
        Event::FootnoteReference(t) => push(runs, format!("[{t}]"), style.clone()),
        Event::Start(tag) => {
            let mut inner = style.clone();
            match tag {
                Tag::Emphasis => inner.italic = true,
                Tag::Strong => inner.bold = true,
                Tag::Strikethrough => inner.strikethrough = true,
                Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. } => {
                    inner.link = Some(dest_url.into_string());
                }
                _ => {}
            }
            runs.extend(parse_inline_container(cur, &inner));
        }
        // `End` is consumed by the container loop; anything else is ignored.
        _ => {}
    }
}

/// Promote bare `http(s)://` URLs into link runs.
///
/// This is GFM's autolink extension, which pulldown-cmark has no option for.
/// Without it a pasted PR link renders as dead text. Runs already inside a link
/// or a code span pass through untouched, and the pass is idempotent.
fn autolink_runs(runs: Vec<InlineRun>) -> Vec<InlineRun> {
    let mut out = Vec::with_capacity(runs.len());
    for run in runs {
        if run.style.link.is_some() || run.style.code {
            out.push(run);
        } else {
            push_text_autolinked(&mut out, &run.text, &run.style);
        }
    }
    out
}

fn push_text_autolinked(runs: &mut Vec<InlineRun>, text: &str, style: &InlineStyle) {
    let push = |runs: &mut Vec<InlineRun>, text: &str, style: InlineStyle| {
        if !text.is_empty() {
            runs.push(InlineRun {
                text: text.to_string(),
                style,
            });
        }
    };
    let mut rest = text;
    while let Some(at) = find_url_start(rest) {
        let from = &rest[at..];
        let scheme = if from.starts_with("https://") {
            "https://".len()
        } else {
            "http://".len()
        };
        let len = bare_url_len(from);
        if len <= scheme {
            // A scheme with nothing after it stays text, and must not be re-found.
            push(runs, &rest[..at + scheme], style.clone());
            rest = &from[scheme..];
            continue;
        }
        push(runs, &rest[..at], style.clone());
        let mut linked = style.clone();
        linked.link = Some(from[..len].to_string());
        push(runs, &from[..len], linked);
        rest = &from[len..];
    }
    push(runs, rest, style.clone());
}

/// First viable `http(s)://`, not glued to a preceding alphanumeric, per GFM's
/// boundary rule: `foohttps://x` stays text.
fn find_url_start(text: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(rel) = text[from..].find("http") {
        let at = from + rel;
        let after = &text[at..];
        let is_scheme = after.starts_with("http://") || after.starts_with("https://");
        let boundary = text[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphanumeric());
        if is_scheme && boundary {
            return Some(at);
        }
        from = at + "http".len();
    }
    None
}

/// Byte length of the bare URL at the start of `text`: run to whitespace or a
/// delimiter that never appears in pasted URLs, then trim the trailing
/// punctuation GFM excludes. A closing paren only survives when an opener
/// inside the URL balances it, so `…/Foo_(bar))` keeps one and sheds one.
fn bare_url_len(text: &str) -> usize {
    let end = text
        .char_indices()
        .find(|(_, c)| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '`'))
        .map_or(text.len(), |(i, _)| i);
    let mut url = &text[..end];
    while let Some(last) = url.chars().next_back() {
        let trim = match last {
            '.' | ',' | ';' | ':' | '!' | '?' | '*' | '_' | '~' => true,
            ')' => url.matches('(').count() < url.matches(')').count(),
            _ => false,
        };
        if !trim {
            break;
        }
        url = &url[..url.len() - last.len_utf8()];
    }
    url.len()
}

/// Merge adjacent identically-styled runs. Keeps run counts small and makes the
/// tree canonical, which is what lets equality tests be readable.
fn merge_runs(runs: Vec<InlineRun>) -> Vec<InlineRun> {
    let mut out: Vec<InlineRun> = Vec::with_capacity(runs.len());
    for run in runs {
        match out.last_mut() {
            Some(last) if last.style == run.style => last.text.push_str(&run.text),
            _ => out.push(run),
        }
    }
    out
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

// ---------------------------------------------------------------------------
// Incremental parse
// ---------------------------------------------------------------------------

/// Streaming parser: appends reparse only from the last stable top-level block
/// boundary (snapped back to a line start so indentation context survives).
#[derive(Debug, Default)]
pub struct IncrementalParser {
    source: String,
    tree: BlockTree,
    /// Link-reference definitions act at a distance — full reparses only.
    full_only: bool,
    /// Bytes fed through `parse_full` by the most recent `set_text`/`append`/
    /// `reset` — instrumentation proving per-append work is O(tail), not
    /// O(total). 0 for a no-op set_text.
    last_parse_bytes: usize,
    /// Number of leading top-level blocks guaranteed untouched by the most
    /// recent update (render caches for these blocks stay valid).
    stable_prefix_blocks: usize,
}

impl IncrementalParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn tree(&self) -> &BlockTree {
        &self.tree
    }

    /// Bytes actually reparsed by the last update (see field docs).
    pub fn last_parse_bytes(&self) -> usize {
        self.last_parse_bytes
    }

    /// Leading top-level blocks left untouched by the last update.
    pub fn stable_prefix_blocks(&self) -> usize {
        self.stable_prefix_blocks
    }

    /// Set the source: appends take the incremental path, anything else resets.
    pub fn set_text(&mut self, text: &str) {
        if text.len() >= self.source.len() && text.starts_with(self.source.as_str()) {
            let delta = &text[self.source.len()..];
            if delta.is_empty() {
                self.last_parse_bytes = 0;
                self.stable_prefix_blocks = self.tree.blocks.len();
                return;
            }
            self.append(delta);
        } else {
            self.reset(text);
        }
    }

    pub fn reset(&mut self, text: &str) {
        self.source = text.to_string();
        self.full_only = has_link_defs(text);
        self.tree = parse_full(text);
        self.last_parse_bytes = text.len();
        self.stable_prefix_blocks = 0;
    }

    /// Append streamed text, reparsing from the last stable boundary.
    pub fn append(&mut self, delta: &str) {
        if delta.is_empty() {
            self.last_parse_bytes = 0;
            self.stable_prefix_blocks = self.tree.blocks.len();
            return;
        }
        // The delta may complete a line begun earlier — rescan from that line's
        // start when checking for definitions.
        let scan_from = self.source.rfind('\n').map(|i| i + 1).unwrap_or(0);
        self.source.push_str(delta);
        if !self.full_only && has_link_defs(&self.source[scan_from..]) {
            self.full_only = true;
        }
        if self.full_only {
            self.tree = parse_full(&self.source);
            self.last_parse_bytes = self.source.len();
            self.stable_prefix_blocks = 0;
            return;
        }

        // Stable boundary: start of the SECOND-to-last top-level block, snapped
        // back to its line start (keeps indented-code / fenced-indent context
        // intact). Reparsing the last two blocks — not just the last — covers
        // continuation merges: a trailing paragraph like `3` can become `3.`
        // and fuse into the preceding loose list. Merges cannot cascade
        // further back (a block's separation from its predecessor is decided
        // by its own already-streamed leading bytes), so two blocks suffice;
        // the parity tests stream corpora to hold this invariant.
        let boundary = match self.tree.blocks.len() {
            0 | 1 => 0,
            n => self.tree.blocks[n - 2].range.start,
        };
        let boundary = self.source[..boundary]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);

        let tail = parse_at(&self.source[boundary..], boundary);
        self.last_parse_bytes = self.source.len() - boundary;
        self.tree.blocks.retain(|b| b.range.start < boundary);
        self.stable_prefix_blocks = self.tree.blocks.len();
        for top in tail.blocks {
            self.tree.blocks.push(top);
        }
    }
}

/// Conservative detector for link-reference-definition lines
/// (`[label]: destination`, up to 3 leading spaces).
fn has_link_defs(text: &str) -> bool {
    text.lines().any(|line| {
        let trimmed = line.trim_start();
        line.len() - trimmed.len() <= 3 && trimmed.starts_with('[') && trimmed.contains("]:")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Index into the tree at the Block level; tests don't care about ranges.
    fn b(tree: &BlockTree, index: usize) -> &Block {
        &tree.blocks[index].block
    }

    fn plain(text: &str) -> InlineRun {
        InlineRun {
            text: text.into(),
            style: InlineStyle::default(),
        }
    }

    fn flat(runs: &[InlineRun]) -> String {
        runs.iter().map(|r| r.text.as_str()).collect()
    }

    #[test]
    fn parses_headings_at_every_level() {
        let tree = parse_full("# One\n\n## Two\n\n###### Six");
        assert_eq!(tree.blocks.len(), 3);
        match b(&tree, 0) {
            Block::Heading { level, runs } => {
                assert_eq!(*level, 1);
                assert_eq!(runs, &vec![plain("One")]);
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(b(&tree, 2), Block::Heading { level: 6, .. }));
    }

    #[test]
    fn parses_inline_emphasis_and_code() {
        let tree = parse_full("**bold** *em* `code` ~~gone~~");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        assert!(runs.iter().any(|r| r.style.bold && r.text == "bold"));
        assert!(runs.iter().any(|r| r.style.italic && r.text == "em"));
        assert!(runs.iter().any(|r| r.style.code && r.text == "code"));
        assert!(runs
            .iter()
            .any(|r| r.style.strikethrough && r.text == "gone"));
    }

    #[test]
    fn parses_links_and_keeps_their_text() {
        let tree = parse_full("see [docs](https://example.com/x) now");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        let link = runs.iter().find(|r| r.style.link.is_some()).unwrap();
        assert_eq!(link.text, "docs");
        assert_eq!(link.style.link.as_deref(), Some("https://example.com/x"));
        assert_eq!(flat(runs), "see docs now");
    }

    #[test]
    fn a_lone_image_becomes_an_image_block() {
        let tree = parse_full("![a chart](https://example.com/chart.png)");
        assert_eq!(tree.len(), 1);
        assert_eq!(
            b(&tree, 0),
            &Block::Image {
                url: "https://example.com/chart.png".into(),
                alt: "a chart".into(),
            }
        );
    }

    #[test]
    fn several_images_in_one_paragraph_become_sequential_blocks() {
        let tree = parse_full("![one](1.png) ![two](2.png)");
        assert_eq!(tree.len(), 2);
        assert_eq!(b(&tree, 0), &Block::Image { url: "1.png".into(), alt: "one".into() });
        assert_eq!(b(&tree, 1), &Block::Image { url: "2.png".into(), alt: "two".into() });
    }

    #[test]
    fn an_image_among_text_stays_a_link_run() {
        let tree = parse_full("before ![alt](img.png) after");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        let link = runs.iter().find(|r| r.style.link.is_some()).unwrap();
        assert_eq!(link.text, "alt");
        assert_eq!(link.style.link.as_deref(), Some("img.png"));
    }

    #[test]
    fn image_alt_flattens_nested_formatting_and_breaks() {
        let tree = parse_full("![plain *bold* `code`\nmore](img.png)");
        assert_eq!(tree.len(), 1);
        assert_eq!(
            b(&tree, 0),
            &Block::Image {
                url: "img.png".into(),
                alt: "plain bold code more".into(),
            }
        );
    }

    #[test]
    fn an_image_with_an_empty_alt_is_still_a_block() {
        let tree = parse_full("![](img.png)");
        assert_eq!(tree.len(), 1);
        assert_eq!(
            b(&tree, 0),
            &Block::Image {
                url: "img.png".into(),
                alt: String::new(),
            }
        );
    }

    #[test]
    fn autolinks_bare_urls() {
        let tree = parse_full("go to https://github.com/remorses/gpuix now");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        let link = runs.iter().find(|r| r.style.link.is_some()).unwrap();
        assert_eq!(link.text, "https://github.com/remorses/gpuix");
    }

    #[test]
    fn autolink_trims_trailing_punctuation_but_balances_parens() {
        let tree = parse_full("see https://x.dev/a_(b), ok");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        let link = runs.iter().find(|r| r.style.link.is_some()).unwrap();
        assert_eq!(link.text, "https://x.dev/a_(b)");
    }

    #[test]
    fn does_not_autolink_glued_schemes() {
        let tree = parse_full("foohttps://x.dev bar");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        assert!(runs.iter().all(|r| r.style.link.is_none()));
    }

    #[test]
    fn parses_fenced_code_with_a_language_and_no_trailing_newline() {
        let tree = parse_full("```ts\nconst a = 1\nconst b = 2\n```");
        match b(&tree, 0) {
            Block::CodeBlock { language, code } => {
                assert_eq!(language.as_deref(), Some("ts"));
                assert_eq!(code, "const a = 1\nconst b = 2");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_unordered_and_ordered_lists() {
        let tree = parse_full("- a\n- b\n\n3. x\n4. y");
        match b(&tree, 0) {
            Block::List {
                ordered_start,
                items,
            } => {
                assert_eq!(*ordered_start, None);
                assert_eq!(items.len(), 2);
            }
            other => panic!("{other:?}"),
        }
        match b(&tree, 1) {
            Block::List { ordered_start, .. } => assert_eq!(*ordered_start, Some(3)),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_nested_lists() {
        let tree = parse_full("- outer\n  - inner");
        let Block::List { items, .. } = b(&tree, 0) else {
            panic!("expected a list");
        };
        assert!(items[0]
            .iter()
            .any(|block| matches!(block, Block::List { .. })));
    }

    #[test]
    fn parses_block_quotes_with_nested_blocks() {
        let tree = parse_full("> quoted\n>\n> - item");
        let Block::BlockQuote { children } = b(&tree, 0) else {
            panic!("expected a block quote");
        };
        assert!(matches!(children[0], Block::Paragraph { .. }));
        assert!(matches!(children[1], Block::List { .. }));
    }

    #[test]
    fn parses_tables_with_alignment() {
        let tree = parse_full("| a | b |\n|:--|--:|\n| 1 | 2 |");
        match b(&tree, 0) {
            Block::Table {
                header,
                rows,
                align,
            } => {
                assert_eq!(flat(&header[0]), "a");
                assert_eq!(flat(&rows[0][1]), "2");
                assert_eq!(align, &vec![TableAlign::Left, TableAlign::Right]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_horizontal_rules() {
        let tree = parse_full("a\n\n---\n\nb");
        assert!(matches!(b(&tree, 1), Block::Rule));
    }

    #[test]
    fn task_list_markers_become_literal_text() {
        let tree = parse_full("- [x] done\n- [ ] todo");
        let Block::List { items, .. } = b(&tree, 0) else {
            panic!("expected a list");
        };
        let Block::Paragraph { runs } = &items[0][0] else {
            panic!("expected a paragraph");
        };
        assert_eq!(flat(runs), "[x] done");
    }

    #[test]
    fn raw_html_renders_as_text_instead_of_vanishing() {
        let tree = parse_full("<div>hi</div>");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        assert!(flat(runs).contains("<div>hi</div>"));
    }

    #[test]
    fn soft_breaks_become_spaces_and_hard_breaks_newlines() {
        let tree = parse_full("one\ntwo");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        assert_eq!(flat(runs), "one two");

        let tree = parse_full("one  \ntwo");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        assert_eq!(flat(runs), "one\ntwo");
    }

    #[test]
    fn adjacent_runs_of_the_same_style_merge() {
        let tree = parse_full("plain **a** **b**");
        let Block::Paragraph { runs } = b(&tree, 0) else {
            panic!("expected a paragraph");
        };
        // "a" and "b" are separated by a plain space, so three runs, not five.
        assert_eq!(runs.len(), 4, "{runs:?}");
    }

    #[test]
    fn an_empty_document_has_no_blocks() {
        assert!(parse_full("").is_empty());
        assert!(parse_full("   \n\n  ").is_empty());
    }

    #[test]
    fn unclosed_fences_still_produce_a_code_block() {
        let tree = parse_full("```rust\nfn main() {}");
        assert!(matches!(b(&tree, 0), Block::CodeBlock { .. }));
    }

    // ── Incremental parse (ported from Comet) ───────────────────────────

    const CORPORA: &[&str] = &[
        "# Title\n\nHello **bold** and *italic* and `code` and ~~gone~~.\n",
        "Paragraph one\nlazy continuation\n\nParagraph two with a [link](https://x.dev).\n",
        "- item one\n- item two\n  - nested a\n  - nested b\n- item three\n\ntail\n",
        "1. first\n2. second\n\n   loose paragraph in item\n\n3. third\n",
        "```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\nafter code\n",
        "intro\n\n```\nunclosed fence streaming",
        "> quoted line\n> more quote\n>\n> - a list in a quote\n\nplain\n",
        "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\ndone\n",
        "setext candidate\n===\n\nnext para\n---\n",
        "***\n\ntext between rules\n\n---\n",
        "- [x] done task\n- [ ] open task\n",
        "    indented code line one\n    line two\n\npara\n",
        "para with <span>inline html</span> inside\n\n<div>\nblock html\n</div>\n",
        "###### deep heading\n\n#### h4\n",
        "![a chart](https://example.com/chart.png)\n\n![one](1.png) ![two](2.png)\n",
    ];

    const STORY: &str = "\"How do we negotiate with machines that won't speak?\" someone asked.\n\nYuki almost laughed. \"You don't. You listen to the silence. And you finally understand what it means to be powerless.\"";

    fn stream(chunks: usize, text: &str) -> IncrementalParser {
        let mut p = IncrementalParser::new();
        let bytes = text.as_bytes();
        let mut start = 0;
        while start < bytes.len() {
            let mut end = (start + chunks).min(bytes.len());
            while end < bytes.len() && !text.is_char_boundary(end) {
                end += 1;
            }
            p.append(&text[start..end]);
            start = end;
        }
        p
    }

    #[test]
    fn incremental_matches_full_on_streamed_corpora() {
        for (ci, corpus) in CORPORA.iter().enumerate() {
            let full = parse_full(corpus);
            for chunk in [1usize, 2, 3, 7, 16, 64] {
                assert_eq!(
                    stream(chunk, corpus).tree(),
                    &full,
                    "corpus {ci} diverged at chunk size {chunk}:\n{corpus}"
                );
            }
        }
    }

    #[test]
    fn appends_keep_committed_blocks_identical() {
        // Streaming stability invariant: blocks before the reparse boundary
        // (everything but the last two top-level blocks) must be reused
        // as-is across appends — same index, same value — so row/element keys
        // never re-mount and earlier blocks can never visibly reflow.
        for corpus in CORPORA {
            let mut p = IncrementalParser::new();
            let mut prev = p.tree().clone();
            let bytes = corpus.as_bytes();
            let mut start = 0;
            while start < bytes.len() {
                let mut end = (start + 3).min(bytes.len());
                while end < bytes.len() && !corpus.is_char_boundary(end) {
                    end += 1;
                }
                p.append(&corpus[start..end]);
                start = end;

                let cur = p.tree();
                let committed = prev.blocks.len().saturating_sub(2);
                assert!(
                    cur.blocks.len() >= committed,
                    "committed blocks disappeared:\n{corpus}"
                );
                for i in 0..committed {
                    assert_eq!(
                        cur.blocks[i], prev.blocks[i],
                        "block {i} changed across an append:\n{corpus}"
                    );
                }
                prev = cur.clone();
            }
        }
    }

    #[test]
    fn incremental_matches_full_with_link_definitions() {
        // Definitions act at a distance → parser falls back to full reparses,
        // so parity must still hold.
        let corpus = "See [docs] for more.\n\nMore text.\n\n[docs]: https://example.com\n";
        let full = parse_full(corpus);
        for chunk in [1usize, 3, 9] {
            assert_eq!(stream(chunk, corpus).tree(), &full, "chunk {chunk}");
        }
        // The reference actually resolved into a link.
        let has_link = full.blocks.iter().any(|b| match &b.block {
            Block::Paragraph { runs } => runs.iter().any(|r| r.style.link.is_some()),
            _ => false,
        });
        assert!(has_link, "expected [docs] to resolve to a link");
    }

    #[test]
    fn set_text_appends_or_resets() {
        let mut p = IncrementalParser::new();
        p.set_text("hello");
        p.set_text("hello world");
        assert_eq!(p.tree(), &parse_full("hello world"));
        // Non-append rewrites reset cleanly.
        p.set_text("different");
        assert_eq!(p.tree(), &parse_full("different"));
        assert_eq!(p.source(), "different");
    }

    #[test]
    fn incremental_appends_cost_tail_not_document() {
        let mut p = IncrementalParser::new();
        let para = "some paragraph text here\n\n";
        let source = para.repeat(8);
        p.reset(&source);
        p.append(" tail");
        // The reparse covers the last two blocks, not the eight-paragraph
        // document, and still equals a full parse of the extended source.
        assert!(p.last_parse_bytes() < source.len() / 2);
        assert_eq!(p.tree(), &parse_full(&(source.clone() + " tail")));
    }

    #[test]
    fn top_level_ranges_are_stable_anchors() {
        let src = "first\n\nsecond\n\nthird";
        let tree = parse_full(src);
        assert_eq!(tree.len(), 3);
        assert!(
            tree.blocks
                .windows(2)
                .all(|w| w[0].range.start < w[1].range.start)
        );
        assert_eq!(&src[tree.blocks[1].range.clone()], "second\n");
    }

    #[test]
    fn full_parse_keeps_trailing_quote_in_block() {
        let tree = parse_full(STORY);
        assert_eq!(tree.blocks.len(), 2, "two paragraphs expected");
        let last = &tree.blocks[1];
        assert!(STORY[last.range.clone()].ends_with("powerless.\""));
    }

    #[test]
    fn streamed_boundary_at_quote_adds_no_block() {
        // Stream with a commit boundary exactly between `powerless.` and `"`.
        let split = STORY.len() - 1;
        let mut p = IncrementalParser::new();
        p.set_text(&STORY[..split]);
        p.set_text(STORY);
        let tree = p.tree();
        assert_eq!(tree.blocks.len(), 2, "streamed split must not add blocks");
        assert!(STORY[tree.blocks[1].range.clone()].ends_with("powerless.\""));
    }

    #[test]
    fn streamed_small_chunks_match_full_parse() {
        let mut p = IncrementalParser::new();
        let mut fed = String::new();
        for chunk in STORY.as_bytes().chunks(7) {
            fed.push_str(std::str::from_utf8(chunk).unwrap());
            p.set_text(&fed);
        }
        let full = parse_full(STORY);
        assert_eq!(p.tree().blocks.len(), full.blocks.len());
        for (a, b) in p.tree().blocks.iter().zip(full.blocks.iter()) {
            assert_eq!(a.range, b.range);
        }
    }
}
