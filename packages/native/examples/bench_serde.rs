//! Rust half of the applyBatch serialization benchmark.
//!
//! `examples/bench-serialization.ts` captures the real mutation queue that
//! `ChatApp` produces and writes it to `tmp/batch-fixture.json`. This program
//! reads that exact file, so both halves measure the same bytes.
//!
//! It answers two questions the JS half cannot:
//!
//!   1. how long does Rust take to turn those bytes into a usable tree
//!   2. how many heap bytes does the resulting tree hold
//!
//! Both are measured, not estimated: a counting `GlobalAlloc` records every
//! allocation, so "live bytes" is the real resident cost of the tree and not a
//! `size_of` guess.
//!
//! ```text
//!   tmp/batch-fixture.json
//!        │
//!        ├─ apply_batch_to_tree ──► Vec<BatchOp> ──► RetainedTree              (shipped)
//!        ├─ serde_json ──► Vec<Value> ──► clone ──► from_value ──► StyleDesc   (the old path)
//!        ├─ serde_json ──► Vec<Op<StyleDesc>>                                  (typed)
//!        ├─ serde_json ──► Vec<Op<CompactStyle>>                               (compact)
//!        └─ rmp_serde  ──► Vec<Op<CompactStyle>>                               (compact + msgpack)
//! ```
//!
//! Run:
//! ```sh
//! cd examples && bun bench-serialization.ts     # writes the fixture
//! cd packages/native && cargo run --release --example bench_serde
//! ```

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::marker::PhantomData;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use serde::de::{self, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};

use gpuiv_native::retained_tree::RetainedTree;
use gpuiv_native::style::{parse_color_hex, StyleDesc};

// ── Counting allocator ───────────────────────────────────────────────
//
// Relaxed ordering is enough: the bench is single-threaded and only reads the
// counters at quiescent points between phases.

struct Counting;

static ALLOCATED: AtomicUsize = AtomicUsize::new(0);
static FREED: AtomicUsize = AtomicUsize::new(0);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED.fetch_add(layout.size(), Ordering::Relaxed);
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        FREED.fetch_add(layout.size(), Ordering::Relaxed);
        System.dealloc(ptr, layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if new_size >= layout.size() {
            ALLOCATED.fetch_add(new_size - layout.size(), Ordering::Relaxed);
        } else {
            FREED.fetch_add(layout.size() - new_size, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

#[derive(Clone, Copy)]
struct HeapMark {
    allocated: usize,
    freed: usize,
    allocations: usize,
}

fn heap_mark() -> HeapMark {
    HeapMark {
        allocated: ALLOCATED.load(Ordering::Relaxed),
        freed: FREED.load(Ordering::Relaxed),
        allocations: ALLOCATIONS.load(Ordering::Relaxed),
    }
}

struct HeapDelta {
    /// Every byte the allocator handed out, including bytes freed again.
    /// This is the memory-bandwidth number.
    churn: usize,
    /// Bytes still held when the measurement ended. This is the tree cost.
    live: isize,
    allocations: usize,
}

fn heap_since(start: HeapMark) -> HeapDelta {
    let end = heap_mark();
    HeapDelta {
        churn: end.allocated - start.allocated,
        live: (end.allocated - start.allocated) as isize - (end.freed - start.freed) as isize,
        allocations: end.allocations - start.allocations,
    }
}

// ── Interners ────────────────────────────────────────────────────────
//
// Production would thread these through `DeserializeSeed` so the tables are
// owned by the renderer. A thread-local keeps the bench readable and costs a
// `RefCell` borrow per property, which makes the compact numbers slightly
// pessimistic rather than flattering.

#[derive(Default)]
struct Interner {
    ids: HashMap<Box<str>, u32>,
    values: Vec<Box<str>>,
}

impl Interner {
    fn intern(&mut self, value: &str) -> u32 {
        if let Some(id) = self.ids.get(value) {
            return *id;
        }
        let id = self.values.len() as u32;
        let owned: Box<str> = value.into();
        self.ids.insert(owned.clone(), id);
        self.values.push(owned);
        id
    }

    fn heap_bytes(&self) -> usize {
        // Each entry is stored twice: once as the map key, once in the table.
        let strings: usize = self.values.iter().map(|v| v.len() * 2).sum();
        strings
            + self.values.capacity() * std::mem::size_of::<Box<str>>()
            + self.ids.capacity() * (std::mem::size_of::<Box<str>>() + std::mem::size_of::<u32>())
    }
}

thread_local! {
    static KEYS: RefCell<Interner> = RefCell::new(Interner::default());
    static STRINGS: RefCell<Interner> = RefCell::new(Interner::default());
    static NESTED: RefCell<Vec<CompactStyle>> = const { RefCell::new(Vec::new()) };
}

fn reset_interners() {
    KEYS.with(|k| *k.borrow_mut() = Interner::default());
    STRINGS.with(|s| *s.borrow_mut() = Interner::default());
    NESTED.with(|n| n.borrow_mut().clear());
}

fn interner_bytes() -> usize {
    KEYS.with(|k| k.borrow().heap_bytes())
        + STRINGS.with(|s| s.borrow().heap_bytes())
        + NESTED.with(|n| {
            n.borrow()
                .iter()
                .map(|style| style.heap_bytes())
                .sum::<usize>()
        })
}

// ── Compact style ────────────────────────────────────────────────────
//
// The data-oriented replacement for `StyleDesc`. A style is a sorted list of
// 8-byte properties instead of ~80 `Option` fields, because a real element sets
// six of them. Three facts make 8 bytes enough:
//
//   * GPUI consumes `Pixels(f32)`, so storing `f64` buys nothing
//   * a colour is 4 bytes once parsed, not a 24-byte `String` plus a heap block
//   * `display`, `position`, `alignItems` and friends are keyword enums
//
// `kind` records which of those a slot holds.

const KIND_F32: u8 = 0;
const KIND_COLOR: u8 = 1;
const KIND_KEYWORD: u8 = 2;
const KIND_BOOL: u8 = 3;
const KIND_NESTED: u8 = 4;
const KIND_PERCENT: u8 = 5;
const KIND_AUTO: u8 = 6;

#[repr(C)]
#[derive(Clone, Copy, PartialEq)]
struct StyleProp {
    key: u16,
    kind: u8,
    _pad: u8,
    bits: u32,
}

#[derive(Clone, PartialEq, Default)]
struct CompactStyle {
    props: Box<[StyleProp]>,
}

impl CompactStyle {
    fn heap_bytes(&self) -> usize {
        self.props.len() * std::mem::size_of::<StyleProp>()
    }

    /// Sorted props with a stable key order make two equal styles compare and
    /// hash identically, which is what lets the tree store one `StyleId`.
    fn dedup_key(&self) -> Vec<u64> {
        self.props
            .iter()
            .map(|p| {
                (p.key as u64) << 48 | (p.kind as u64) << 40 | p.bits as u64
            })
            .collect()
    }
}

/// One JSON/msgpack value in style position, collapsed to 4 payload bytes.
struct PropValue {
    kind: u8,
    bits: u32,
}

impl<'de> Deserialize<'de> for PropValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;

        impl<'de> Visitor<'de> for V {
            type Value = PropValue;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a style property value")
            }

            fn visit_f64<E: de::Error>(self, v: f64) -> Result<PropValue, E> {
                Ok(PropValue { kind: KIND_F32, bits: (v as f32).to_bits() })
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<PropValue, E> {
                self.visit_f64(v as f64)
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<PropValue, E> {
                self.visit_f64(v as f64)
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<PropValue, E> {
                Ok(PropValue { kind: KIND_BOOL, bits: v as u32 })
            }
            fn visit_unit<E: de::Error>(self) -> Result<PropValue, E> {
                Ok(PropValue { kind: KIND_KEYWORD, bits: u32::MAX })
            }
            fn visit_none<E: de::Error>(self) -> Result<PropValue, E> {
                self.visit_unit()
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<PropValue, E> {
                if v == "auto" {
                    return Ok(PropValue { kind: KIND_AUTO, bits: 0 });
                }
                if let Some(percent) = v.strip_suffix('%') {
                    if let Ok(number) = percent.parse::<f32>() {
                        return Ok(PropValue {
                            kind: KIND_PERCENT,
                            bits: (number / 100.0).to_bits(),
                        });
                    }
                }
                // A colour costs 4 bytes here and 24 bytes plus a heap block in
                // `StyleDesc`. Parsing at ingest also removes the per-frame
                // `parse_color` call that paint does today.
                if let Some(rgba) = parse_color_hex(v) {
                    return Ok(PropValue { kind: KIND_COLOR, bits: rgba });
                }
                let id = STRINGS.with(|s| s.borrow_mut().intern(v));
                Ok(PropValue { kind: KIND_KEYWORD, bits: id })
            }

            /// `hover`, `active` and `boxShadow` are nested objects. They land in
            /// a side arena and the parent keeps a 4-byte id.
            fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<PropValue, A::Error> {
                let nested = CompactStyleVisitor.visit_map(map)?;
                let id = NESTED.with(|arena| {
                    let mut arena = arena.borrow_mut();
                    arena.push(nested);
                    (arena.len() - 1) as u32
                });
                Ok(PropValue { kind: KIND_NESTED, bits: id })
            }
        }

        deserializer.deserialize_any(V)
    }
}

struct CompactStyleVisitor;

impl<'de> Visitor<'de> for CompactStyleVisitor {
    type Value = CompactStyle;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a style object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<CompactStyle, A::Error> {
        let mut props: Vec<StyleProp> = Vec::with_capacity(8);
        // A style key is a JS identifier, so it can never carry a JSON escape
        // and always borrows. Reading it as `&'de str` keeps it out of the
        // borrow counters, which are there to describe value strings.
        while let Some(key) = map.next_key::<&str>()? {
            let id = KEYS.with(|k| k.borrow_mut().intern(key)) as u16;
            let value: PropValue = map.next_value()?;
            props.push(StyleProp { key: id, kind: value.kind, _pad: 0, bits: value.bits });
        }
        props.sort_unstable_by_key(|p| p.key);
        Ok(CompactStyle { props: props.into_boxed_slice() })
    }
}

impl<'de> Deserialize<'de> for CompactStyle {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(CompactStyleVisitor)
    }
}

// ── Borrow-or-copy string ────────────────────────────────────────────
//
// This is the one place where the codec choice is not cosmetic.
//
// A MessagePack string is length-prefixed and never escaped, so a decoder can
// always hand back a slice of the input buffer. JSON cannot: the moment a value
// contains `\n` or `\"`, serde_json must unescape it into a fresh `String`.
// Chat text, markdown sources and diff patches are full of newlines, so the
// JSON path pays a copy for exactly the largest strings in the batch.
//
// `BORROWED` and `COPIED` count that split so the report shows it instead of
// asserting it.

static BORROWED: AtomicUsize = AtomicUsize::new(0);
static COPIED: AtomicUsize = AtomicUsize::new(0);
static COPIED_BYTES: AtomicUsize = AtomicUsize::new(0);

struct Str<'a>(std::borrow::Cow<'a, str>);

impl<'a> Str<'a> {
    fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Str<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;

        impl<'de> Visitor<'de> for V {
            type Value = Str<'de>;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a string")
            }

            fn visit_borrowed_str<E: de::Error>(self, v: &'de str) -> Result<Str<'de>, E> {
                BORROWED.fetch_add(1, Ordering::Relaxed);
                Ok(Str(std::borrow::Cow::Borrowed(v)))
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<Str<'de>, E> {
                COPIED.fetch_add(1, Ordering::Relaxed);
                COPIED_BYTES.fetch_add(v.len(), Ordering::Relaxed);
                Ok(Str(std::borrow::Cow::Owned(v.to_owned())))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<Str<'de>, E> {
                COPIED.fetch_add(1, Ordering::Relaxed);
                COPIED_BYTES.fetch_add(v.len(), Ordering::Relaxed);
                Ok(Str(std::borrow::Cow::Owned(v)))
            }
        }

        deserializer.deserialize_str(V)
    }
}

// ── Typed op stream ──────────────────────────────────────────────────
//
// The wire shape is a tuple: `["setStyle", 42, { … }]`. Deserializing it
// straight into this enum removes both intermediate `serde_json::Value` trees
// that `apply_batch` used to build.

#[allow(dead_code)]
enum Op<'a, S> {
    CreateElement { id: u64, kind: Str<'a> },
    DestroyElement { id: u64 },
    AppendChild { parent: u64, child: u64 },
    InsertBefore { parent: u64, child: u64, before: u64 },
    SetStyle { id: u64, style: S },
    SetText { id: u64, content: Str<'a> },
    SetEvent { id: u64, event: Str<'a>, has_handler: bool },
    SetRoot { id: u64 },
    SetCustomProp { id: u64, key: Str<'a>, value: serde_json::Value },
    DefineStyle { style_id: u32, style: S },
    SetStyleRef { id: u64, style_id: u32 },
    Strings,
    Unknown,
}

struct OpVisitor<S>(PhantomData<S>);

fn next<'de, A, T>(seq: &mut A) -> Result<T, A::Error>
where
    A: SeqAccess<'de>,
    T: Deserialize<'de>,
{
    seq.next_element()?
        .ok_or_else(|| de::Error::custom("batch op is missing an argument"))
}

impl<'de, S: Deserialize<'de>> Visitor<'de> for OpVisitor<S> {
    type Value = Op<'de, S>;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a [name, ...args] mutation tuple")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Op<'de, S>, A::Error> {
        let name: Str<'de> = next(&mut seq)?;
        let op = match name.as_str() {
            "createElement" => Op::CreateElement { id: next(&mut seq)?, kind: next(&mut seq)? },
            "destroyElement" => Op::DestroyElement { id: next(&mut seq)? },
            "appendChild" => Op::AppendChild { parent: next(&mut seq)?, child: next(&mut seq)? },
            "insertBefore" => Op::InsertBefore {
                parent: next(&mut seq)?,
                child: next(&mut seq)?,
                before: next(&mut seq)?,
            },
            "setStyle" => Op::SetStyle { id: next(&mut seq)?, style: next(&mut seq)? },
            "setText" => Op::SetText { id: next(&mut seq)?, content: next(&mut seq)? },
            "setEventListener" => Op::SetEvent {
                id: next(&mut seq)?,
                event: next(&mut seq)?,
                has_handler: next(&mut seq)?,
            },
            "setRoot" => Op::SetRoot { id: next(&mut seq)? },
            "setCustomProp" => Op::SetCustomProp {
                id: next(&mut seq)?,
                key: next(&mut seq)?,
                value: next(&mut seq)?,
            },
            "defineStyle" => Op::DefineStyle { style_id: next(&mut seq)?, style: next(&mut seq)? },
            "setStyleRef" => Op::SetStyleRef { id: next(&mut seq)?, style_id: next(&mut seq)? },
            "strings" => {
                let _table: Vec<Str<'de>> = next(&mut seq)?;
                Op::Strings
            }
            _ => Op::Unknown,
        };
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(op)
    }
}

impl<'de, S: Deserialize<'de>> Deserialize<'de> for Op<'de, S> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(OpVisitor(PhantomData))
    }
}

// ── Compact retained element ─────────────────────────────────────────
//
// `RetainedElement` used to be dominated by one field: `Option<StyleDesc>` was
// inline, so every element paid the full style size even when it had no style.
// It now holds an `Arc<StyleDesc>`; the row below measures the version this
// benchmark argued for.
// Add `String` element types, a `HashSet<String>` of event names and a
// `HashMap<String, Value>` of custom props and one node costs more than a
// kilobyte before it holds any content.
//
// Here the node is a fixed 48-byte record in a dense `Vec`, indexed by the id
// JS already allocates as a dense counter. Children are a sibling list, so
// there is no per-node `Vec` allocation. Everything variable-width moved to a
// side table that repeated values share.

#[repr(C)]
#[derive(Clone, Copy)]
struct CompactElement {
    parent: u32,
    first_child: u32,
    last_child: u32,
    next_sibling: u32,
    /// Index into the deduplicated style table. Equal styles share one entry.
    style: u32,
    content: u32,
    test_id: u32,
    custom_props: u32,
    subtree_revision: u32,
    /// One bit per event type. Replaces `HashSet<String>`.
    events: u32,
    /// `div`, `text`, `input`, … as a tag instead of a heap `String`.
    kind: u16,
    custom_len: u16,
}

const NONE: u32 = u32::MAX;

impl CompactElement {
    fn new(kind: u16) -> Self {
        Self {
            parent: NONE,
            first_child: NONE,
            last_child: NONE,
            next_sibling: NONE,
            style: NONE,
            content: NONE,
            test_id: NONE,
            custom_props: NONE,
            subtree_revision: 0,
            events: 0,
            kind,
            custom_len: 0,
        }
    }
}

#[derive(Default)]
struct CompactTree {
    elements: Vec<CompactElement>,
    styles: Vec<CompactStyle>,
    style_ids: HashMap<Vec<u64>, u32>,
    /// Text content, addressed by index. A `Box<str>` has no spare capacity,
    /// unlike the `String` a `RetainedElement` holds.
    contents: Vec<Box<str>>,
    custom_props: Vec<(u32, serde_json::Value)>,
    root: u32,
    revision: u32,
}

impl CompactTree {
    fn slot(&mut self, id: u64) -> &mut CompactElement {
        let index = id as usize;
        if index >= self.elements.len() {
            self.elements.resize(index + 1, CompactElement::new(u16::MAX));
        }
        &mut self.elements[index]
    }

    fn create(&mut self, id: u64, kind: &str) {
        let tag = KEYS.with(|k| k.borrow_mut().intern(kind)) as u16;
        let revision = self.revision;
        self.revision += 1;
        let slot = self.slot(id);
        *slot = CompactElement::new(tag);
        slot.subtree_revision = revision;
    }

    /// Detach `child` from its current parent. `RetainedTree` re-parents on
    /// append/insertBefore, so the replica must too.
    fn detach(&mut self, child: u32) {
        let parent = self.elements[child as usize].parent;
        if parent == NONE {
            return;
        }
        let mut cursor = self.elements[parent as usize].first_child;
        let mut previous = NONE;
        while cursor != NONE {
            if cursor == child {
                let next = self.elements[child as usize].next_sibling;
                if previous == NONE {
                    self.elements[parent as usize].first_child = next;
                } else {
                    self.elements[previous as usize].next_sibling = next;
                }
                if self.elements[parent as usize].last_child == child {
                    self.elements[parent as usize].last_child = previous;
                }
                break;
            }
            previous = cursor;
            cursor = self.elements[cursor as usize].next_sibling;
        }
        self.elements[child as usize].parent = NONE;
        self.elements[child as usize].next_sibling = NONE;
    }

    fn append(&mut self, parent: u64, child: u64) {
        let (parent, child) = (parent as u32, child as u32);
        self.detach(child);
        let previous_last = self.elements[parent as usize].last_child;
        if previous_last == NONE {
            self.elements[parent as usize].first_child = child;
        } else {
            self.elements[previous_last as usize].next_sibling = child;
        }
        self.elements[parent as usize].last_child = child;
        self.elements[child as usize].parent = parent;
    }

    /// The Vue host emits this for anchored inserts; upstream's React fixture
    /// never did, so the replica originally skipped it and `verify` failed.
    fn insert_before(&mut self, parent: u64, child: u64, before: u64) {
        let (parent, child, before) = (parent as u32, child as u32, before as u32);
        self.detach(child);
        if self.elements[parent as usize].first_child == before {
            self.elements[child as usize].next_sibling = before;
            self.elements[parent as usize].first_child = child;
            self.elements[child as usize].parent = parent;
            return;
        }
        let mut cursor = self.elements[parent as usize].first_child;
        while cursor != NONE && self.elements[cursor as usize].next_sibling != before {
            cursor = self.elements[cursor as usize].next_sibling;
        }
        if cursor == NONE {
            // Anchor not found: append, the least surprising fallback.
            self.append(parent as u64, child as u64);
            return;
        }
        self.elements[cursor as usize].next_sibling = child;
        self.elements[child as usize].next_sibling = before;
        self.elements[child as usize].parent = parent;
    }

    fn set_style(&mut self, id: u64, style: CompactStyle) {
        let key = style.dedup_key();
        let style_id = match self.style_ids.get(&key) {
            Some(existing) => *existing,
            None => {
                let new_id = self.styles.len() as u32;
                self.styles.push(style);
                self.style_ids.insert(key, new_id);
                new_id
            }
        };
        self.slot(id).style = style_id;
    }

    fn heap_bytes(&self) -> usize {
        self.elements.capacity() * std::mem::size_of::<CompactElement>()
            + self.styles.iter().map(|s| s.heap_bytes()).sum::<usize>()
            + self.styles.capacity() * std::mem::size_of::<CompactStyle>()
    }

    fn children(&self, id: u32) -> Vec<u32> {
        let mut out = Vec::new();
        let mut cursor = self.elements[id as usize].first_child;
        while cursor != NONE {
            out.push(cursor);
            cursor = self.elements[cursor as usize].next_sibling;
        }
        out
    }
}

/// The memory numbers only mean something if both trees hold the same tree.
/// This walks every element and compares parent, child order and styled-ness.
/// A silent drop in `build_compact_tree` would otherwise read as a saving.
fn verify(fat: &RetainedTree, compact: &CompactTree) {
    let mut checked = 0usize;
    for (id, element) in &fat.elements {
        let index = *id as usize;
        assert!(index < compact.elements.len(), "compact tree is missing {id}");
        let slot = &compact.elements[index];
        assert_ne!(slot.kind, u16::MAX, "element {id} was never created");
        assert_eq!(
            element.children,
            compact
                .children(*id as u32)
                .into_iter()
                .map(u64::from)
                .collect::<Vec<_>>(),
            "child order differs for element {id}",
        );
        assert_eq!(
            element.parent.map(|p| p as u32).unwrap_or(NONE),
            slot.parent,
            "parent differs for element {id}",
        );
        assert_eq!(
            element.style.is_some(),
            slot.style != NONE,
            "styled-ness differs for element {id}",
        );
        assert_eq!(
            element.content.is_some(),
            slot.content != NONE,
            "content presence differs for element {id}",
        );
        checked += 1;
    }
    assert_eq!(checked, compact.elements.iter().filter(|e| e.kind != u16::MAX).count());
    println!("verified {checked} elements match between both trees\n");
}

// ── Benchmark bodies ─────────────────────────────────────────────────

/// The path `renderer.rs` used before the typed decode: a `Vec<Value>` tree,
/// then a deep clone of each style payload, then a second parse into `StyleDesc`.
fn decode_old_path(json: &str) -> usize {
    let ops: Vec<serde_json::Value> = serde_json::from_str(json).expect("parse batch");
    for op in &ops {
        let Some(array) = op.as_array() else { continue };
        if array.first().and_then(|v| v.as_str()) != Some("setStyle") {
            continue;
        }
        let payload = array[2].clone();
        let style: StyleDesc = serde_json::from_value(payload).expect("style");
        std::hint::black_box(&style);
    }
    ops.len()
}

/// Same `Vec<Value>` tree, but the style is read straight out of it. This
/// isolates the cost of `batch_payload`'s `value.clone()` alone.
fn decode_no_clone(json: &str) -> usize {
    let ops: Vec<serde_json::Value> = serde_json::from_str(json).expect("parse batch");
    for op in &ops {
        let Some(array) = op.as_array() else { continue };
        if array.first().and_then(|v| v.as_str()) != Some("setStyle") {
            continue;
        }
        let _style = StyleDesc::deserialize(&array[2]).expect("style");
    }
    ops.len()
}

fn decode_typed_json<S>(bytes: &[u8]) -> usize
where
    S: for<'a> Deserialize<'a>,
{
    let ops: Vec<Op<S>> = serde_json::from_slice(bytes).expect("typed batch");
    ops.len()
}

fn decode_typed_msgpack<S>(bytes: &[u8]) -> usize
where
    S: for<'a> Deserialize<'a>,
{
    let ops: Vec<Op<S>> = rmp_serde::from_slice(bytes).expect("typed msgpack batch");
    ops.len()
}

// ── Tree construction ────────────────────────────────────────────────

/// The real production path: `parse_batch_ops` then the apply loop.
///
/// This calls `apply_batch_to_tree` itself rather than replaying the ops by
/// hand, so the numbers describe shipped code. An earlier version of this bench
/// used a hand-written replica and hid the fact that `BatchOp` inlined a
/// 1.4 KB `StyleDesc`, which made the real `Vec<BatchOp>` reserve 300 MB.
fn build_fat_tree(bytes: &[u8]) -> RetainedTree {
    let mut tree = RetainedTree::new();
    gpuiv_native::apply_batch_to_tree(&mut tree, bytes).expect("apply batch");
    tree
}

/// `RetainedElement` with one field changed: the style moved behind a pointer.
///
/// This is the cheapest possible step. Everything that reads
/// `Option<&StyleDesc>` keeps working through `Deref`, so `apply_styles` and
/// every custom element stay untouched. With `P = Arc<StyleDesc>` the 90
/// distinct styles are also shared, so 59 320 `setStyle` ops cost 90
/// allocations instead of 59 320.
struct PointerStyleElement<P> {
    id: u64,
    element_type: String,
    style: Option<P>,
    content: Option<String>,
    events: HashSet<String>,
    children: Vec<u64>,
    parent: Option<u64>,
    custom_props: HashMap<String, serde_json::Value>,
    auto_focus: bool,
    subtree_revision: u64,
    test_id: Option<String>,
}

impl<P> PointerStyleElement<P> {
    fn new(id: u64, element_type: String, revision: u64) -> Self {
        Self {
            id,
            element_type,
            style: None,
            content: None,
            events: HashSet::new(),
            children: Vec::new(),
            parent: None,
            custom_props: HashMap::new(),
            auto_focus: false,
            subtree_revision: revision,
            test_id: None,
        }
    }
}

/// Replays the batch into a tree whose style sits behind `P`.
///
/// `share` decides whether two equal styles get one allocation or two. The
/// dedup key is the JSON text of the payload, which is free here because the
/// parser already produced it. Production would hash the raw payload bytes
/// before parsing and skip the second parse entirely.
fn build_pointer_style_tree<P: Clone + From<StyleDesc>>(
    json: &str,
    share: bool,
) -> HashMap<u64, PointerStyleElement<P>> {
    let ops: Vec<serde_json::Value> = serde_json::from_str(json).expect("parse batch");
    let mut tree: HashMap<u64, PointerStyleElement<P>> = HashMap::new();
    let mut shared: HashMap<String, P> = HashMap::new();
    let mut revision = 0u64;
    for op in &ops {
        let Some(array) = op.as_array() else { continue };
        let Some(name) = array.first().and_then(|v| v.as_str()) else { continue };
        let id = |index: usize| array.get(index).and_then(|v| v.as_u64()).unwrap_or(0);
        match name {
            "createElement" => {
                revision += 1;
                tree.insert(
                    id(1),
                    PointerStyleElement::new(
                        id(1),
                        array[2].as_str().unwrap_or_default().to_owned(),
                        revision,
                    ),
                );
            }
            "appendChild" => {
                // RetainedTree re-parents: detach from any old parent first.
                let old_parent = tree.get(&id(2)).and_then(|child| child.parent);
                if let Some(old_parent) = old_parent {
                    if let Some(parent) = tree.get_mut(&old_parent) {
                        parent.children.retain(|child| *child != id(2));
                    }
                }
                if let Some(parent) = tree.get_mut(&id(1)) {
                    parent.children.push(id(2));
                }
                if let Some(child) = tree.get_mut(&id(2)) {
                    child.parent = Some(id(1));
                }
            }
            // The Vue host emits anchored inserts; upstream's React fixture
            // never did, so this arm is new with the Vue port.
            "insertBefore" => {
                let old_parent = tree.get(&id(2)).and_then(|child| child.parent);
                if let Some(old_parent) = old_parent {
                    if let Some(parent) = tree.get_mut(&old_parent) {
                        parent.children.retain(|child| *child != id(2));
                    }
                }
                if let Some(parent) = tree.get_mut(&id(1)) {
                    let position = parent
                        .children
                        .iter()
                        .position(|child| *child == id(3))
                        .unwrap_or(parent.children.len());
                    parent.children.insert(position, id(2));
                }
                if let Some(child) = tree.get_mut(&id(2)) {
                    child.parent = Some(id(1));
                }
            }
            "setStyle" => {
                let pointer = if share {
                    let key = array[2].to_string();
                    match shared.get(&key) {
                        Some(existing) => existing.clone(),
                        None => {
                            let style: StyleDesc =
                                serde_json::from_value(array[2].clone()).expect("style");
                            let pointer = P::from(style);
                            shared.insert(key, pointer.clone());
                            pointer
                        }
                    }
                } else {
                    P::from(serde_json::from_value(array[2].clone()).expect("style"))
                };
                if let Some(element) = tree.get_mut(&id(1)) {
                    element.style = Some(pointer);
                }
            }
            "setText" => {
                if let Some(element) = tree.get_mut(&id(1)) {
                    element.content = Some(array[2].as_str().unwrap_or_default().to_owned());
                }
            }
            "setEventListener" => {
                if let Some(element) = tree.get_mut(&id(1)) {
                    element.events.insert(array[2].as_str().unwrap_or_default().to_owned());
                }
            }
            "setCustomProp" => {
                if let Some(element) = tree.get_mut(&id(1)) {
                    element.custom_props.insert(
                        array[2].as_str().unwrap_or_default().to_owned(),
                        array.get(3).cloned().unwrap_or(serde_json::Value::Null),
                    );
                }
            }
            _ => {}
        }
    }
    tree
}

fn build_compact_tree(bytes: &[u8]) -> CompactTree {
    let ops: Vec<Op<CompactStyle>> = serde_json::from_slice(bytes).expect("typed batch");
    let mut tree = CompactTree::default();
    for op in ops {
        match op {
            Op::CreateElement { id, kind } => tree.create(id, kind.as_str()),
            Op::AppendChild { parent, child } => tree.append(parent, child),
            Op::InsertBefore {
                parent,
                child,
                before,
            } => tree.insert_before(parent, child, before),
            Op::SetStyle { id, style } => tree.set_style(id, style),
            Op::SetText { id, content } => {
                tree.contents.push(content.as_str().into());
                let index = (tree.contents.len() - 1) as u32;
                tree.slot(id).content = index;
            }
            Op::SetEvent { id, event, has_handler } => {
                let bit = KEYS.with(|k| k.borrow_mut().intern(event.as_str())) % 32;
                let slot = tree.slot(id);
                if has_handler {
                    slot.events |= 1 << bit;
                } else {
                    slot.events &= !(1 << bit);
                }
            }
            Op::SetCustomProp { id, key, value } => {
                let key_id = KEYS.with(|k| k.borrow_mut().intern(key.as_str()));
                tree.custom_props.push((key_id, value));
                let index = (tree.custom_props.len() - 1) as u32;
                let slot = tree.slot(id);
                if slot.custom_props == NONE {
                    slot.custom_props = index;
                }
                slot.custom_len += 1;
            }
            Op::SetRoot { id } => tree.root = id as u32,
            _ => {}
        }
    }
    tree
}

// ── Reporting ────────────────────────────────────────────────────────

struct Measurement {
    name: String,
    ms: f64,
    churn_mb: f64,
    allocations: usize,
    /// Strings that came straight out of the input buffer, and the ones the
    /// codec had to unescape into a fresh allocation.
    borrowed: usize,
    copied: usize,
    copied_kb: f64,
}

fn time<T>(name: &str, iterations: usize, mut run: impl FnMut() -> T) -> Measurement {
    run();
    BORROWED.store(0, Ordering::Relaxed);
    COPIED.store(0, Ordering::Relaxed);
    COPIED_BYTES.store(0, Ordering::Relaxed);

    let mut samples = Vec::with_capacity(iterations);
    let start_heap = heap_mark();
    for _ in 0..iterations {
        let start = Instant::now();
        let value = run();
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        drop(value);
    }
    let heap = heap_since(start_heap);
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());

    Measurement {
        name: name.to_owned(),
        ms: samples[samples.len() / 2],
        churn_mb: heap.churn as f64 / iterations as f64 / 1e6,
        allocations: heap.allocations / iterations,
        borrowed: BORROWED.load(Ordering::Relaxed) / iterations,
        copied: COPIED.load(Ordering::Relaxed) / iterations,
        copied_kb: COPIED_BYTES.load(Ordering::Relaxed) as f64 / iterations as f64 / 1e3,
    }
}

fn print_results(rows: &[Measurement], baseline_ms: f64) {
    println!(
        "| decode path | median | vs shipped | heap churn | allocations | strings borrowed | unescaped |"
    );
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for row in rows {
        let strings = if row.borrowed + row.copied == 0 {
            "— (every string owned)".to_owned()
        } else {
            format!("{} of {}", row.borrowed, row.borrowed + row.copied)
        };
        let copied = if row.borrowed + row.copied == 0 {
            "—".to_owned()
        } else {
            format!("{} · {:.0} KB", row.copied, row.copied_kb)
        };
        println!(
            "| {} | {:.1} ms | {:.2}x | {:.1} MB | {} | {} | {} |",
            row.name,
            row.ms,
            baseline_ms / row.ms,
            row.churn_mb,
            row.allocations,
            strings,
            copied,
        );
    }
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../tmp/batch-fixture.json").to_owned()
    });
    let interned_path = path.replace("batch-fixture.json", "batch-fixture-interned.json");

    let json = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("cannot read {path}: {error}\nrun `bun bench-serialization.ts` in examples/ first")
    });
    let interned_json = std::fs::read_to_string(&interned_path).unwrap_or_default();

    let ops_value: Vec<serde_json::Value> = serde_json::from_str(&json).expect("fixture");
    let op_count = ops_value.len();
    let msgpack = rmp_serde::to_vec(&ops_value).expect("msgpack encode");
    let interned_msgpack = if interned_json.is_empty() {
        Vec::new()
    } else {
        let value: Vec<serde_json::Value> =
            serde_json::from_str(&interned_json).expect("interned fixture");
        rmp_serde::to_vec(&value).expect("msgpack encode")
    };
    drop(ops_value);

    let iterations: usize = std::env::var("ITERATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    println!("# applyBatch decode — Rust side\n");
    println!("fixture: {path}");
    println!(
        "{op_count} ops · JSON {:.2} MB · msgpack {:.2} MB · interned msgpack {:.2} MB · {iterations} iterations\n",
        json.len() as f64 / 1e6,
        msgpack.len() as f64 / 1e6,
        interned_msgpack.len() as f64 / 1e6,
    );

    println!("## Struct sizes\n");
    println!("| type | size_of | note |");
    println!("|---|---:|---|");
    println!(
        "| `StyleDesc` | {} B | ~80 `Option` fields, all inline |",
        std::mem::size_of::<StyleDesc>()
    );
    println!(
        "| `CompactStyle` | {} B + {} B per prop | sorted property list |",
        std::mem::size_of::<CompactStyle>(),
        std::mem::size_of::<StyleProp>()
    );
    println!(
        "| `RetainedElement` | {} B | shipped: the style is one `Arc`, so an unstyled node pays 8 B |",
        std::mem::size_of::<gpuiv_native::retained_tree::RetainedElement>()
    );
    println!(
        "| bench replica + `Arc<StyleDesc>` | {} B | the same shape, measured standalone |",
        std::mem::size_of::<PointerStyleElement<std::sync::Arc<StyleDesc>>>()
    );
    println!(
        "| `CompactElement` | {} B | dense `Vec`, sibling list, no per-node allocation |",
        std::mem::size_of::<CompactElement>()
    );
    // A `Vec<Op<S>>` is as wide as its widest variant. Inlining `StyleDesc`
    // makes every op in the batch pay for the one that carries a style, which
    // is why "typed JSON ► StyleDesc" churns more than the `Value` tree it
    // replaces.
    println!(
        "| `Op<StyleDesc>` | {} B | every op in the `Vec` pays this |",
        std::mem::size_of::<Op<StyleDesc>>()
    );
    println!(
        "| `Op<Box<StyleDesc>>` | {} B | same fields, narrow enum |",
        std::mem::size_of::<Op<Box<StyleDesc>>>()
    );
    println!(
        "| `Op<CompactStyle>` | {} B | style is a 16-byte handle |",
        std::mem::size_of::<Op<CompactStyle>>()
    );
    println!();

    println!("## Decode\n");
    reset_interners();
    let mut rows = vec![
        // The shipped path, end to end, minus only the napi String copy:
        // `serde_json` to `Vec<Value>`, then `parse_batch_ops`, then the apply
        // loop. Everything below it is a proposal; this row is production.
        time("REAL apply_batch_to_tree (parse + apply)", iterations, || {
            let mut tree = RetainedTree::new();
            gpuiv_native::apply_batch_to_tree(&mut tree, json.as_bytes()).expect("apply");
            tree.elements.len()
        }),
        time("the old path — Vec<Value> + clone + from_value", iterations, || {
            decode_old_path(&json)
        }),
        time("Vec<Value>, no clone", iterations, || decode_no_clone(&json)),
        time("typed JSON ► StyleDesc", iterations, || {
            decode_typed_json::<StyleDesc>(json.as_bytes())
        }),
        time("typed JSON ► CompactStyle", iterations, || {
            decode_typed_json::<CompactStyle>(json.as_bytes())
        }),
        time("typed msgpack ► CompactStyle", iterations, || {
            decode_typed_msgpack::<CompactStyle>(&msgpack)
        }),
    ];
    if !interned_json.is_empty() {
        // The cheap path: keep every named `StyleDesc` field, move it behind a
        // pointer so the enum stays narrow, and let the interned protocol mean
        // only 90 of the 221 764 ops actually parse a style.
        rows.push(time(
            "typed JSON ► Box<StyleDesc>, interned styles",
            iterations,
            || decode_typed_json::<Box<StyleDesc>>(interned_json.as_bytes()),
        ));
        rows.push(time(
            "typed JSON ► CompactStyle, interned styles",
            iterations,
            || decode_typed_json::<CompactStyle>(interned_json.as_bytes()),
        ));
    }
    if !interned_msgpack.is_empty() {
        rows.push(time(
            "typed msgpack ► CompactStyle, interned styles",
            iterations,
            || decode_typed_msgpack::<CompactStyle>(&interned_msgpack),
        ));
    }
    let baseline = rows[0].ms;
    print_results(&rows, baseline);
    println!();

    println!("## Retained tree memory\n");
    reset_interners();
    let fat_start = heap_mark();
    let fat = build_fat_tree(json.as_bytes());
    let fat_heap = heap_since(fat_start);
    let fat_elements = fat.elements.len();

    let boxed_start = heap_mark();
    let boxed = build_pointer_style_tree::<Box<StyleDesc>>(&json, false);
    let boxed_heap = heap_since(boxed_start);
    let boxed_elements = boxed.len();
    drop(boxed);

    let shared_start = heap_mark();
    let shared = build_pointer_style_tree::<std::sync::Arc<StyleDesc>>(&json, true);
    let shared_heap = heap_since(shared_start);
    let shared_elements = shared.len();
    drop(shared);

    reset_interners();
    let compact_start = heap_mark();
    let compact = build_compact_tree(json.as_bytes());
    let compact_heap = heap_since(compact_start);
    verify(&fat, &compact);
    drop(fat);
    let compact_elements = compact.elements.iter().filter(|e| e.kind != u16::MAX).count();
    let unique_styles = compact.styles.len();
    let structural = compact.heap_bytes();
    let tables = interner_bytes();

    println!("| tree | elements | live heap | per element | note |");
    println!("|---|---:|---:|---:|---|");
    println!(
        "| `RetainedTree` (shipped) | {} | {:.1} MB | {} B | `FxHashMap<u64, RetainedElement>` |",
        fat_elements,
        fat_heap.live as f64 / 1e6,
        fat_heap.live as usize / fat_elements.max(1),
    );
    println!(
        "| + `Box<StyleDesc>` | {} | {:.1} MB | {} B | one field, no sharing |",
        boxed_elements,
        boxed_heap.live as f64 / 1e6,
        boxed_heap.live.max(0) as usize / boxed_elements.max(1),
    );
    println!(
        "| + `Arc<StyleDesc>`, deduplicated | {} | {:.1} MB | {} B | one field plus an intern table |",
        shared_elements,
        shared_heap.live as f64 / 1e6,
        shared_heap.live.max(0) as usize / shared_elements.max(1),
    );
    println!(
        "| `CompactTree` | {} | {:.1} MB | {} B | {} unique styles, {:.2} MB structural, {:.2} MB tables |",
        compact_elements,
        compact_heap.live as f64 / 1e6,
        compact_heap.live.max(0) as usize / compact_elements.max(1),
        unique_styles,
        structural as f64 / 1e6,
        tables as f64 / 1e6,
    );
    println!();
    println!(
        "reduction: {:.1}x live heap, {:.1}x allocations ({} ► {})",
        fat_heap.live as f64 / compact_heap.live.max(1) as f64,
        fat_heap.allocations as f64 / compact_heap.allocations.max(1) as f64,
        fat_heap.allocations,
        compact_heap.allocations,
    );

    // Keep the compact tree alive so its heap is not freed before the report.
    std::hint::black_box(&compact);
}
