//! Building `gpui::TextRun` lists.
//!
//! The invariant that makes late-arriving syntax highlighting free: every run
//! for a line uses the **same font**, only the colour differs. Recolouring can
//! then never change layout, so a highlight result can land a frame later
//! without reflowing anything.
//!
//! Ported from Comet (https://github.com/zeronsh/comet), MIT.
//! Original: `runs_for_syntax_line_with_plain` in `crates/ui/src/markdown/render.rs`.

use gpui::{Font, Hsla, TextRun};

/// A single run covering the whole string.
#[allow(dead_code)]
pub fn plain_runs(text: &str, font: &Font, color: Hsla) -> Vec<TextRun> {
    if text.is_empty() {
        return Vec::new();
    }
    vec![TextRun {
        len: text.len(),
        font: font.clone(),
        color,
        background_color: None,
        underline: None,
        strikethrough: None,
    }]
}

/// Build the exact-cover run list for one line from its highlight spans.
///
/// `spans` must be sorted and non-overlapping, with byte ranges relative to
/// `line`. Gaps become `plain_color`. The returned runs sum to `line.len()`.
pub fn runs_for_spans(
    line: &str,
    spans: &[(std::ops::Range<usize>, Hsla)],
    font: &Font,
    plain_color: Hsla,
) -> Vec<TextRun> {
    let plain = |len: usize, color: Hsla| TextRun {
        len,
        font: font.clone(),
        color,
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let mut runs = Vec::with_capacity(spans.len() * 2 + 1);
    let mut at = 0usize;
    for (range, color) in spans {
        // Defensive: a stale highlight for a shorter line must not slice past
        // the end or emit an inverted run.
        let start = range.start.min(line.len()).max(at);
        let end = range.end.min(line.len());
        if end <= start {
            continue;
        }
        if start > at {
            runs.push(plain(start - at, plain_color));
        }
        runs.push(plain(end - start, *color));
        at = end;
    }
    if at < line.len() {
        runs.push(plain(line.len() - at, plain_color));
    }
    runs.retain(|run| run.len > 0);
    runs
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{font, hsla};

    fn mono() -> Font {
        font("Menlo")
    }

    fn red() -> Hsla {
        hsla(0.0, 1.0, 0.5, 1.0)
    }

    fn white() -> Hsla {
        hsla(0.0, 0.0, 1.0, 1.0)
    }

    #[test]
    fn runs_cover_the_line_exactly() {
        let line = "let x = 1;";
        let runs = runs_for_spans(line, &[(0..3, red()), (8..9, red())], &mono(), white());
        assert_eq!(runs.iter().map(|r| r.len).sum::<usize>(), line.len());
        assert!(runs.iter().all(|r| r.font == mono()));
        assert_eq!(runs[0].color, red());
        assert_eq!(runs[1].color, white());
    }

    #[test]
    fn no_spans_is_one_plain_run() {
        let runs = runs_for_spans("plain text", &[], &mono(), white());
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].len, 10);
    }

    #[test]
    fn stale_spans_past_the_end_are_clipped() {
        let line = "ab";
        let runs = runs_for_spans(line, &[(0..99, red())], &mono(), white());
        assert_eq!(runs.iter().map(|r| r.len).sum::<usize>(), line.len());
    }

    #[test]
    fn overlapping_spans_do_not_double_count() {
        let line = "abcdef";
        let runs = runs_for_spans(line, &[(0..4, red()), (2..6, red())], &mono(), white());
        assert_eq!(runs.iter().map(|r| r.len).sum::<usize>(), line.len());
    }

    #[test]
    fn empty_text_has_no_runs() {
        assert!(plain_runs("", &mono(), white()).is_empty());
    }
}

// ── Host `<text runs={…}>` ───────────────────────────────────────────

/// A `<text runs={…}>` prop parsed into shaped-text inputs: the segments
/// concatenated in order plus one `gpui::TextRun` per non-empty segment.
pub struct HostTextRuns {
    pub text: String,
    pub runs: Vec<TextRun>,
}

/// The concatenated segment text of a `runs` prop, without styling — the
/// accessibility value of a host `<text runs={…}>`, which has no child text
/// nodes to join.
pub fn host_runs_text(value: &serde_json::Value) -> Option<String> {
    let items = value.as_array()?;
    let mut text = String::new();
    for item in items {
        text.push_str(item.get("text").and_then(serde_json::Value::as_str).unwrap_or(""));
    }
    (!text.is_empty()).then_some(text)
}

/// Parse the `runs` custom prop of a host `<text>`.
///
/// Each item is `{ text, color?, fontWeight?, fontStyle?, fontFamily?,
/// underline?, strikethrough?, backgroundColor? }`. Attributes left unset
/// fall back to `base_font` / `base_color` — the element's own resolved
/// style, supplied by the caller. Sizes stay element-level: like the
/// markdown inline pipeline, per-run font size is deliberately not offered
/// because a size change would reflow the line.
///
/// `underline` / `strikethrough` accept `true` (the run's own colour, 1px)
/// or `{ color?, thickness?, wavy? }`. A non-array value, or an array whose
/// segments are all empty, yields `None`; the host builder decides whether
/// plain text should paint based on the presence of a valid `runs` array.
pub fn parse_host_runs(value: &serde_json::Value, base_font: Font, base_color: Hsla) -> Option<HostTextRuns> {
    let items = value.as_array()?;
    let mut text = String::new();
    let mut runs: Vec<TextRun> = Vec::with_capacity(items.len());
    for item in items {
        let segment = item.get("text").and_then(serde_json::Value::as_str).unwrap_or("");
        if segment.is_empty() {
            continue;
        }
        let mut font = base_font.clone();
        if let Some(family) = item.get("fontFamily").and_then(serde_json::Value::as_str) {
            font.family = family.into();
        }
        if let Some(weight) = item.get("fontWeight") {
            if let Ok(weight) = serde_json::from_value::<crate::style::FontWeightValue>(weight.clone()) {
                font.weight = crate::renderer::parse_font_weight(&weight);
            }
        }
        if item.get("fontStyle").and_then(serde_json::Value::as_str) == Some("italic") {
            font.style = gpui::FontStyle::Italic;
        }
        let color = item
            .get("color")
            .and_then(serde_json::Value::as_str)
            .and_then(crate::color::parse_color_rgba)
            .map(Hsla::from)
            .unwrap_or(base_color);
        let underline = parse_decoration(
            item.get("underline"),
            color,
            |color, thickness, wavy| gpui::UnderlineStyle { color: Some(color), thickness, wavy },
        );
        let strikethrough = parse_decoration(
            item.get("strikethrough"),
            color,
            |color, thickness, _wavy| gpui::StrikethroughStyle { color: Some(color), thickness },
        );
        let background = item
            .get("backgroundColor")
            .and_then(serde_json::Value::as_str)
            .and_then(crate::color::parse_color_rgba)
            .map(Hsla::from);
        let start = text.len();
        text.push_str(segment);
        runs.push(TextRun {
            len: text.len() - start,
            font,
            color,
            background_color: background,
            underline,
            strikethrough,
        });
    }
    if text.is_empty() {
        return None;
    }
    Some(HostTextRuns { text, runs })
}

/// `true` → the run's colour at 1px; an object refines colour / thickness
/// (`wavy` only exists for underlines and is ignored for strikethrough).
fn parse_decoration<T>(
    value: Option<&serde_json::Value>,
    run_color: Hsla,
    build: impl Fn(Hsla, gpui::Pixels, bool) -> T,
) -> Option<T> {
    match value? {
        serde_json::Value::Bool(true) => Some(build(run_color, gpui::px(1.0), false)),
        serde_json::Value::Object(fields) => {
            let color = fields
                .get("color")
                .and_then(serde_json::Value::as_str)
                .and_then(crate::color::parse_color_rgba)
                .map(Hsla::from)
                .unwrap_or(run_color);
            let thickness = fields
                .get("thickness")
                .and_then(serde_json::Value::as_f64)
                .map(|t| gpui::px(t.max(0.0) as f32))
                .unwrap_or(gpui::px(1.0));
            let wavy = fields.get("wavy").and_then(serde_json::Value::as_bool).unwrap_or(false);
            Some(build(color, thickness, wavy))
        }
        _ => None,
    }
}

#[cfg(test)]
mod host_runs_tests {
    use super::*;
    use gpui::{font, hsla};

    fn value(json: serde_json::Value) -> serde_json::Value {
        json
    }

    #[test]
    fn host_runs_concatenate_segments_and_default_to_base_style() {
        let base_font = font("Helvetica");
        let base_color = hsla(0.2, 0.3, 0.4, 1.0);
        let parsed = parse_host_runs(
            &value(serde_json::json!([
                { "text": "plain " },
                { "text": "bold", "fontWeight": 700 },
                { "text": " red", "color": "#ff0000" },
            ])),
            base_font.clone(),
            base_color,
        )
        .unwrap();

        assert_eq!(parsed.text, "plain bold red");
        assert_eq!(parsed.runs.len(), 3);
        assert!(parsed.runs.iter().map(|r| r.len).sum::<usize>() >= parsed.text.len());
        assert_eq!(parsed.runs[0].font.weight, gpui::FontWeight(400.0));
        assert_eq!(parsed.runs[0].color, base_color);
        assert_eq!(parsed.runs[1].font.weight, gpui::FontWeight(700.0));
        assert_eq!(parsed.runs[1].font.family, base_font.family);
        assert_ne!(parsed.runs[2].color, base_color);
    }

    #[test]
    fn host_runs_parse_decorations_and_italics() {
        let parsed = parse_host_runs(
            &value(serde_json::json!([
                { "text": "warn", "underline": { "wavy": true, "thickness": 2 } },
                { "text": "gone", "strikethrough": true, "fontStyle": "italic" },
                { "text": "bg", "backgroundColor": "#112233" },
            ])),
            font("Helvetica"),
            hsla(0.0, 0.0, 1.0, 1.0),
        )
        .unwrap();

        let underline = parsed.runs[0].underline.unwrap();
        assert!(underline.wavy);
        assert_eq!(underline.thickness, gpui::px(2.0));
        assert_eq!(underline.color, Some(parsed.runs[0].color));

        assert!(parsed.runs[1].strikethrough.is_some());
        assert_eq!(parsed.runs[1].font.style, gpui::FontStyle::Italic);

        assert!(parsed.runs[2].background_color.is_some());
        assert_eq!(parsed.runs[2].underline, None);
    }

    #[test]
    fn host_runs_reject_non_arrays_and_empty_text() {
        let base = (font("Helvetica"), hsla(0.0, 0.0, 1.0, 1.0));
        assert!(parse_host_runs(&value(serde_json::json!("nope")), base.0.clone(), base.1).is_none());
        assert!(parse_host_runs(&value(serde_json::json!([])), base.0.clone(), base.1).is_none());
        assert!(parse_host_runs(
            &value(serde_json::json!([{ "text": "" }, { "text": "" }])),
            base.0,
            base.1
        )
        .is_none());
    }

    #[test]
    fn host_runs_text_joins_segments() {
        assert_eq!(
            host_runs_text(&value(serde_json::json!([{ "text": "a" }, { "text": "b" }]))),
            Some("ab".to_string())
        );
        assert_eq!(host_runs_text(&value(serde_json::json!([]))), None);
    }
}
