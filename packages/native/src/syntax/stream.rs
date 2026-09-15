//! Stable-prefix streaming cache for growing sources.
//!
//! A streamed code block (chat tokens, patch chunks) grows by appends, so
//! every step's content starts with the previous step's content. The
//! document cache keys on the full-content hash and always misses; this cache
//! keeps, per language, the source plus the parser checkpoint at its last
//! line start, so the next append re-parses only the final (previously
//! partial) line and the new tail.
//!
//! The checkpoint deliberately excludes the final line: a streamed chunk can
//! cut mid-token, so the last line's spans are provisional until more text
//! arrives.

use std::sync::{Mutex, OnceLock};

use syntect::parsing::{ParseState, ScopeStack};

use super::cache::QUERY_GENERATION;
use super::{
    detect_language, highlight_with_resume, HighlightLimits, HighlightRequest, HighlightedDocument,
    LanguageId, ResumeState,
};

const MAX_SLOTS: usize = 4;
/// Sources above this stay in the document cache only; a slot holds a source
/// copy plus a span vector, and streaming sources this large are pathological.
const MAX_STREAM_BYTES: usize = 2 * 1024 * 1024;

struct Slot {
    language: LanguageId,
    /// The exact source `state` was checkpointed against.
    source: String,
    state: ResumeState,
    last_used: u64,
}

#[derive(Default)]
struct StreamCache {
    slots: Vec<Slot>,
    ticks: u64,
    hits: u64,
    resumes_saved: usize,
}

impl StreamCache {
    fn find(&mut self, language: LanguageId, source: &str) -> Option<Slot> {
        let ticks = &mut self.ticks;
        let hits = &mut self.hits;
        let position = self.slots.iter().position(|slot| {
            slot.language == language
                && source.len() > slot.source.len()
                && source.as_bytes().starts_with(slot.source.as_bytes())
        })?;
        *ticks += 1;
        *hits += 1;
        let mut slot = self.slots.swap_remove(position);
        slot.last_used = *ticks;
        Some(slot)
    }

    fn store(&mut self, language: LanguageId, source: &str, state: ResumeState) {
        if source.len() > MAX_STREAM_BYTES {
            return;
        }
        // Extending an existing stream replaces its slot; a new stream takes a
        // fresh one, evicting the least recently used beyond the cap.
        if let Some(slot) = self.slots.iter_mut().find(|slot| {
            slot.language == language
                && source.len() >= slot.source.len()
                && source.as_bytes().starts_with(slot.source.as_bytes())
        }) {
            slot.source = source.to_string();
            slot.state = state;
            self.ticks += 1;
            slot.last_used = self.ticks;
            return;
        }
        self.ticks += 1;
        let last_used = self.ticks;
        self.slots.push(Slot {
            language,
            source: source.to_string(),
            state,
            last_used,
        });
        while self.slots.len() > MAX_SLOTS {
            let evict = self
                .slots
                .iter()
                .enumerate()
                .min_by_key(|(_, slot)| slot.last_used)
                .map(|(ix, _)| ix)
                .expect("slots is not empty");
            self.slots.swap_remove(evict);
        }
    }
}

fn global() -> &'static Mutex<StreamCache> {
    static CACHE: OnceLock<Mutex<StreamCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(StreamCache::default()))
}

/// How many appends resumed from a checkpoint instead of re-parsing, and how
/// many slots are live.
pub(crate) fn stats() -> (u64, usize) {
    global()
        .lock()
        .map(|cache| (cache.hits, cache.slots.len()))
        .unwrap_or((0, 0))
}

/// Highlight `source`, resuming from a stored checkpoint when it extends a
/// cached stream. Returns `None` when no slot matches or the resumed parse
/// failed; the caller then falls back to a full parse.
pub(crate) fn try_resume(
    language: LanguageId,
    source: &str,
    path: Option<&str>,
    fence_tag: Option<&str>,
) -> Option<(HighlightedDocument, ResumeState)> {
    let slot = global().lock().ok()?.find(language, source)?;
    let (document, state) = highlight_with_resume(
        HighlightRequest {
            source,
            path,
            fence_tag,
        },
        HighlightLimits::default(),
        Some(slot.state),
    )
    .ok()?;
    // The resume carried the wrong grammar if detection flipped between
    // chunks (first-line heuristics); serve nothing and let the caller do a
    // full, consistent parse.
    (document.language == language).then_some((document, state))
}

/// Record the checkpoint for a freshly highlighted `source`.
pub(crate) fn store(language: LanguageId, source: &str, state: ResumeState) {
    if let Ok(mut cache) = global().lock() {
        cache.store(language, source, state);
    }
}

/// Test-only reset of the slots.
#[cfg(test)]
pub(crate) fn reset() {
    if let Ok(mut cache) = global().lock() {
        *cache = StreamCache::default();
    }
}

#[cfg(test)]
mod tests {
    use super::super::highlight;
    use super::*;

    const RUST_CODE: &str = "\
fn first(left: u32, right: u32) -> u32 {
    let sum = left + right;
    format!(\"sum is {sum}\")
}

pub fn second() -> Option<String> {
    first(2, 3).checked_add(1).map(|n| n.to_string())
}
";

    #[test]
    fn resumed_highlights_match_a_full_reparse() {
        reset();
        let mut streamed = String::new();
        for chunk in RUST_CODE.split_inclusive(' ') {
            streamed.push_str(chunk);
            let Some((document, state)) = try_resume(
                detect_language(Some("stream.rs"), None, streamed.lines().next()).unwrap(),
                &streamed,
                Some("stream.rs"),
                None,
            )
            .or_else(|| {
                let (document, state) = highlight_with_resume(
                    HighlightRequest {
                        source: &streamed,
                        path: Some("stream.rs"),
                        fence_tag: None,
                    },
                    HighlightLimits::default(),
                    None,
                )
                .ok()?;
                Some((document, state))
            })
            else {
                panic!("highlight failed at {streamed:?}");
            };
            store(
                detect_language(Some("stream.rs"), None, streamed.lines().next()).unwrap(),
                &streamed,
                state,
            );
            let fresh = highlight(HighlightRequest {
                source: &streamed,
                path: Some("stream.rs"),
                fence_tag: None,
            })
            .unwrap();
            assert_eq!(document.lines, fresh.lines, "diverged at {streamed:?}");
        }
    }

    #[test]
    fn appends_hit_the_stream_cache() {
        reset();
        let language = LanguageId::Rust;
        let base = "fn base() {\n    1\n}\n";
        let (_, state) = highlight_with_resume(
            HighlightRequest {
                source: base,
                path: None,
                fence_tag: Some("rust"),
            },
            HighlightLimits::default(),
            None,
        )
        .unwrap();
        store(language, base, state);
        let before = stats().0;
        let appended = "fn base() {\n    1\n}\nfn more() {}\n";
        assert!(try_resume(language, appended, None, Some("rust")).is_some());
        assert_eq!(stats().0, before + 1);
    }

    #[test]
    fn diverging_sources_do_not_resume() {
        reset();
        let language = LanguageId::Rust;
        let base = "fn base() {\n    1\n}\n";
        let (_, state) = highlight_with_resume(
            HighlightRequest {
                source: base,
                path: None,
                fence_tag: Some("rust"),
            },
            HighlightLimits::default(),
            None,
        )
        .unwrap();
        store(language, base, state);
        let diverged = "fn other() {\n    2\n}\nfn more() {}\n";
        assert!(!diverged.as_bytes().starts_with(base.as_bytes()));
        assert!(try_resume(language, diverged, None, Some("rust")).is_none());
    }
}
