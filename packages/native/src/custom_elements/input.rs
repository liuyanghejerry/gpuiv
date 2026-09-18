//! Native single-line and multiline text editors with platform IME support.
//!
//! The editor follows GPUI's input example:
//! https://github.com/zed-industries/zed/blob/main/crates/gpui/examples/input.rs
//! Caret blinking, double-click, drag autoscroll, and bounded undo follow
//! Comet's composer (MIT). Use Comet only as a generic editor behavior
//! reference; its composer contains app-specific code.
//! Upstream: https://github.com/zeronsh/comet/blob/main/crates/ui/src/composer.rs
//! Reviewed at: https://github.com/zeronsh/comet/blob/b3fa51872f70c8f973c241b659cf0c166766f4f5/crates/ui/src/composer.rs

use std::collections::VecDeque;
use std::ops::Range;
use std::time::{Duration, Instant};

use gpui::{
    actions, div, fill, point, prelude::*, px, relative, size, App, Bounds, ClipboardItem,
    Context, CursorStyle, DispatchPhase, ElementInputHandler, Entity, EntityInputHandler,
    Font, FocusHandle, FontStyle, FontWeight, GlobalElementId, KeyBinding, LayoutId, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, ScrollWheelEvent,
    SharedString, StrikethroughStyle, Style, Task, TextRun, TextStyle, UTF16Selection,
    UnderlineStyle, Window, WrappedLine,
};
use unicode_segmentation::UnicodeSegmentation;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};
use crate::renderer::{emit_event_full, EventCallback};
use crate::theme::Theme;

actions!(
    gpuix_text_editor,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectAll,
        Home,
        End,
        DocStart,
        DocEnd,
        SelectHome,
        SelectEnd,
        SelectDocStart,
        SelectDocEnd,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        DeleteWordLeft,
        DeleteWordRight,
        DeleteToLineStart,
        DeleteToLineEnd,
        Copy,
        Cut,
        Paste,
        Undo,
        Redo,
        Newline,
        Submit,
    ]
);

const INPUT_KEY_CONTEXT: &str = "GpuixInput";
const TEXTAREA_KEY_CONTEXT: &str = "GpuixTextarea";
const TEXTAREA_SUBMIT_KEY_CONTEXT: &str = "GpuixTextareaSubmit";
const CARET_BLINK_MS: u64 = 500;
const CARET_WIDTH: Pixels = px(2.0);
const CARET_HEIGHT_RATIO: f32 = 0.75;
const DRAG_SCROLL_FRAME_MS: u64 = 16;
const UNDO_COALESCE: Duration = Duration::from_millis(700);
const UNDO_LIMIT: usize = 200;

fn caret_visible(ms_since_activity: u64) -> bool {
    (ms_since_activity / CARET_BLINK_MS) % 2 == 0
}

// Size the bar to cap height, not the line box. Default leading is phi, so a
// full-height caret sticks out above and below the glyphs. Cap height is about
// 0.75em; the em square itself still looks taller than the letters.
fn caret_rect(origin: Point<Pixels>, line_height: Pixels, font_size: Pixels) -> Bounds<Pixels> {
    let height = (font_size * CARET_HEIGHT_RATIO).min(line_height);
    let y_offset = (line_height - height) / 2.;
    Bounds::new(
        point(origin.x, origin.y + y_offset),
        size(CARET_WIDTH, height),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PressIntent {
    SelectAll,
    SelectWord,
    ExtendSelection,
    PlaceCaret,
}

impl PressIntent {
    fn arms_drag(self) -> bool {
        matches!(self, Self::ExtendSelection | Self::PlaceCaret)
    }
}

fn press_intent(click_count: usize, shift: bool) -> PressIntent {
    match click_count {
        n if n >= 3 => PressIntent::SelectAll,
        2 => PressIntent::SelectWord,
        _ if shift => PressIntent::ExtendSelection,
        _ => PressIntent::PlaceCaret,
    }
}

fn drag_scroll_delta(
    pointer_y: f32,
    viewport_top: f32,
    viewport_bottom: f32,
    line_height: f32,
) -> f32 {
    let distance = if pointer_y < viewport_top {
        pointer_y - viewport_top
    } else if pointer_y > viewport_bottom {
        pointer_y - viewport_bottom
    } else {
        return 0.0;
    };
    distance.signum() * (distance.abs() * 0.2).clamp(1.0, line_height)
}

fn utf16_offset_to_utf8(text: &str, offset: usize) -> usize {
    let mut utf8_offset = 0;
    let mut utf16_count = 0;
    for character in text.chars() {
        if utf16_count >= offset {
            break;
        }
        utf16_count += character.len_utf16();
        utf8_offset += character.len_utf8();
    }
    utf8_offset
}

fn single_line_text(text: &str) -> String {
    text.replace("\r\n", " ").replace(['\r', '\n'], " ")
}

pub fn init(cx: &mut App) {
    let mut bindings = text_editor_bindings(INPUT_KEY_CONTEXT, false, true);
    bindings.extend(text_editor_bindings(TEXTAREA_KEY_CONTEXT, true, false));
    bindings.extend(text_editor_bindings(
        TEXTAREA_SUBMIT_KEY_CONTEXT,
        true,
        true,
    ));
    cx.bind_keys(bindings);
}

fn text_editor_bindings(
    context: &'static str,
    multiline: bool,
    enter_submits: bool,
) -> Vec<KeyBinding> {
    let context = Some(context);
    let mut bindings = vec![
        if enter_submits {
            KeyBinding::new("enter", Submit, context)
        } else {
            KeyBinding::new("enter", Newline, context)
        },
        KeyBinding::new("shift-enter", Newline, context),
        KeyBinding::new("backspace", Backspace, context),
        KeyBinding::new("delete", Delete, context),
        KeyBinding::new("left", Left, context),
        KeyBinding::new("right", Right, context),
        KeyBinding::new("shift-left", SelectLeft, context),
        KeyBinding::new("shift-right", SelectRight, context),
        KeyBinding::new("home", Home, context),
        KeyBinding::new("end", End, context),
        KeyBinding::new("shift-home", SelectHome, context),
        KeyBinding::new("shift-end", SelectEnd, context),
        KeyBinding::new("cmd-left", Home, context),
        KeyBinding::new("cmd-right", End, context),
        KeyBinding::new("cmd-backspace", DeleteToLineStart, context),
        KeyBinding::new("cmd-delete", DeleteToLineEnd, context),
        KeyBinding::new("cmd-up", DocStart, context),
        KeyBinding::new("cmd-down", DocEnd, context),
        KeyBinding::new("shift-cmd-left", SelectHome, context),
        KeyBinding::new("shift-cmd-right", SelectEnd, context),
        KeyBinding::new("shift-cmd-up", SelectDocStart, context),
        KeyBinding::new("shift-cmd-down", SelectDocEnd, context),
    ];
    if multiline {
        bindings.extend([
            KeyBinding::new("up", Up, context),
            KeyBinding::new("down", Down, context),
            KeyBinding::new("shift-up", SelectUp, context),
            KeyBinding::new("shift-down", SelectDown, context),
        ]);
    }

    let word_prefix = if cfg!(target_os = "macos") {
        "alt"
    } else {
        "ctrl"
    };
    bindings.extend([
        KeyBinding::new(&format!("{word_prefix}-backspace"), DeleteWordLeft, context),
        KeyBinding::new(&format!("{word_prefix}-delete"), DeleteWordRight, context),
        KeyBinding::new(&format!("{word_prefix}-left"), WordLeft, context),
        KeyBinding::new(&format!("{word_prefix}-right"), WordRight, context),
        KeyBinding::new(
            &format!("shift-{word_prefix}-left"),
            SelectWordLeft,
            context,
        ),
        KeyBinding::new(
            &format!("shift-{word_prefix}-right"),
            SelectWordRight,
            context,
        ),
    ]);
    for prefix in ["cmd", "ctrl"] {
        bindings.extend([
            KeyBinding::new(&format!("{prefix}-a"), SelectAll, context),
            KeyBinding::new(&format!("{prefix}-c"), Copy, context),
            KeyBinding::new(&format!("{prefix}-x"), Cut, context),
            KeyBinding::new(&format!("{prefix}-v"), Paste, context),
            KeyBinding::new(&format!("{prefix}-z"), Undo, context),
            KeyBinding::new(&format!("shift-{prefix}-z"), Redo, context),
        ]);
    }
    bindings
}

pub struct InputFactory;

impl CustomElementFactory for InputFactory {
    fn element_type(&self) -> &str {
        "input"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(TextEditorElement::new(false))
    }
}

pub struct TextareaFactory;

impl CustomElementFactory for TextareaFactory {
    fn element_type(&self) -> &str {
        "textarea"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(TextEditorElement::new(true))
    }
}

struct TextEditorElement {
    multiline: bool,
    value: String,
    placeholder: String,
    read_only: bool,
    min_rows: usize,
    max_rows: usize,
    last_prop_value: Option<String>,
    value_revision: u64,
    applied_value_revision: u64,
    intercept_clipboard: bool,
    theme: Theme,
    spans: Vec<SpanProp>,
    decorations: Vec<DecorationProp>,
    selection: Option<(usize, usize)>,
    state: Option<Entity<TextEditorState>>,
}

impl TextEditorElement {
    fn new(multiline: bool) -> Self {
        Self {
            multiline,
            value: String::new(),
            placeholder: String::new(),
            read_only: false,
            min_rows: 1,
            max_rows: if multiline { 10 } else { 1 },
            last_prop_value: None,
            value_revision: 0,
            applied_value_revision: 0,
            intercept_clipboard: false,
            theme: Theme::dark(),
            spans: Vec::new(),
            decorations: Vec::new(),
            selection: None,
            state: None,
        }
    }
}

impl CustomElement for TextEditorElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut Window,
        cx: &mut Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        let focus_handle = ctx
            .focus_handle
            .cloned()
            .unwrap_or_else(|| cx.focus_handle());
        let emits_change = ctx.events.contains("change");
        let emits_submit = ctx.events.contains("submit");
        let emits_key_down = ctx.events.contains("keyDown");
        let emits_key_up = ctx.events.contains("keyUp");
        let callback = ctx.event_callback.clone();

        let state = self
            .state
            .get_or_insert_with(|| {
                let value = self.value.clone();
                let placeholder = self.placeholder.clone();
                let multiline = self.multiline;
                let read_only = self.read_only;
                let min_rows = self.min_rows;
                let max_rows = self.max_rows;
                let caret_color = self.theme.caret;
                let callback = callback.clone();
                let id = ctx.id;
                let cursor = value.len();
                let state_focus_handle = focus_handle.clone();
                cx.new(move |cx| TextEditorState {
                    element_id: id,
                    callback,
                    emits_change,
                    emits_submit,
                    emits_key_down,
                    emits_key_up,
                    focus_handle: state_focus_handle,
                    content: value,
                    placeholder: placeholder.into(),
                    multiline,
                    read_only,
                    min_rows,
                    max_rows,
                    selected_range: cursor..cursor,
                    selection_reversed: false,
                    marked_range: None,
                    is_selecting: false,
                    drag_position: None,
                    drag_generation: 0,
                    drag_autoscroll_active: false,
                    scroll_top: 0.0,
                    scroll_left: 0.0,
                    follow_cursor: true,
                    last_lines: Vec::new(),
                    line_starts: vec![0],
                    last_bounds: None,
                    line_height: px(20.0),
                    font_size: px(16.0),
                    content_height: 20.0,
                    content_width: 0.0,
                    display_is_placeholder: false,
                    caret_color,
                    blink_anchor: cx.background_executor().now(),
                    blink_task: None,
                    pending_values: VecDeque::new(),
                    undo_stack: VecDeque::new(),
                    redo_stack: Vec::new(),
                    last_edit: None,
                    spans: Vec::new(),
                    decorations: Vec::new(),
                    external_selection: None,
                    last_emitted_selection: None,
                    intercept_clipboard: false,
                    has_background_runs: false,
                    painted_run_summary: Vec::new(),
                    last_decoration_rects: Vec::new(),
                })
            })
            .clone();

        let prop_changed = self.last_prop_value.as_ref() != Some(&self.value);
        state.update(cx, |state, cx| {
            state.callback = callback;
            state.emits_change = emits_change;
            state.emits_key_down = emits_key_down;
            state.emits_key_up = emits_key_up;
            if state.emits_submit != emits_submit {
                state.emits_submit = emits_submit;
                cx.notify();
            }
            state.placeholder = self.placeholder.clone().into();
            state.read_only = self.read_only;
            state.min_rows = self.min_rows.max(1);
            state.max_rows = self.max_rows.max(state.min_rows);
            if state.caret_color != self.theme.caret {
                state.caret_color = self.theme.caret;
                cx.notify();
            }
            if prop_changed {
                state.sync_prop_value(self.value.clone(), cx);
            } else if self.value_revision != self.applied_value_revision {
                // The document model rewrote this block (input rule, undo,
                // formatting) so the new value is authoritative even when it
                // equals the previously applied one. Bypass echo suppression.
                state.pending_values.clear();
                state.set_external_text(self.value.clone(), cx);
            }
            self.applied_value_revision = self.value_revision;
            if state.spans != self.spans {
                state.spans = self.spans.clone();
                cx.notify();
            }
            if state.decorations != self.decorations {
                state.decorations = self.decorations.clone();
                cx.notify();
            }
            if state.intercept_clipboard != self.intercept_clipboard {
                state.intercept_clipboard = self.intercept_clipboard;
            }
            match self.selection {
                Some((anchor, head)) => {
                    if state.external_selection != Some((anchor, head)) {
                        state.apply_external_selection(anchor, head, cx);
                    }
                }
                None => state.external_selection = None,
            }
        });
        self.last_prop_value = Some(self.value.clone());

        let element_id = gpui::SharedString::from(format!("__gpuix_editor_{}", ctx.id));
        let mut editor = div()
            .id(element_id)
            .flex()
            .min_w_0()
            .w_full()
            .track_focus(&focus_handle)
            .child(state);
        // Single-line inputs center text vertically when given extra height.
        if !self.multiline {
            editor = editor.items_center();
        }
        if let Some(style) = ctx.style {
            editor = crate::renderer::apply_interactive_styles(editor, style);
            // Clip text to rounded corners, matching HTML input behavior.
            if style.border_radius.is_some() {
                editor = editor.overflow_hidden();
            }
        }
        if ctx
            .style
            .and_then(|style| style.position.as_deref())
            .is_none()
        {
            editor = editor.relative();
        }
        let default_role = if self.multiline {
            gpui::Role::MultilineTextInput
        } else {
            gpui::Role::TextInput
        };
        editor = crate::accessibility::apply_accessibility(editor, ctx.props, Some(default_role));
        if ctx.props.get("aria-valuetext").is_none() && !self.value.is_empty() {
            editor = editor.aria_value(self.value.clone());
        }
        if !self.placeholder.is_empty() {
            editor = editor.aria_placeholder(self.placeholder.clone());
        }
        // selection-start region: a drag inside an editor must move the caret,
        // not start a document selection. The tracker overlays both roles.
        editor = editor.child(crate::automation::bounds_tracker(
            ctx.id,
            Some(false),
            ctx.style
                .map(crate::style::bounds_insets)
                .unwrap_or_default(),
        ));
        if ctx.events.contains("click") {
            let callback = ctx.event_callback.clone();
            let id = ctx.id;
            // Match retained hosts: GPUI's semantic click is unreliable under
            // embedded AppKit pumping, so primary mouse-up is the click boundary.
            editor = editor.on_mouse_up(MouseButton::Left, move |event, _window, _cx| {
                emit_event_full(&callback, id, "click", |payload| {
                    let (x, y) = crate::renderer::point_to_xy(event.position);
                    payload.x = Some(x);
                    payload.y = Some(y);
                    payload.button = Some(0);
                    payload.click_count = Some(event.click_count as u32);
                    payload.modifiers = Some(event.modifiers.into());
                    payload.is_right_click = Some(false);
                });
            });
        }
        if ctx.events.contains("fileDrop") {
            let callback = ctx.event_callback.clone();
            let id = ctx.id;
            editor = editor.on_drop(move |dropped: &gpui::ExternalPaths, window, _cx| {
                crate::renderer::emit_file_drop(&callback, id, dropped, window.mouse_position());
            });
        }
        // Custom elements paint themselves, so nothing registers their box for
        // automation unless the builder does it. Without this, a locator on an
        // editor fails with "Element has no painted bounds" and `click()` has
        // no target. `<div>` and `<text>` get this from `build_element`.
        editor = editor.child(crate::automation::bounds_tracker(
            ctx.id,
            None,
            ctx.style
                .map(crate::style::bounds_insets)
                .unwrap_or_default(),
        ));
        editor = crate::accessibility::apply_a11y_click(
            editor,
            ctx.events,
            ctx.id,
            ctx.event_callback,
        );
        editor.into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "value" => self.value = value.as_str().unwrap_or_default().to_string(),
            "placeholder" => self.placeholder = value.as_str().unwrap_or_default().to_string(),
            "readOnly" => self.read_only = value.as_bool().unwrap_or(false),
            "minRows" => self.min_rows = value.as_u64().unwrap_or(1) as usize,
            "maxRows" => {
                self.max_rows = value
                    .as_u64()
                    .unwrap_or(if self.multiline { 10 } else { 1 })
                    as usize
            }
            "theme" => self.theme = Theme::from_prop(Some(&value)),
            "valueRevision" => {
                self.value_revision = value.as_u64().unwrap_or(0)
            }
            "interceptClipboard" => {
                self.intercept_clipboard = value.as_bool().unwrap_or(false)
            }
            "spans" => self.spans = parse_span_props(&value),
            "decorations" => self.decorations = parse_decoration_props(&value),
            "selection" => {
                self.selection = value.as_array().and_then(|items| {
                    let anchor = items.first()?.as_u64()? as usize;
                    let head = items.get(1)?.as_u64()? as usize;
                    Some((anchor, head))
                })
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &[
            "value",
            "placeholder",
            "readOnly",
            "minRows",
            "maxRows",
            "theme",
            "valueRevision",
            "interceptClipboard",
            "spans",
            "decorations",
            "selection",
        ]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[
            "change", "submit", "click", "keyDown", "keyUp", "focus", "blur", "fileDrop",
            "compositionStart", "compositionUpdate", "compositionEnd", "selectionChange",
            "copy", "paste",
        ]
    }

    fn editor_entity(&mut self) -> Option<Entity<TextEditorState>> {
        self.state.clone()
    }

    fn destroy(&mut self) {
        self.state = None;
    }
}

#[derive(Clone)]
struct EditSnapshot {
    content: String,
    selected_range: Range<usize>,
    selection_reversed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditKind {
    Insert,
    DeleteBackward,
    DeleteForward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CoalescingEdit {
    kind: EditKind,
    anchor: usize,
}

#[derive(Clone, Copy)]
struct LastEdit {
    edit: CoalescingEdit,
    when: Instant,
}

/// Inline style overlay for one UTF-16 range of the editor text.
///
/// The WYSIWYG architecture keeps ProseMirror (JS) as the document model: the
/// native editor renders spans computed from it and never edits styles. All
/// offsets are UTF-16, matching PM positions, and are resolved against the
/// current value at layout time so a stale span simply clips.
#[derive(Clone, PartialEq, Default)]
pub(crate) struct SpanDecoration {
    color: Option<gpui::Hsla>,
    font_weight: Option<gpui::FontWeight>,
    italic: bool,
    underline: Option<gpui::Hsla>,
    strikethrough: Option<gpui::Hsla>,
    background: Option<gpui::Hsla>,
    font_family: Option<SharedString>,
}

#[derive(Clone, PartialEq)]
pub(crate) struct SpanProp {
    start: usize,
    end: usize,
    deco: SpanDecoration,
}

#[derive(Clone, PartialEq)]
pub(crate) struct DecorationProp {
    start: usize,
    end: usize,
    color: gpui::Hsla,
}

/// One painted run, recorded for the test surface (`getPaintedInputRuns`).
#[derive(Clone, PartialEq)]
pub(crate) struct PaintedRunSummary {
    pub text: String,
    pub color: u32,
    pub background: Option<u32>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub font_family: Option<String>,
}

fn parse_hsla(value: Option<&serde_json::Value>) -> Option<gpui::Hsla> {
    value
        .and_then(serde_json::Value::as_str)
        .and_then(crate::color::parse_color_rgba)
        .map(gpui::Hsla::from)
}

fn parse_font_weight(value: Option<&serde_json::Value>) -> Option<gpui::FontWeight> {
    match value {
        Some(serde_json::Value::Number(number)) => {
            number.as_f64().map(|weight| FontWeight(weight as f32))
        }
        Some(serde_json::Value::String(name)) => match name.as_str() {
            "bold" => Some(FontWeight::BOLD),
            "semibold" => Some(FontWeight::SEMIBOLD),
            "normal" => Some(FontWeight::NORMAL),
            _ => None,
        },
        _ => None,
    }
}

fn parse_span_deco(item: &serde_json::Value) -> SpanDecoration {
    SpanDecoration {
        color: parse_hsla(item.get("color")),
        font_weight: parse_font_weight(item.get("fontWeight")),
        italic: matches!(
            item.get("fontStyle").and_then(serde_json::Value::as_str),
            Some("italic")
        ),
        underline: parse_hsla(item.get("underline")).or_else(|| {
            item.get("underline")
                .and_then(serde_json::Value::as_bool)
                .filter(|enabled| *enabled)
                .map(|_| gpui::Hsla::default())
        }),
        strikethrough: parse_hsla(item.get("strikethrough")).or_else(|| {
            item.get("strikethrough")
                .and_then(serde_json::Value::as_bool)
                .filter(|enabled| *enabled)
                .map(|_| gpui::Hsla::default())
        }),
        background: parse_hsla(item.get("background")),
        font_family: item
            .get("fontFamily")
            .and_then(serde_json::Value::as_str)
            .map(SharedString::from),
    }
}

pub(crate) fn parse_span_props(value: &serde_json::Value) -> Vec<SpanProp> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    let mut spans: Vec<SpanProp> = items
        .iter()
        .filter_map(|item| {
            let start = item.get("start")?.as_u64()? as usize;
            let end = item.get("end")?.as_u64()? as usize;
            if end <= start {
                return None;
            }
            Some(SpanProp {
                start,
                end,
                deco: parse_span_deco(item),
            })
        })
        .collect();
    spans.sort_by_key(|span| span.start);
    spans
}

pub(crate) fn parse_decoration_props(value: &serde_json::Value) -> Vec<DecorationProp> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let start = item.get("start")?.as_u64()? as usize;
            let end = item.get("end")?.as_u64()? as usize;
            let color = parse_hsla(item.get("color")).unwrap_or(gpui::rgba(0xffe06666).into());
            (end > start).then_some(DecorationProp { start, end, color })
        })
        .collect()
}

/// Build the exact-cover run list for the editor text: base `TextStyle`
/// overlaid by spans, with the IME marked range forced to an underline on top.
/// Spans may overlap (ProseMirror marks compose); later spans win field by
/// field. Returns the runs, a per-run summary for tests, and whether any run
/// carries a background (so paint can call `paint_background`).
fn build_span_runs(
    text: &str,
    base_font: &Font,
    base_color: gpui::Hsla,
    spans: &[SpanProp],
    marked: Option<&Range<usize>>,
) -> (Vec<TextRun>, Vec<PaintedRunSummary>, bool) {
    let mut boundaries = std::collections::BTreeSet::from([0, text.len()]);
    for span in spans {
        let start = utf16_offset_to_utf8(text, span.start);
        let end = utf16_offset_to_utf8(text, span.end);
        boundaries.insert(start.min(text.len()));
        boundaries.insert(end.min(text.len()));
    }
    if let Some(marked) = marked {
        boundaries.insert(marked.start.min(text.len()));
        boundaries.insert(marked.end.min(text.len()));
    }

    let mut runs: Vec<TextRun> = Vec::new();
    let mut summary: Vec<PaintedRunSummary> = Vec::new();
    let mut has_background = false;
    let mut boundaries = boundaries.into_iter().peekable();
    while let (Some(start), Some(&end)) = (boundaries.next(), boundaries.peek()) {
        if end <= start {
            continue;
        }
        let mut font = base_font.clone();
        let mut color = base_color;
        let mut underline = None;
        let mut strikethrough = None;
        let mut background = None;
        for span in spans {
            let span_start = utf16_offset_to_utf8(text, span.start);
            let span_end = utf16_offset_to_utf8(text, span.end);
            if span_start >= end || span_end <= start {
                continue;
            }
            if let Some(span_color) = span.deco.color {
                color = span_color;
            }
            if let Some(weight) = span.deco.font_weight {
                font.weight = weight;
            }
            if let Some(family) = &span.deco.font_family {
                font.family = family.clone();
            }
            if span.deco.italic {
                font.style = FontStyle::Italic;
            }
            if let Some(underline_color) = span.deco.underline {
                underline = Some(UnderlineStyle {
                    color: Some(underline_color),
                    thickness: px(1.0),
                    wavy: false,
                });
            }
            if let Some(strike_color) = span.deco.strikethrough {
                strikethrough = Some(StrikethroughStyle {
                    thickness: px(1.0),
                    color: Some(strike_color),
                });
            }
            if let Some(background_color) = span.deco.background {
                background = Some(background_color);
            }
        }
        if let Some(marked) = marked {
            if marked.start <= start && end <= marked.end {
                underline = Some(UnderlineStyle {
                    color: Some(color),
                    thickness: px(1.0),
                    wavy: false,
                });
            }
        }
        if background.is_some() {
            has_background = true;
        }
        let run = TextRun {
            len: end - start,
            font,
            color,
            background_color: background,
            underline,
            strikethrough,
        };
        if let Some(last) = runs.last_mut() {
            if last.font == run.font
                && last.color == run.color
                && last.background_color == run.background_color
                && last.underline == run.underline
                && last.strikethrough == run.strikethrough
            {
                last.len += run.len;
                if let Some(entry) = summary.last_mut() {
                    entry.text.push_str(&text[start..end]);
                }
                continue;
            }
        }
        runs.push(run);
        summary.push(PaintedRunSummary {
            text: text[start..end].to_string(),
            color: u32::from(gpui::Rgba::from(color)),
            background: background.map(|bg| u32::from(gpui::Rgba::from(bg))),
            bold: runs.last().is_some_and(|run| run.font.weight >= FontWeight::SEMIBOLD),
            italic: runs.last().is_some_and(|run| run.font.style == FontStyle::Italic),
            underline: runs.last().is_some_and(|run| run.underline.is_some()),
            strikethrough: runs.last().is_some_and(|run| run.strikethrough.is_some()),
            font_family: runs.last().and_then(|run| {
                (run.font.family != base_font.family).then(|| run.font.family.to_string())
            }),
        });
    }
    (runs, summary, has_background)
}

#[cfg(test)]
mod span_tests {
    use super::*;

    fn base_font() -> Font {
        let mut font = Font::default();
        font.family = "Helvetica".into();
        font
    }

    fn span(start: usize, end: usize, deco: SpanDecoration) -> SpanProp {
        SpanProp { start, end, deco }
    }

    fn deco_bold() -> SpanDecoration {
        SpanDecoration {
            font_weight: Some(FontWeight::BOLD),
            ..Default::default()
        }
    }

    fn deco_strike() -> SpanDecoration {
        SpanDecoration {
            strikethrough: Some(gpui::Hsla::default()),
            ..Default::default()
        }
    }

    #[test]
    fn runs_cover_text_exactly() {
        let text = "hello world";
        let (runs, summary, _) =
            build_span_runs(text, &base_font(), gpui::Hsla::default(), &[], None);
        assert_eq!(runs.iter().map(|run| run.len).sum::<usize>(), text.len());
        assert_eq!(runs.len(), 1);
        assert_eq!(summary.len(), 1);
        assert_eq!(summary[0].text, text);
    }

    #[test]
    fn spans_split_runs_and_report_style() {
        let text = "abc def";
        let spans = vec![span(0, 3, deco_bold()), span(4, 7, deco_strike())];
        let (runs, summary, _) = build_span_runs(
            text,
            &base_font(),
            gpui::Hsla::default(),
            &spans,
            None,
        );
        assert_eq!(runs.len(), 3);
        assert_eq!(
            summary.iter().map(|entry| entry.text.as_str()).collect::<Vec<_>>(),
            vec!["abc", " ", "def"]
        );
        assert!(summary[0].bold);
        assert!(!summary[1].bold);
        assert!(summary[2].strikethrough);
    }

    #[test]
    fn overlapping_spans_compose() {
        let text = "abcdef";
        let spans = vec![
            span(0, 6, SpanDecoration {
                background: Some(gpui::Hsla::default()),
                ..Default::default()
            }),
            span(2, 4, deco_bold()),
        ];
        let (runs, summary, has_background) = build_span_runs(
            text,
            &base_font(),
            gpui::Hsla::default(),
            &spans,
            None,
        );
        assert!(has_background);
        assert_eq!(
            summary.iter().map(|entry| entry.text.as_str()).collect::<Vec<_>>(),
            vec!["ab", "cd", "ef"]
        );
        assert!(!summary[0].bold);
        assert!(summary[1].bold);
        assert!(summary.iter().all(|entry| entry.background.is_some()));
        assert!(runs.iter().all(|run| run.len > 0));
        assert_eq!(runs.iter().map(|run| run.len).sum::<usize>(), text.len());
    }

    #[test]
    fn marked_range_forces_underline_over_spans() {
        let text = "nihao";
        let spans = vec![span(0, 5, deco_bold())];
        let (runs, summary, _) = build_span_runs(
            text,
            &base_font(),
            gpui::Hsla::default(),
            &spans,
            Some(&(1..3)),
        );
        assert!(runs.len() >= 3);
        assert!(summary.iter().any(|entry| entry.underline && entry.text == "ih"));
        assert!(summary.iter().all(|entry| entry.bold));
    }

    #[test]
    fn stale_spans_clip_to_text() {
        let text = "ab";
        let spans = vec![span(0, 99, deco_bold())];
        let (runs, _, _) =
            build_span_runs(text, &base_font(), gpui::Hsla::default(), &spans, None);
        assert_eq!(runs.iter().map(|run| run.len).sum::<usize>(), text.len());
    }

    #[test]
    fn adjacent_identical_runs_merge() {
        let text = "abc";
        let spans = vec![span(0, 3, deco_bold())];
        // Two spans producing the same style on both sides of a boundary merge.
        let spans = vec![span(0, 1, deco_bold()), span(1, 3, deco_bold())];
        let (runs, summary, _) = build_span_runs(
            text,
            &base_font(),
            gpui::Hsla::default(),
            &spans,
            None,
        );
        assert_eq!(runs.len(), 1);
        assert_eq!(summary[0].text, "abc");
    }

    #[test]
    fn utf16_offsets_map_through_surrogate_pairs() {
        let text = "a😀b";
        // 😀 is one UTF-16 unit pair (2), so UTF-16 offset 3 is after it.
        let spans = vec![span(3, 4, deco_bold())];
        let (_, summary, _) = build_span_runs(
            text,
            &base_font(),
            gpui::Hsla::default(),
            &spans,
            None,
        );
        assert_eq!(summary[summary.len() - 1].text, "b");
        assert!(summary[summary.len() - 1].bold);
    }

    #[test]
    fn parses_span_props_from_json() {
        let value = serde_json::json!([
            { "start": 0, "end": 2, "fontWeight": 700, "fontStyle": "italic" },
            { "start": 4, "end": 9, "background": "#11223344" },
            { "start": 5, "end": 5 }
        ]);
        let spans = parse_span_props(&value);
        assert_eq!(spans.len(), 2);
        assert!(spans[0].deco.font_weight.is_some());
        assert!(spans[0].deco.italic);
        assert!(spans[1].deco.background.is_some());
    }
}


fn coalescing_edit(
    range: &Range<usize>,
    new_text: &str,
    selection_reversed: bool,
) -> Option<CoalescingEdit> {
    if new_text.is_empty() {
        if range.is_empty() {
            return None;
        }
        return Some(CoalescingEdit {
            kind: if selection_reversed {
                EditKind::DeleteBackward
            } else {
                EditKind::DeleteForward
            },
            anchor: range.start,
        });
    }

    let mut characters = new_text.chars();
    let character = characters.next()?;
    (range.is_empty() && characters.next().is_none() && !character.is_whitespace()).then_some(
        CoalescingEdit {
            kind: EditKind::Insert,
            anchor: range.start + new_text.len(),
        },
    )
}

fn edits_coalesce(
    previous: CoalescingEdit,
    current: Option<CoalescingEdit>,
    range: &Range<usize>,
    elapsed: Duration,
) -> bool {
    let Some(current) = current else {
        return false;
    };
    if previous.kind != current.kind || elapsed >= UNDO_COALESCE {
        return false;
    }
    match current.kind {
        EditKind::Insert | EditKind::DeleteForward => range.start == previous.anchor,
        EditKind::DeleteBackward => range.end == previous.anchor,
    }
}

fn push_undo_snapshot(history: &mut VecDeque<EditSnapshot>, snapshot: EditSnapshot) {
    if history.len() == UNDO_LIMIT {
        history.pop_front();
    }
    history.push_back(snapshot);
}

pub(crate) struct TextEditorState {
    element_id: u64,
    callback: Option<EventCallback>,
    emits_change: bool,
    emits_submit: bool,
    emits_key_down: bool,
    emits_key_up: bool,
    focus_handle: FocusHandle,
    content: String,
    placeholder: SharedString,
    multiline: bool,
    read_only: bool,
    min_rows: usize,
    max_rows: usize,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    is_selecting: bool,
    drag_position: Option<Point<Pixels>>,
    drag_generation: u64,
    drag_autoscroll_active: bool,
    scroll_top: f32,
    scroll_left: f32,
    follow_cursor: bool,
    last_lines: Vec<WrappedLine>,
    line_starts: Vec<usize>,
    last_bounds: Option<Bounds<Pixels>>,
    line_height: Pixels,
    font_size: Pixels,
    content_height: f32,
    content_width: f32,
    display_is_placeholder: bool,
    caret_color: gpui::Hsla,
    blink_anchor: Instant,
    blink_task: Option<Task<()>>,
    pending_values: VecDeque<String>,
    undo_stack: VecDeque<EditSnapshot>,
    redo_stack: Vec<EditSnapshot>,
    last_edit: Option<LastEdit>,
    spans: Vec<SpanProp>,
    decorations: Vec<DecorationProp>,
    external_selection: Option<(usize, usize)>,
    last_emitted_selection: Option<(usize, usize)>,
    intercept_clipboard: bool,
    has_background_runs: bool,
    painted_run_summary: Vec<PaintedRunSummary>,
    last_decoration_rects: Vec<DecorationRects>,
}

/// Where a decoration range landed on screen, recorded at prepaint for the
/// test surface (`getInputDecorations`).
#[derive(Clone, PartialEq)]
pub(crate) struct DecorationRects {
    pub start: usize,
    pub end: usize,
    pub color: u32,
    pub rects: Vec<Bounds<Pixels>>,
}

impl TextEditorState {
    fn reset_blink(&mut self, cx: &Context<Self>) {
        self.blink_anchor = cx.background_executor().now();
    }

    fn caret_shown(&mut self, window: &Window, cx: &mut Context<Self>) -> bool {
        if !self.focus_handle.is_focused(window) || !window.is_window_active() {
            self.blink_task = None;
            return false;
        }
        if self.blink_task.is_none() {
            self.reset_blink(cx);
            self.blink_task = Some(cx.spawn(async move |this, cx| loop {
                cx.background_executor()
                    .timer(Duration::from_millis(CARET_BLINK_MS))
                    .await;
                if this.update(cx, |_, cx| cx.notify()).is_err() {
                    break;
                }
            }));
        }
        caret_visible(self.blink_anchor.elapsed().as_millis() as u64)
    }

    fn snapshot(&self) -> EditSnapshot {
        EditSnapshot {
            content: self.content.clone(),
            selected_range: self.selected_range.clone(),
            selection_reversed: self.selection_reversed,
        }
    }

    fn sync_prop_value(&mut self, value: String, cx: &mut Context<Self>) {
        if let Some(index) = self
            .pending_values
            .iter()
            .rposition(|pending| pending == &value)
        {
            self.pending_values.drain(..=index);
            return;
        }
        self.pending_values.clear();
        self.set_external_text(value, cx);
    }

    fn set_external_text(&mut self, value: String, cx: &mut Context<Self>) {
        if self.content == value {
            return;
        }
        self.content = value;
        let end = self.content.len();
        self.selected_range = end..end;
        self.selection_reversed = false;
        let content_end = self.offset_to_utf16(self.content.len());
        self.last_emitted_selection = Some((content_end, content_end));
        self.marked_range = None;
        self.scroll_top = 0.0;
        self.scroll_left = 0.0;
        self.follow_cursor = true;
        self.reset_blink(cx);
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.last_edit = None;
        cx.notify();
    }

    /// Move the caret/selection from JS (UTF-16 offsets, anchor/head like the
    /// DOM). The native editor stays authoritative while typing — JS applies
    /// this only when it must move the selection itself (find-next, restore).
    fn apply_external_selection(
        &mut self,
        anchor_utf16: usize,
        head_utf16: usize,
        cx: &mut Context<Self>,
    ) {
        let len = self.content.len();
        let anchor = self.offset_from_utf16(anchor_utf16).min(len);
        let head = self.offset_from_utf16(head_utf16).min(len);
        let reversed = anchor > head;
        let range = if reversed { head..anchor } else { anchor..head };
        if self.selected_range != range || self.selection_reversed != reversed {
            self.selected_range = range;
            self.selection_reversed = reversed;
            self.reset_blink(cx);
            cx.notify();
        }
        self.external_selection = Some((anchor_utf16, head_utf16));
        // The selection came from JS; do not echo it back as a user event.
        self.last_emitted_selection = Some((anchor_utf16, head_utf16));
    }

    fn emit_change(&mut self) {
        if self.emits_change {
            self.pending_values.push_back(self.content.clone());
            while self.pending_values.len() > 32 {
                self.pending_values.pop_front();
            }
            emit_event_full(&self.callback, self.element_id, "change", |payload| {
                payload.value = Some(self.content.clone());
            });
        }
    }

    /// Window-space caret position for a UTF-16 offset, for the measurement
    /// API the WYSIWYG component uses to align overlays and extend
    /// selections across blocks.
    pub(crate) fn window_point_for_utf16(&self, offset_utf16: usize) -> Option<(f32, f32)> {
        let index = self.offset_from_utf16(offset_utf16);
        let point = self.point_for_index(index)?;
        let bounds = self.last_bounds?;
        Some((
            f32::from(bounds.left() + point.x) - self.scroll_left,
            f32::from(bounds.top() + point.y) - self.scroll_top,
        ))
    }

    /// Hit-test a window-space point to the closest UTF-16 offset.
    pub(crate) fn utf16_index_for_window_point(&self, x: f32, y: f32) -> Option<usize> {
        let index = self.index_for_mouse_position(point(px(x), px(y)));
        Some(self.offset_to_utf16(index))
    }

    /// Push-selection model: emit `selectionChange` (UTF-16 anchor/head)
    /// whenever the selection last painted differs from the last emitted one.
    /// Called once per paint so bursts of changes collapse into one event.
    fn emit_selection_change(&mut self) {
        let selection_utf16 = self.range_to_utf16(&self.selected_range);
        let (anchor, head) = if self.selection_reversed {
            (selection_utf16.end, selection_utf16.start)
        } else {
            (selection_utf16.start, selection_utf16.end)
        };
        if self.last_emitted_selection == Some((anchor, head)) {
            return;
        }
        self.last_emitted_selection = Some((anchor, head));
        emit_event_full(
            &self.callback,
            self.element_id,
            "selectionChange",
            |payload| {
                payload.start_index = Some(anchor as f64);
                payload.end_index = Some(head as f64);
            },
        );
    }

    /// Snapshot of the last-laid-out runs, for the test surface.
    pub(crate) fn painted_run_snapshot(&self) -> Vec<PaintedRunSummary> {
        self.painted_run_summary.clone()
    }

    /// Snapshot of where decoration ranges landed on screen, for tests.
    pub(crate) fn decoration_rects_snapshot(&self) -> Vec<DecorationRects> {
        self.last_decoration_rects.clone()
    }

    fn emit_submit(&self) {
        if self.emits_submit {
            emit_event_full(&self.callback, self.element_id, "submit", |payload| {
                payload.value = Some(self.content.clone());
            });
        }
    }

    fn restore(&mut self, snapshot: EditSnapshot, cx: &mut Context<Self>) {
        self.content = snapshot.content;
        self.selected_range = snapshot.selected_range;
        self.selection_reversed = snapshot.selection_reversed;
        self.marked_range = None;
        self.follow_cursor = true;
        self.last_edit = None;
        self.reset_blink(cx);
        self.emit_change();
        cx.notify();
    }

    fn record_edit(&mut self, range: &Range<usize>, new_text: &str, now: Instant) {
        let current = coalescing_edit(range, new_text, self.selection_reversed);
        let mergeable = self.last_edit.is_some_and(|previous| {
            edits_coalesce(
                previous.edit,
                current,
                range,
                now.duration_since(previous.when),
            )
        });
        if !mergeable {
            let snapshot = self.snapshot();
            push_undo_snapshot(&mut self.undo_stack, snapshot);
        }
        self.redo_stack.clear();
        self.last_edit = current.map(|edit| LastEdit { edit, when: now });
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = offset.min(self.content.len());
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.follow_cursor = true;
        self.reset_blink(cx);
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = offset.min(self.content.len());
        if self.selection_reversed {
            self.selected_range.start = offset;
        } else {
            self.selected_range.end = offset;
        }
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        self.follow_cursor = true;
        self.reset_blink(cx);
        cx.notify();
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(index, _)| (index < offset).then_some(index))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > offset).then_some(index))
            .unwrap_or(self.content.len())
    }

    fn previous_word_boundary(&self, offset: usize) -> usize {
        self.content
            .split_word_bound_indices()
            .rev()
            .find_map(|(index, word)| (index < offset && !word.trim().is_empty()).then_some(index))
            .unwrap_or(0)
    }

    fn next_word_boundary(&self, offset: usize) -> usize {
        self.content
            .split_word_bound_indices()
            .find_map(|(index, word)| {
                let end = index + word.len();
                (end > offset && !word.trim().is_empty()).then_some(end)
            })
            .unwrap_or(self.content.len())
    }

    fn line_range_at(&self, offset: usize) -> Range<usize> {
        let start = self.content[..offset]
            .rfind('\n')
            .map(|index| index + 1)
            .unwrap_or(0);
        let end = self.content[offset..]
            .find('\n')
            .map(|index| offset + index)
            .unwrap_or(self.content.len());
        start..end
    }

    fn visual_line_boundary(&self, end: bool) -> usize {
        let Some(cursor) = self.point_for_index(self.cursor_offset()) else {
            let line = self.line_range_at(self.cursor_offset());
            return if end { line.end } else { line.start };
        };
        self.index_for_point(point(
            if end { px(1_000_000.0) } else { px(0.0) },
            cursor.y + px(0.5),
        ))
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            let previous = self.previous_boundary(self.cursor_offset());
            if previous == self.cursor_offset() {
                return;
            }
            self.select_to(previous, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            let next = self.next_boundary(self.cursor_offset());
            if next == self.cursor_offset() {
                return;
            }
            self.select_to(next, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        let offset = if self.selected_range.is_empty() {
            self.previous_boundary(self.cursor_offset())
        } else {
            self.selected_range.start
        };
        self.move_to(offset, cx);
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        let offset = if self.selected_range.is_empty() {
            self.next_boundary(self.cursor_offset())
        } else {
            self.selected_range.end
        };
        self.move_to(offset, cx);
    }

    fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(-1.0) {
            self.move_to(offset, cx);
        }
    }

    fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(1.0) {
            self.move_to(offset, cx);
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(-1.0) {
            self.select_to(offset, cx);
        }
    }

    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(1.0) {
            self.select_to(offset, cx);
        }
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.selected_range = 0..self.content.len();
        self.selection_reversed = false;
        self.reset_blink(cx);
        cx.notify();
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.visual_line_boundary(false), cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.visual_line_boundary(true), cx);
    }

    fn doc_start(&mut self, _: &DocStart, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
    }

    fn doc_end(&mut self, _: &DocEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.content.len(), cx);
    }

    fn select_home(&mut self, _: &SelectHome, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.visual_line_boundary(false), cx);
    }

    fn select_end(&mut self, _: &SelectEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.visual_line_boundary(true), cx);
    }

    fn select_doc_start(&mut self, _: &SelectDocStart, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(0, cx);
    }

    fn select_doc_end(&mut self, _: &SelectDocEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.content.len(), cx);
    }

    fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.previous_word_boundary(self.cursor_offset()), cx);
    }

    fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.next_word_boundary(self.cursor_offset()), cx);
    }

    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_word_boundary(self.cursor_offset()), cx);
    }

    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_word_boundary(self.cursor_offset()), cx);
    }

    fn delete_word_left(
        &mut self,
        _: &DeleteWordLeft,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            self.select_to(self.previous_word_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete_word_right(
        &mut self,
        _: &DeleteWordRight,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            self.select_to(self.next_word_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete_to_line_start(
        &mut self,
        _: &DeleteToLineStart,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            let start = self.line_range_at(self.cursor_offset()).start;
            if start == self.cursor_offset() {
                return;
            }
            self.select_to(start, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete_to_line_end(
        &mut self,
        _: &DeleteToLineEnd,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        if self.selected_range.is_empty() {
            let end = self.line_range_at(self.cursor_offset()).end;
            if end == self.cursor_offset() {
                return;
            }
            self.select_to(end, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if self.intercept_clipboard {
            // Keybindings consume cmd-c before keyDown reaches JS, so an
            // opt-in editor reports the intent and the host serializes
            // (e.g. cross-block markdown selection).
            let selection_utf16 = self.range_to_utf16(&self.selected_range.clone());
            emit_event_full(&self.callback, self.element_id, "copy", |payload| {
                payload.start_index = Some(selection_utf16.start as f64);
                payload.end_index = Some(selection_utf16.end as f64);
            });
            return;
        }
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only || self.selected_range.is_empty() {
            return;
        }
        self.copy(&Copy, window, cx);
        self.replace_text_in_range(None, "", window, cx);
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            if self.intercept_clipboard {
                emit_event_full(&self.callback, self.element_id, "paste", |payload| {
                    payload.value = Some(text);
                });
                return;
            }
            self.replace_text_in_range(None, &text, window, cx);
        }
    }

    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(previous) = self.undo_stack.pop_back() {
            self.redo_stack.push(self.snapshot());
            self.restore(previous, cx);
        }
    }

    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        if self.read_only {
            return;
        }
        if let Some(next) = self.redo_stack.pop() {
            let snapshot = self.snapshot();
            push_undo_snapshot(&mut self.undo_stack, snapshot);
            self.restore(next, cx);
        }
    }

    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        if self.multiline && !self.read_only {
            self.replace_text_in_range(None, "\n", window, cx);
        }
    }

    fn submit(&mut self, _: &Submit, _: &mut Window, _: &mut Context<Self>) {
        self.emit_submit();
    }

    fn vertical_target(&self, direction: f32) -> Option<usize> {
        let current = self.point_for_index(self.cursor_offset())?;
        let target_y = f32::from(current.y) + direction * f32::from(self.line_height);
        if target_y < 0.0 {
            return Some(0);
        }
        if target_y >= self.content_height {
            return Some(self.content.len());
        }
        Some(self.index_for_point(point(current.x, px(target_y))))
    }

    fn point_for_index(&self, index: usize) -> Option<Point<Pixels>> {
        for (line_index, line) in self.last_lines.iter().enumerate() {
            let line_start = *self.line_starts.get(line_index)?;
            if index < line_start || index > line_start + line.len() {
                continue;
            }
            let local = line.position_for_index(index - line_start, self.line_height)?;
            let y_offset: Pixels = self
                .last_lines
                .iter()
                .take(line_index)
                .map(|line| line.size(self.line_height).height)
                .sum();
            return Some(point(local.x, local.y + y_offset));
        }
        None
    }

    fn index_for_point(&self, position: Point<Pixels>) -> usize {
        if self.display_is_placeholder {
            return 0;
        }
        let mut y = f32::from(position.y).max(0.0);
        for (line_index, line) in self.last_lines.iter().enumerate() {
            let height = f32::from(line.size(self.line_height).height);
            let line_start = self.line_starts.get(line_index).copied().unwrap_or(0);
            if y < height || line_index + 1 == self.last_lines.len() {
                let local = point(position.x, px(y.min(height - 1.0).max(0.0)));
                let index = line
                    .closest_index_for_position(local, self.line_height)
                    .unwrap_or_else(|index| index);
                return (line_start + index).min(self.content.len());
            }
            y -= height;
        }
        self.content.len()
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        let Some(bounds) = self.last_bounds else {
            return 0;
        };
        self.index_for_point(point(
            position.x - bounds.left() + px(self.scroll_left),
            position.y - bounds.top() + px(self.scroll_top),
        ))
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.read_only {
            window.request_text_input();
        }
        window.focus(&self.focus_handle, cx);
        let intent = press_intent(event.click_count, event.modifiers.shift);
        self.is_selecting = intent.arms_drag();
        self.drag_position = intent.arms_drag().then_some(event.position);
        self.drag_generation = self.drag_generation.wrapping_add(1);
        self.drag_autoscroll_active = false;
        match intent {
            PressIntent::SelectAll => {
                self.move_to(0, cx);
                self.select_to(self.content.len(), cx);
            }
            PressIntent::SelectWord => {
                let index = self.index_for_mouse_position(event.position);
                let range = crate::text::selection::word_range(&self.content, index);
                self.move_to(range.start, cx);
                self.select_to(range.end, cx);
            }
            PressIntent::ExtendSelection => {
                self.select_to(self.index_for_mouse_position(event.position), cx);
            }
            PressIntent::PlaceCaret => {
                self.move_to(self.index_for_mouse_position(event.position), cx);
            }
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
        self.drag_position = None;
        self.drag_generation = self.drag_generation.wrapping_add(1);
        self.drag_autoscroll_active = false;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if self.is_selecting {
            self.drag_position = Some(event.position);
            let position = self.drag_selection_position(event.position);
            self.select_to(self.index_for_mouse_position(position), cx);
            if self.multiline
                && self.drag_scroll_delta(event.position) != 0.0
                && !self.drag_autoscroll_active
            {
                self.start_drag_autoscroll(cx);
            }
        }
    }

    fn start_drag_autoscroll(&mut self, cx: &mut Context<Self>) {
        self.drag_autoscroll_active = true;
        let generation = self.drag_generation;
        cx.spawn(async move |this, cx| loop {
            cx.background_executor()
                .timer(Duration::from_millis(DRAG_SCROLL_FRAME_MS))
                .await;
            let keep_running = this
                .update(cx, |input, cx| input.drag_autoscroll_tick(generation, cx))
                .unwrap_or(false);
            if !keep_running {
                break;
            }
        })
        .detach();
    }

    fn drag_selection_position(&self, position: Point<Pixels>) -> Point<Pixels> {
        let Some(bounds) = self.last_bounds else {
            return position;
        };
        let x = if self.multiline {
            position.x.clamp(bounds.left(), bounds.right() - px(0.5))
        } else {
            position.x
        };
        point(
            x,
            position.y.clamp(bounds.top(), bounds.bottom() - px(0.5)),
        )
    }

    fn drag_scroll_delta(&self, position: Point<Pixels>) -> f32 {
        let Some(bounds) = self.last_bounds else {
            return 0.0;
        };
        drag_scroll_delta(
            f32::from(position.y),
            f32::from(bounds.top()),
            f32::from(bounds.bottom()),
            f32::from(self.line_height),
        )
    }

    fn drag_autoscroll_tick(&mut self, generation: u64, cx: &mut Context<Self>) -> bool {
        if !self.multiline || !self.is_selecting || self.drag_generation != generation {
            return false;
        }
        let (Some(position), Some(bounds)) = (self.drag_position, self.last_bounds) else {
            self.drag_autoscroll_active = false;
            return false;
        };
        let delta = self.drag_scroll_delta(position);
        if delta == 0.0 {
            self.drag_autoscroll_active = false;
            return false;
        }
        let max_scroll = (self.content_height - f32::from(bounds.size.height)).max(0.0);
        let next = (self.scroll_top + delta).clamp(0.0, max_scroll);
        if next == self.scroll_top {
            self.drag_autoscroll_active = false;
            return false;
        }
        self.scroll_top = next;
        let edge_position = self.drag_selection_position(position);
        self.select_to(self.index_for_mouse_position(edge_position), cx);
        self.follow_cursor = false;
        true
    }

    fn on_scroll_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(bounds) = self.last_bounds else {
            return;
        };
        let viewport_height = f32::from(bounds.size.height);
        let max_scroll = (self.content_height - viewport_height).max(0.0);
        if max_scroll == 0.0 {
            return;
        }
        let delta = f32::from(event.delta.pixel_delta(self.line_height).y);
        let next = (self.scroll_top - delta).clamp(0.0, max_scroll);
        if next == self.scroll_top {
            if delta != 0.0 {
                cx.stop_propagation();
            }
            return;
        }
        self.scroll_top = next;
        self.follow_cursor = false;
        cx.stop_propagation();
        cx.notify();
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;
        for character in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += character.len_utf16();
            utf8_offset += character.len_utf8();
        }
        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;
        for character in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += character.len_utf8();
            utf16_offset += character.len_utf16();
        }
        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range.start)..self.offset_from_utf16(range.end)
    }

    fn layout_text(&mut self, width: Pixels, style: &TextStyle, window: &mut Window) -> f32 {
        let (display, is_placeholder) = if self.content.is_empty() {
            (self.placeholder.clone(), true)
        } else {
            (SharedString::from(self.content.clone()), false)
        };
        let rem_size = window.rem_size();
        let font_size = style.font_size.to_pixels(rem_size);
        self.font_size = font_size;
        // Taffy measures after the parent `with_text_style` is gone, so
        // `window.line_height()` here is always 16×φ no matter what the
        // element style says. Use the TextStyle captured during
        // request_layout: an explicit lineHeight sets the row in pixels,
        // and without one a larger fontSize still grows the box.
        self.line_height = style.line_height_in_pixels(rem_size);
        let color = if is_placeholder {
            gpui::rgba(0x8f8f8fff).into()
        } else {
            style.color
        };
        let run = |len: usize, underline: bool| TextRun {
            len,
            font: style.font(),
            color,
            background_color: None,
            underline: underline.then_some(UnderlineStyle {
                color: Some(color),
                thickness: px(1.0),
                wavy: false,
            }),
            strikethrough: None,
        };
        if is_placeholder {
            self.display_is_placeholder = true;
            self.spans_applied(&[], false);
            let runs = match self.marked_range.as_ref() {
                Some(marked) => vec![
                    run(marked.start, false),
                    run(marked.len(), true),
                    run(display.len() - marked.end, false),
                ]
                .into_iter()
                .filter(|run| run.len > 0)
                .collect(),
                _ => vec![run(display.len(), false)],
            };
            return self.shape_and_measure(display, runs, self.multiline.then_some(width), window);
        }
        self.display_is_placeholder = false;
        let (runs, summary, has_background) =
            build_span_runs(&display, &style.font(), color, &self.spans, self.marked_range.as_ref());
        self.spans_applied(&summary, has_background);
        self.shape_and_measure(display, runs, self.multiline.then_some(width), window)
    }

    fn spans_applied(&mut self, summary: &[PaintedRunSummary], has_background: bool) {
        self.painted_run_summary = summary.to_vec();
        self.has_background_runs = has_background;
    }

    fn shape_and_measure(
        &mut self,
        display: SharedString,
        runs: Vec<TextRun>,
        wrap_width: Option<Pixels>,
        window: &mut Window,
    ) -> f32 {
        let lines = window
            .text_system()
            .shape_text(display, self.font_size, &runs, wrap_width, None)
            .map(|lines| lines.into_vec())
            .unwrap_or_default();
        let mut line_starts = Vec::with_capacity(lines.len());
        let mut offset = 0;
        for line in &lines {
            line_starts.push(offset);
            offset += line.len() + 1;
        }
        if line_starts.is_empty() {
            line_starts.push(0);
        }
        self.content_height = lines
            .iter()
            .map(|line| f32::from(line.size(self.line_height).height))
            .sum::<f32>()
            .max(f32::from(self.line_height));
        self.content_width = lines
            .iter()
            .map(|line| f32::from(line.unwrapped_layout.width))
            .fold(0.0, f32::max);
        self.last_lines = lines;
        self.line_starts = line_starts;
        self.content_height
    }


    fn clamp_scroll(&mut self, viewport_width: f32, viewport_height: f32) {
        if self.follow_cursor {
            if let Some(cursor) = self.point_for_index(self.cursor_offset()) {
                let cursor_top = f32::from(cursor.y);
                if cursor_top < self.scroll_top {
                    self.scroll_top = cursor_top;
                } else if cursor_top + f32::from(self.line_height)
                    > self.scroll_top + viewport_height
                {
                    self.scroll_top = cursor_top + f32::from(self.line_height) - viewport_height;
                }
                if !self.multiline {
                    let cursor_left = f32::from(cursor.x);
                    if cursor_left < self.scroll_left {
                        self.scroll_left = cursor_left;
                    } else if cursor_left + 2.0 > self.scroll_left + viewport_width {
                        self.scroll_left = cursor_left + 2.0 - viewport_width;
                    }
                }
            }
        }
        self.scroll_top = self
            .scroll_top
            .clamp(0.0, (self.content_height - viewport_height).max(0.0));
        self.scroll_left = if self.multiline {
            0.0
        } else {
            self.scroll_left
                .clamp(0.0, (self.content_width + 2.0 - viewport_width).max(0.0))
        };
    }
}

impl EntityInputHandler for TextEditorState {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        self.content.get(range).map(str::to_string)
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(marked) = self.marked_range.take() {
            // A cancelled composition still ends, exactly like a committed
            // one; the data is the composed text being dropped.
            let data = self.content.get(marked).map(str::to_string).unwrap_or_default();
            emit_event_full(&self.callback, self.element_id, "compositionEnd", |payload| {
                payload.value = Some(data);
            });
        }
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        let range = range_utf16
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let replacement = if self.multiline {
            new_text.to_string()
        } else {
            single_line_text(new_text)
        };
        if self.marked_range.is_none() {
            self.record_edit(&range, &replacement, cx.background_executor().now());
        }
        if self.marked_range.is_some() {
            // A committed composition ends with the inserted text as its
            // data, mirroring the DOM's compositionend-after-insert order.
            emit_event_full(
                &self.callback,
                self.element_id,
                "compositionEnd",
                |payload| {
                    payload.value = Some(replacement.clone());
                },
            );
        }
        self.content =
            self.content[..range.start].to_owned() + &replacement + &self.content[range.end..];
        let cursor = range.start + replacement.len();
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        self.follow_cursor = true;
        self.reset_blink(cx);
        self.emit_change();
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.read_only {
            return;
        }
        let range = range_utf16
            .as_ref()
            .map(|range| self.range_from_utf16(range))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let was_marked = self.marked_range.is_some();
        if !was_marked {
            let snapshot = self.snapshot();
            push_undo_snapshot(&mut self.undo_stack, snapshot);
            self.redo_stack.clear();
            self.last_edit = None;
        }
        let replacement = if self.multiline {
            new_text.to_string()
        } else {
            single_line_text(new_text)
        };
        self.content =
            self.content[..range.start].to_owned() + &replacement + &self.content[range.end..];
        // DOM shape: compositionstart once, compositionupdate per new marked
        // text, compositionend when the platform clears the marking (macOS
        // sends an empty setMarkedText to finish) or commits.
        if replacement.is_empty() {
            if was_marked {
                emit_event_full(
                    &self.callback,
                    self.element_id,
                    "compositionEnd",
                    |payload| {
                        payload.value = Some(String::new());
                    },
                );
            }
        } else {
            if !was_marked {
                emit_event_full(
                    &self.callback,
                    self.element_id,
                    "compositionStart",
                    |payload| {
                        payload.value = Some(String::new());
                    },
                );
            }
            emit_event_full(
                &self.callback,
                self.element_id,
                "compositionUpdate",
                |payload| {
                    payload.value = Some(replacement.clone());
                },
            );
        }
        self.marked_range =
            (!replacement.is_empty()).then_some(range.start..range.start + replacement.len());
        self.selected_range = new_selected_range_utf16
            .as_ref()
            .map(|selected| {
                range.start + utf16_offset_to_utf8(&replacement, selected.start)
                    ..range.start + utf16_offset_to_utf8(&replacement, selected.end)
            })
            .unwrap_or_else(|| range.start + replacement.len()..range.start + replacement.len());
        self.follow_cursor = true;
        self.reset_blink(cx);
        self.emit_change();
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let start = self.point_for_index(range.start)?;
        Some(caret_rect(
            point(
                bounds.left() + start.x - px(self.scroll_left),
                bounds.top() + start.y - px(self.scroll_top),
            ),
            self.line_height,
            self.font_size,
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(self.offset_to_utf16(self.index_for_mouse_position(position)))
    }

    fn set_selected_text_range(
        &mut self,
        range_utf16: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selected_range = self.range_from_utf16(&range_utf16);
        self.selection_reversed = false;
        self.follow_cursor = true;
        self.reset_blink(cx);
        cx.notify();
    }

    fn text_length_utf16(&mut self, _: &mut Window, _: &mut Context<Self>) -> Option<usize> {
        Some(self.content.encode_utf16().count())
    }

    fn accepts_text_input(&self, _: &mut Window, _: &mut Context<Self>) -> bool {
        !self.read_only
    }
}

impl gpui::Render for TextEditorState {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let key_down_callback = self.callback.clone();
        let key_up_callback = self.callback.clone();
        let element_id = self.element_id;
        div()
            .key_context(if !self.multiline {
                INPUT_KEY_CONTEXT
            } else if self.emits_submit {
                TEXTAREA_SUBMIT_KEY_CONTEXT
            } else {
                TEXTAREA_KEY_CONTEXT
            })
            .track_focus(&self.focus_handle)
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::doc_start))
            .on_action(cx.listener(Self::doc_end))
            .on_action(cx.listener(Self::select_home))
            .on_action(cx.listener(Self::select_end))
            .on_action(cx.listener(Self::select_doc_start))
            .on_action(cx.listener(Self::select_doc_end))
            .on_action(cx.listener(Self::word_left))
            .on_action(cx.listener(Self::word_right))
            .on_action(cx.listener(Self::select_word_left))
            .on_action(cx.listener(Self::select_word_right))
            .on_action(cx.listener(Self::delete_word_left))
            .on_action(cx.listener(Self::delete_word_right))
            .on_action(cx.listener(Self::delete_to_line_start))
            .on_action(cx.listener(Self::delete_to_line_end))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::submit))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_scroll_wheel(cx.listener(Self::on_scroll_wheel))
            .when(self.emits_key_down, move |editor| {
                editor.on_key_down(move |event, _window, _cx| {
                    emit_event_full(&key_down_callback, element_id, "keyDown", |payload| {
                        payload.key = Some(event.keystroke.key.clone());
                        payload.key_char = event.keystroke.key_char.clone();
                        payload.is_held = Some(event.is_held);
                        payload.modifiers = Some(event.keystroke.modifiers.into());
                    });
                })
            })
            .when(self.emits_key_up, move |editor| {
                editor.on_key_up(move |event, _window, _cx| {
                    emit_event_full(&key_up_callback, element_id, "keyUp", |payload| {
                        payload.key = Some(event.keystroke.key.clone());
                        payload.key_char = event.keystroke.key_char.clone();
                        payload.modifiers = Some(event.keystroke.modifiers.into());
                    });
                })
            })
            .w_full()
            .min_w_0()
            .child(EditorTextElement {
                input: cx.entity(),
                min_rows: self.min_rows,
                max_rows: self.max_rows,
            })
    }
}

struct EditorTextElement {
    input: Entity<TextEditorState>,
    min_rows: usize,
    max_rows: usize,
}

struct EditorPrepaint {
    caret: Option<PaintQuad>,
    selection: Vec<PaintQuad>,
    decorations: Vec<PaintQuad>,
}

/// The one-to-three fill quads covering a text range on screen, identical to
/// how the editor paints its own selection: same line one rect, spanning
/// lines first-to-right-edge / full middle lines / last-from-left-edge.
fn range_quads(
    start: Point<Pixels>,
    end: Point<Pixels>,
    origin: Point<Pixels>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
    color: gpui::Hsla,
) -> Vec<PaintQuad> {
    if start.y == end.y {
        return vec![fill(
            Bounds::from_corners(
                point(origin.x + start.x, origin.y + start.y),
                point(origin.x + end.x, origin.y + start.y + line_height),
            ),
            color,
        )];
    }
    let mut quads = vec![fill(
        Bounds::from_corners(
            point(origin.x + start.x, origin.y + start.y),
            point(bounds.right(), origin.y + start.y + line_height),
        ),
        color,
    )];
    if end.y > start.y + line_height {
        quads.push(fill(
            Bounds::from_corners(
                point(origin.x, origin.y + start.y + line_height),
                point(bounds.right(), origin.y + end.y),
            ),
            color,
        ));
    }
    quads.push(fill(
        Bounds::from_corners(
            point(origin.x, origin.y + end.y),
            point(origin.x + end.x, origin.y + end.y + line_height),
        ),
        color,
    ));
    quads
}

impl gpui::Element for EditorTextElement {
    type RequestLayoutState = ();
    type PrepaintState = EditorPrepaint;

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.0).into();
        let input = self.input.clone();
        let text_style = window.text_style();
        let min_rows = self.min_rows;
        let max_rows = self.max_rows.max(min_rows);
        let layout = window.request_measured_layout(style, move |known, available, window, cx| {
            let width = known.width.unwrap_or(match available.width {
                gpui::AvailableSpace::Definite(width) => width,
                _ => px(320.0),
            });
            let (content_height, line_height) = input.update(cx, |input, _| {
                let content_height = input.layout_text(width, &text_style, window);
                (content_height, f32::from(input.line_height))
            });
            let height =
                content_height.clamp(min_rows as f32 * line_height, max_rows as f32 * line_height);
            size(width, px(height))
        });
        (layout, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        cx: &mut App,
    ) -> EditorPrepaint {
        self.input.update(cx, |input, _| {
            input.last_bounds = Some(bounds);
            input.clamp_scroll(f32::from(bounds.size.width), f32::from(bounds.size.height));
        });
        let input = self.input.read(cx);
        let origin = point(
            bounds.left() - px(input.scroll_left),
            bounds.top() - px(input.scroll_top),
        );
        let mut selection = Vec::new();
        let mut caret = None;
        if input.selected_range.is_empty() || input.display_is_placeholder {
            let caret_point = input
                .point_for_index(input.cursor_offset())
                .unwrap_or(point(px(0.0), px(0.0)));
            caret = Some(fill(
                caret_rect(
                    point(origin.x + caret_point.x, origin.y + caret_point.y),
                    input.line_height,
                    input.font_size,
                ),
                input.caret_color,
            ));
        } else if let (Some(start), Some(end)) = (
            input.point_for_index(input.selected_range.start),
            input.point_for_index(input.selected_range.end),
        ) {
            selection = range_quads(
                start,
                end,
                origin,
                bounds,
                input.line_height,
                gpui::rgba(0x7c86ff59).into(),
            );
        }
        let mut decorations = Vec::new();
        let mut decoration_rects = Vec::new();
        for deco in &input.decorations {
            let range = input.range_from_utf16(&(deco.start..deco.end));
            if let (Some(start), Some(end)) = (
                input.point_for_index(range.start.min(input.content.len())),
                input.point_for_index(range.end.min(input.content.len())),
            ) {
                let quads = range_quads(start, end, origin, bounds, input.line_height, deco.color);
                decoration_rects.push(DecorationRects {
                    start: deco.start,
                    end: deco.end,
                    color: u32::from(gpui::Rgba::from(deco.color)),
                    rects: quads.iter().map(|quad| quad.bounds).collect(),
                });
                decorations.extend(quads);
            }
        }
        let state = self.input.clone();
        state.update(cx, |input, _| {
            input.last_decoration_rects = decoration_rects;
        });
        EditorPrepaint {
            caret,
            selection,
            decorations,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepaint: &mut EditorPrepaint,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.input.read(cx).focus_handle.clone();
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        let input = self.input.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
            if phase == DispatchPhase::Bubble && event.pressed_button == Some(MouseButton::Left) {
                input.update(cx, |input, cx| input.on_mouse_move(event, cx));
            }
        });
        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            for quad in prepaint.selection.drain(..) {
                window.paint_quad(quad);
            }
            for quad in prepaint.decorations.drain(..) {
                window.paint_quad(quad);
            }
            let (lines, line_height, scroll_top, scroll_left, display, paint_backgrounds) =
                self.input.update(cx, |input, _| {
                    let display = if input.content.is_empty() {
                        input.placeholder.clone()
                    } else {
                        input.content.clone().into()
                    };
                    (
                        std::mem::take(&mut input.last_lines),
                        input.line_height,
                        input.scroll_top,
                        input.scroll_left,
                        display,
                        input.has_background_runs,
                    )
                });
            crate::text::log_painted_text(display);
            let mut y = bounds.top() - px(scroll_top);
            for line in &lines {
                let height = line.size(line_height).height;
                if paint_backgrounds {
                    line.paint_background(
                        point(bounds.left() - px(scroll_left), y),
                        line_height,
                        gpui::TextAlign::Left,
                        Some(bounds),
                        window,
                        cx,
                    )
                    .ok();
                }
                line.paint(
                    point(bounds.left() - px(scroll_left), y),
                    line_height,
                    gpui::TextAlign::Left,
                    Some(bounds),
                    window,
                    cx,
                )
                .ok();
                y += height;
            }
            self.input.update(cx, |input, _| input.last_lines = lines);
            let caret_shown = self
                .input
                .update(cx, |input, cx| input.caret_shown(window, cx));
            if caret_shown {
                if let Some(caret) = prepaint.caret.take() {
                    window.paint_quad(caret);
                }
            }
            self.input.update(cx, |input, _| {
                input.emit_selection_change();
            });
        });
    }
}

impl gpui::IntoElement for EditorTextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ime_offsets_are_relative_to_replacement_text() {
        assert_eq!(utf16_offset_to_utf8("é🙂", 0), 0);
        assert_eq!(utf16_offset_to_utf8("é🙂", 1), "é".len());
        assert_eq!(utf16_offset_to_utf8("é🙂", 3), "é🙂".len());
    }

    #[test]
    fn single_line_newlines_become_one_space() {
        assert_eq!(single_line_text("a\r\nb\nc\rd"), "a b c d");
    }

    #[test]
    fn caret_blink_phase() {
        assert!(caret_visible(0));
        assert!(caret_visible(CARET_BLINK_MS - 1));
        assert!(!caret_visible(CARET_BLINK_MS));
        assert!(!caret_visible(2 * CARET_BLINK_MS - 1));
        assert!(caret_visible(2 * CARET_BLINK_MS));
    }

    #[test]
    fn caret_matches_the_font_size_inside_the_line() {
        let bounds = caret_rect(point(px(10.0), px(4.0)), px(20.0), px(16.0));
        assert_eq!(bounds.origin, point(px(10.0), px(8.0)));
        assert_eq!(bounds.size, size(px(2.0), px(12.0)));
        assert_eq!(
            caret_rect(point(px(0.0), px(0.0)), px(20.0), px(40.0))
                .size
                .height,
            px(20.0)
        );
    }

    fn has_binding(bindings: &[KeyBinding], keystroke: &str, action: &dyn gpui::Action) -> bool {
        let keystroke = gpui::Keystroke::parse(keystroke).unwrap();
        bindings.iter().any(|binding| {
            binding.match_keystrokes(std::slice::from_ref(&keystroke)) == Some(false)
                && binding.action().partial_eq(action)
        })
    }

    #[test]
    fn textarea_enter_inserts_a_newline_unless_on_submit_is_set() {
        let textarea = text_editor_bindings(TEXTAREA_KEY_CONTEXT, true, false);
        assert!(has_binding(&textarea, "enter", &Newline));
        assert!(has_binding(&textarea, "shift-enter", &Newline));
        assert!(!has_binding(&textarea, "enter", &Submit));

        let composer = text_editor_bindings(TEXTAREA_SUBMIT_KEY_CONTEXT, true, true);
        assert!(has_binding(&composer, "enter", &Submit));
        assert!(has_binding(&composer, "shift-enter", &Newline));
        assert!(!has_binding(&composer, "enter", &Newline));

        let input = text_editor_bindings(INPUT_KEY_CONTEXT, false, true);
        assert!(has_binding(&input, "enter", &Submit));
        assert!(!has_binding(&input, "enter", &Newline));
    }

    #[test]
    fn caret_color_comes_from_the_input_theme() {
        let mut input = TextEditorElement::new(false);
        input.set_prop("theme", serde_json::json!({ "caret": "#22c55e" }));
        assert_eq!(input.theme.caret, gpui::rgba(0x22c55eff).into());
    }

    #[test]
    fn insertion_undo_coalescing_requires_one_contiguous_non_whitespace_character() {
        let insert_at_one = CoalescingEdit {
            kind: EditKind::Insert,
            anchor: 1,
        };

        assert_eq!(coalescing_edit(&(0..0), "a", false), Some(insert_at_one));
        assert!(edits_coalesce(
            insert_at_one,
            coalescing_edit(&(1..1), "b", false),
            &(1..1),
            Duration::from_millis(699),
        ));
        assert!(!edits_coalesce(
            insert_at_one,
            coalescing_edit(&(2..2), "b", false),
            &(2..2),
            Duration::from_millis(699),
        ));
        assert_eq!(coalescing_edit(&(0..1), "a", false), None);
        assert_eq!(coalescing_edit(&(1..1), "ab", false), None);
        assert_eq!(coalescing_edit(&(1..1), " ", false), None);
        assert_eq!(coalescing_edit(&(1..1), "\n", false), None);
        assert_eq!(coalescing_edit(&(1..1), "\t", false), None);
        assert_eq!(coalescing_edit(&(1..1), "\u{2003}", false), None);
        assert!(!edits_coalesce(
            insert_at_one,
            coalescing_edit(&(1..1), "b", false),
            &(1..1),
            UNDO_COALESCE,
        ));
        assert!(!edits_coalesce(
            CoalescingEdit {
                kind: EditKind::DeleteBackward,
                anchor: 1,
            },
            coalescing_edit(&(1..1), "b", false),
            &(1..1),
            Duration::from_millis(1),
        ));
        assert!(!edits_coalesce(
            insert_at_one,
            None,
            &(1..1),
            Duration::from_millis(1),
        ));
    }

    #[test]
    fn backward_and_forward_deletions_use_their_own_contiguity_rules() {
        let backward = CoalescingEdit {
            kind: EditKind::DeleteBackward,
            anchor: 3,
        };
        assert_eq!(
            coalescing_edit(&(2..3), "", true),
            Some(CoalescingEdit {
                kind: EditKind::DeleteBackward,
                anchor: 2,
            })
        );
        assert!(edits_coalesce(
            backward,
            coalescing_edit(&(2..3), "", true),
            &(2..3),
            Duration::from_millis(699),
        ));
        assert!(!edits_coalesce(
            backward,
            coalescing_edit(&(1..2), "", true),
            &(1..2),
            Duration::from_millis(699),
        ));

        let forward = CoalescingEdit {
            kind: EditKind::DeleteForward,
            anchor: 2,
        };
        assert_eq!(coalescing_edit(&(2..3), "", false), Some(forward));
        assert!(edits_coalesce(
            forward,
            coalescing_edit(&(2..3), "", false),
            &(2..3),
            Duration::from_millis(699),
        ));
        assert!(!edits_coalesce(
            forward,
            coalescing_edit(&(3..4), "", false),
            &(3..4),
            Duration::from_millis(699),
        ));
        assert!(!edits_coalesce(
            forward,
            coalescing_edit(&(2..3), "", false),
            &(2..3),
            UNDO_COALESCE,
        ));
        assert_eq!(coalescing_edit(&(2..2), "", false), None);
    }

    #[test]
    fn undo_history_discards_only_the_oldest_snapshot_at_the_limit() {
        let mut history = VecDeque::new();
        for index in 0..=UNDO_LIMIT {
            push_undo_snapshot(
                &mut history,
                EditSnapshot {
                    content: index.to_string(),
                    selected_range: index..index,
                    selection_reversed: false,
                },
            );
        }

        assert_eq!(history.len(), UNDO_LIMIT);
        assert_eq!(history.front().unwrap().content, "1");
        assert_eq!(history.back().unwrap().content, UNDO_LIMIT.to_string());
    }

    #[test]
    fn drag_autoscroll_is_edge_proportional_and_capped_to_one_line() {
        let line_height = 20.0;
        assert_eq!(drag_scroll_delta(200.0, 100.0, 300.0, line_height), 0.0);
        assert_eq!(drag_scroll_delta(90.0, 100.0, 300.0, line_height), -2.0);
        assert_eq!(drag_scroll_delta(315.0, 100.0, 300.0, line_height), 3.0);
        assert_eq!(drag_scroll_delta(-100.0, 100.0, 300.0, line_height), -20.0);
        assert_eq!(drag_scroll_delta(500.0, 100.0, 300.0, line_height), 20.0);
    }

    #[test]
    fn multi_click_selects_word_then_all_and_does_not_arm_drag() {
        assert_eq!(press_intent(1, false), PressIntent::PlaceCaret);
        assert_eq!(press_intent(1, true), PressIntent::ExtendSelection);
        assert_eq!(press_intent(2, false), PressIntent::SelectWord);
        assert_eq!(press_intent(2, true), PressIntent::SelectWord);
        assert_eq!(press_intent(3, false), PressIntent::SelectAll);
        assert!(press_intent(1, false).arms_drag());
        assert!(press_intent(1, true).arms_drag());
        assert!(!press_intent(2, false).arms_drag());
        assert!(!press_intent(3, false).arms_drag());
    }
}
