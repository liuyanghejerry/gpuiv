//! `<markdown>` — GitHub-flavoured markdown rendered natively and selectable.
//!
//! ```tsx
//! <markdown source={text} theme={{ accent: '#7c86ff' }} onLinkClick={(e) => {}} />
//! ```
//!
//! Every paragraph, heading, table cell and code line registers into the shared
//! selection registry in document order, so a drag can start in a heading and
//! end inside a fenced code block, and Cmd+C copies the whole span.

use std::collections::HashMap;
use std::sync::Arc;

use gpui::SharedString;

use super::{CustomElement, CustomElementFactory, CustomRenderContext};
use crate::markdown::parser::{BlockTree, IncrementalParser, TaskMarker};
use crate::markdown::render::{render_tree, MdContext};
use crate::renderer::emit_event_full;
use crate::theme::{Theme, ThemeFonts};

pub struct MarkdownFactory;

impl CustomElementFactory for MarkdownFactory {
    fn element_type(&self) -> &str {
        "markdown"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(MarkdownElement::default())
    }
}

#[derive(Default)]
pub struct MarkdownElement {
    source: String,
    theme: Theme,
    /// Pre-rendered display formulas (TeX → px-sized SVG), keyed by TeX.
    /// Populated from the `math` prop; `renderMathMap` in `@gpuiv/vue/math`
    /// is the producer.
    math: HashMap<String, crate::markdown::render::MathSpec>,
    /// Pre-rendered mermaid diagrams, keyed by the fence's trimmed source.
    /// Populated from the `mermaid` prop; the producer is app-side — there is
    /// no in-process mermaid renderer.
    mermaid: HashMap<String, crate::markdown::render::MermaidSpec>,
    /// Streaming parse state: an append to `source` reparses only from the
    /// last stable top-level block boundary, so a token-by-token feed costs
    /// O(tail), not O(document). Sources that stop being a prefix extension
    /// reset to a full parse. A same-source frame is a no-op (one `str`
    /// compare, no hashing).
    parser: IncrementalParser,
}

impl MarkdownElement {
    fn tree(&mut self) -> &BlockTree {
        if self.parser.source() != self.source {
            self.parser.set_text(&self.source);
        }
        self.parser.tree()
    }
}

impl CustomElement for MarkdownElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let theme = self.theme.clone();
        let math = self.math.clone();
        let mermaid = self.mermaid.clone();
        let tree = self.tree();

        // Link clicks are hit-tested per byte range inside the painted text, so
        // clicking prose emits nothing and clicking the second link emits the
        // second URL.
        let on_link: Option<Arc<dyn Fn(&str)>> = if ctx.events.contains("linkClick") {
            let callback = ctx.event_callback.clone();
            let element_id = ctx.id;
            Some(Arc::new(move |url: &str| {
                let url = url.to_string();
                emit_event_full(&callback, element_id, "linkClick", |p| {
                    p.value = Some(url);
                });
            }))
        } else {
            None
        };

        // Task toggles ride the same event callback as links but as their own
        // event type: the payload carries the marker's rendered state and its
        // source byte range, so the app can rewrite `[ ]`↔`[x]` in place.
        let on_task: Option<Arc<dyn Fn(&TaskMarker)>> = if ctx.events.contains("taskToggle") {
            let callback = ctx.event_callback.clone();
            let element_id = ctx.id;
            Some(Arc::new(move |task: &TaskMarker| {
                let (checked, start, end) = (task.checked, task.range.start, task.range.end);
                emit_event_full(&callback, element_id, "taskToggle", |p| {
                    p.value = Some(if checked { "true".into() } else { "false".into() });
                    p.start_index = Some(start as f64);
                    p.end_index = Some(end as f64);
                });
            }))
        } else {
            None
        };

        let mut md = MdContext::new(
            ctx.id,
            ctx.selection.clone(),
            ctx.selectable,
            ctx.selection_wash,
            theme.clone(),
            on_link,
            on_task,
            ctx.highlight_set.clone(),
            math,
            mermaid,
        );
        let body = render_tree(tree, &mut md, window);

        let container = gpui::div()
            .id(SharedString::from(format!("__gpuix_markdown_{}", ctx.id)))
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .text_color(theme.text)
            .theme_sans(&theme)
            .text_size(gpui::px(theme.metrics.md_text_size))
            .line_height(gpui::px(theme.metrics.md_line_height));

        super::custom_surface(container, &ctx)
            .child(body)
            .into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "source" => self.source = value.as_str().unwrap_or("").to_string(),
            "theme" => self.theme = Theme::from_prop(Some(&value)),
            "math" => self.math = crate::markdown::render::math_map_from_prop(&value),
            "mermaid" => {
                self.mermaid = crate::markdown::render::mermaid_map_from_prop(&value);
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["source", "theme", "math", "mermaid"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["linkClick", "taskToggle", "click", "mouseEnter", "mouseLeave", "fileDrop"]
    }

    fn destroy(&mut self) {
        // The parser (and its tree) drops with the element; nothing else
        // holds shared state that needs unlinking here.
    }
}
