use serde::{Deserialize, Deserializer, Serialize};

/// Font weight value — accepts both CSS strings ("bold", "700") and numbers (700).
/// JS style objects commonly use both `fontWeight: "bold"` and `fontWeight: 700`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FontWeightValue {
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxShadowValue {
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur_radius: f64,
    pub spread_radius: f64,
    pub color: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub inset: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

impl BoxShadowValue {
    fn resolved_shadow(&self) -> Option<gpui::BoxShadow> {
        let color = crate::color::parse_color_rgba(&self.color)?;
        let shadow = gpui::BoxShadow::new(
            gpui::px(self.offset_x as f32),
            gpui::px(self.offset_y as f32),
            color.into(),
        )
        .blur_radius(gpui::px(self.blur_radius.max(0.0) as f32))
        .spread_radius(gpui::px(self.spread_radius as f32));
        Some(if self.inset { shadow.inset() } else { shadow })
    }
}

/// Keep the original single-shadow wire shape while exposing GPUI's complete
/// shadow list, including an empty list that explicitly clears base shadows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BoxShadowListValue {
    Single(BoxShadowValue),
    Multiple(Vec<BoxShadowValue>),
}

impl BoxShadowListValue {
    pub(crate) fn resolved_shadows(&self) -> Option<Vec<gpui::BoxShadow>> {
        match self {
            Self::Single(shadow) => shadow.resolved_shadow().map(|shadow| vec![shadow]),
            Self::Multiple(shadows) => Some(
                shadows
                    .iter()
                    // CSS lists the top shadow first; GPUI paints Vec entries
                    // in sequence, so the last entry sits on top in each group.
                    .rev()
                    .filter_map(BoxShadowValue::resolved_shadow)
                    .collect(),
            ),
        }
    }
}

/// CSS `outline`: a line outside the border box that takes no layout space.
/// `offset` may be negative to draw the line inside the box.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineValue {
    pub width: f64,
    pub color: String,
    #[serde(default)]
    pub offset: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearGradientStopValue {
    pub color: String,
    pub position: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum GradientValue {
    #[serde(rename = "linear-gradient")]
    LinearGradient {
        angle: f64,
        stops: [LinearGradientStopValue; 2],
        #[serde(rename = "colorSpace")]
        color_space: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BackgroundValue {
    Color(String),
    Gradient(Box<GradientValue>),
}

/// A dimension value that can be a number (pixels) or a string (percentage, auto, etc.)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum DimensionValue {
    Pixels(f64),
    Percentage(f64), // 0.0 to 1.0
    Auto,
}

impl Default for DimensionValue {
    fn default() -> Self {
        DimensionValue::Auto
    }
}

impl<'de> Deserialize<'de> for DimensionValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde::de::{self, Visitor};

        struct DimensionVisitor;

        impl<'de> Visitor<'de> for DimensionVisitor {
            type Value = DimensionValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a number or a string like '100%' or 'auto'")
            }

            fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(v))
            }

            fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(v as f64))
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DimensionValue::Pixels(v as f64))
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if v == "auto" {
                    Ok(DimensionValue::Auto)
                } else if v.ends_with('%') {
                    let num_str = v.trim_end_matches('%');
                    match num_str.parse::<f64>() {
                        Ok(n) => Ok(DimensionValue::Percentage(n / 100.0)),
                        Err(_) => Err(de::Error::custom(format!("invalid percentage: {}", v))),
                    }
                } else {
                    // Try to parse as a number
                    match v.parse::<f64>() {
                        Ok(n) => Ok(DimensionValue::Pixels(n)),
                        Err(_) => Err(de::Error::custom(format!("invalid dimension: {}", v))),
                    }
                }
            }
        }

        deserializer.deserialize_any(DimensionVisitor)
    }
}

/// Style description that can be serialized from JS
/// Note: This is only used for JSON deserialization, not direct napi binding
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDesc {
    // Display
    pub display: Option<String>,
    pub visibility: Option<String>,

    // Flexbox
    pub flex_direction: Option<String>,
    pub flex_wrap: Option<String>,
    pub flex_grow: Option<f64>,
    pub flex_shrink: Option<f64>,
    pub flex_basis: Option<f64>,
    pub align_items: Option<String>,
    pub align_self: Option<String>,
    pub align_content: Option<String>,
    pub justify_content: Option<String>,
    pub gap: Option<f64>,
    pub row_gap: Option<f64>,
    pub column_gap: Option<f64>,
    pub grid_template_columns: Option<f64>,
    pub grid_template_rows: Option<f64>,
    pub grid_column_min: Option<String>,
    pub grid_row_min: Option<String>,

    // Sizing - now supports both numbers and strings like "100%" or "auto"
    pub width: Option<DimensionValue>,
    pub height: Option<DimensionValue>,
    /// Width divided by height, applied to whichever axis is not definite.
    pub aspect_ratio: Option<f64>,
    pub min_width: Option<DimensionValue>,
    pub min_height: Option<DimensionValue>,
    pub max_width: Option<DimensionValue>,
    pub max_height: Option<DimensionValue>,

    // Spacing (padding)
    pub padding: Option<f64>,
    pub padding_top: Option<f64>,
    pub padding_right: Option<f64>,
    pub padding_bottom: Option<f64>,
    pub padding_left: Option<f64>,

    // Spacing (margin)
    pub margin: Option<f64>,
    pub margin_top: Option<f64>,
    pub margin_right: Option<f64>,
    pub margin_bottom: Option<f64>,
    pub margin_left: Option<f64>,

    // Position
    pub position: Option<String>,
    pub top: Option<f64>,
    pub right: Option<f64>,
    pub bottom: Option<f64>,
    pub left: Option<f64>,

    // Background & Colors
    pub background: Option<BackgroundValue>,
    pub background_color: Option<String>,
    pub color: Option<String>,
    pub opacity: Option<f64>,
    /// CSS filter list. Consumed by `<img>`; other elements ignore it.
    pub filter: Option<String>,

    // Border
    pub border_width: Option<f64>,
    pub border_top_width: Option<f64>,
    pub border_right_width: Option<f64>,
    pub border_bottom_width: Option<f64>,
    pub border_left_width: Option<f64>,
    pub border_color: Option<String>,
    /// `"solid"` or `"dashed"`, for every side.
    pub border_style: Option<String>,
    pub border_radius: Option<f64>,
    pub border_top_left_radius: Option<f64>,
    pub border_top_right_radius: Option<f64>,
    pub border_bottom_left_radius: Option<f64>,
    pub border_bottom_right_radius: Option<f64>,
    pub box_shadow: Option<BoxShadowListValue>,
    pub outline: Option<OutlineValue>,

    // Text
    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub font_weight: Option<FontWeightValue>,
    pub text_align: Option<String>,
    pub line_height: Option<f64>,
    pub white_space: Option<String>,
    pub text_overflow: Option<String>,
    pub line_clamp: Option<f64>,

    // Overflow
    pub overflow: Option<String>,
    pub overflow_x: Option<String>,
    pub overflow_y: Option<String>,
    /// Thumb colour for a container that scrolls (`overflow: "scroll"`).
    /// Setting it is what turns the native scrollbar on.
    pub scrollbar_color: Option<String>,
    /// Thickness of that thumb in px. Defaults to 6.
    pub scrollbar_width: Option<f64>,

    // Cursor
    pub cursor: Option<String>,
    /// `"auto"` blocks mouse hits behind this element. `"none"` never does.
    /// Unset: block when this element paints a fill or is absolutely positioned.
    pub pointer_events: Option<String>,

    // Text selection. "none" opts an element and its subtree out of the
    // selection registry, so buttons and toolbars never start a drag.
    // Inherited down the tree like the CSS property of the same name.
    pub user_select: Option<String>,
    /// Selection wash colour for this subtree. Defaults to the theme accent at
    /// 35% opacity, the same tone Comet uses.
    pub selection_color: Option<String>,

    // Pseudo-selector styles — applied by GPUI natively (no JS round-trip).
    // Uses Box to avoid infinite-size struct (StyleDesc contains StyleDesc).
    pub hover: Option<Box<StyleDesc>>,
    pub active: Option<Box<StyleDesc>>,
}

pub use crate::color::{parse_color, parse_color_hex};

impl BackgroundValue {
    fn resolve(&self) -> Option<gpui::Background> {
        match self {
            Self::Color(value) => crate::color::parse_color_rgba(value).map(Into::into),
            Self::Gradient(gradient) => {
                let GradientValue::LinearGradient {
                    angle,
                    stops,
                    color_space,
                } = gradient.as_ref();
                let angle = *angle as f32;
                let [from, to] = stops;
                let from_position = from.position as f32;
                let to_position = to.position as f32;
                if !angle.is_finite()
                    || !(0.0..=1.0).contains(&from_position)
                    || !(0.0..=1.0).contains(&to_position)
                {
                    return None;
                }

                let color_space = match color_space.as_deref() {
                    None | Some("srgb") => gpui::ColorSpace::Srgb,
                    Some("oklab") => gpui::ColorSpace::Oklab,
                    _ => return None,
                };
                Some(
                    gpui::linear_gradient(
                        angle,
                        gpui::linear_color_stop(
                            crate::color::parse_color_rgba(&from.color)?,
                            from_position,
                        ),
                        gpui::linear_color_stop(
                            crate::color::parse_color_rgba(&to.color)?,
                            to_position,
                        ),
                    )
                    .color_space(color_space),
                )
            }
        }
    }
}

impl StyleDesc {
    pub(crate) fn has_background(&self) -> bool {
        self.background_color.is_some() || self.background.is_some()
    }

    pub(crate) fn resolved_background(&self) -> Option<gpui::Background> {
        if let Some(value) = self.background_color.as_deref() {
            return crate::color::parse_color_rgba(value).map(Into::into);
        }
        self.background.as_ref()?.resolve()
    }
}

/// Whether this style should insert a mouse hitbox.
///
/// GPUI only hit-tests elements that own a hitbox. A painted overlay without
/// one stays visible while clicks fall through. CSS `pointer-events` maps
/// here: `none` never blocks, `auto` always does. Unset follows the painted
/// surface: a fill or an absolute/fixed box blocks.
///
/// In-flow fills use BlockMouseExceptScroll so a parent scroller still gets
/// the wheel. `occlude()` (BlockMouse) is only for overlays that steal it.
pub fn should_occlude(style: &StyleDesc) -> bool {
    match style.pointer_events.as_deref() {
        Some("none") => return false,
        Some("auto") => return true,
        _ => {}
    }
    if matches!(style.position.as_deref(), Some("absolute") | Some("fixed")) {
        return true;
    }
    if !style.has_background() {
        return false;
    }
    match style.resolved_background() {
        Some(background) => !background.is_transparent(),
        None => true,
    }
}

/// Map a CSS cursor keyword onto the gpui [`gpui::CursorStyle`] it controls.
///
/// Keywords named by the gpui variants map 1:1. The approximations follow
/// gpui's own tailwind-style helpers: `move` is `ClosedHand` and `no-drop` is
/// `OperationNotAllowed`. The single-direction diagonals reuse the matching
/// double-headed diagonal (`ne`/`sw` → NESW, `nw`/`se` → NWSE), which is what
/// macOS renders either way. `auto` resolves to the platform default, like an
/// unset cursor.
///
/// Returns `None` for anything else — including CSS keywords with no gpui
/// counterpart (`none`, `url(..)`, `wait`, `progress`, `help`, `cell`,
/// `zoom-in`, `zoom-out`) — so the caller can warn instead of staying silent.
pub fn parse_cursor_style(value: &str) -> Option<gpui::CursorStyle> {
    let style = match value {
        "auto" | "default" => gpui::CursorStyle::Arrow,
        "pointer" => gpui::CursorStyle::PointingHand,
        "text" => gpui::CursorStyle::IBeam,
        "vertical-text" => gpui::CursorStyle::IBeamCursorForVerticalLayout,
        "crosshair" => gpui::CursorStyle::Crosshair,
        "grab" | "all-scroll" => gpui::CursorStyle::OpenHand,
        "grabbing" | "move" => gpui::CursorStyle::ClosedHand,
        "context-menu" => gpui::CursorStyle::ContextualMenu,
        "not-allowed" | "no-drop" => gpui::CursorStyle::OperationNotAllowed,
        "alias" => gpui::CursorStyle::DragLink,
        "copy" => gpui::CursorStyle::DragCopy,
        "col-resize" => gpui::CursorStyle::ResizeColumn,
        "row-resize" => gpui::CursorStyle::ResizeRow,
        "ew-resize" => gpui::CursorStyle::ResizeLeftRight,
        "ns-resize" => gpui::CursorStyle::ResizeUpDown,
        "nesw-resize" | "ne-resize" | "sw-resize" => gpui::CursorStyle::ResizeUpRightDownLeft,
        "nwse-resize" | "nw-resize" | "se-resize" => gpui::CursorStyle::ResizeUpLeftDownRight,
        "n-resize" => gpui::CursorStyle::ResizeUp,
        "e-resize" => gpui::CursorStyle::ResizeRight,
        "s-resize" => gpui::CursorStyle::ResizeDown,
        "w-resize" => gpui::CursorStyle::ResizeLeft,
        _ => return None,
    };
    Some(style)
}

/// Styles are re-applied on every frame, so an unsupported cursor value would
/// warn per frame. Deduplicate and warn once per distinct value. Returns
/// whether this call was the first one for `value`.
pub fn warn_unsupported_cursor(value: &str) -> bool {
    use std::collections::HashSet;
    use std::sync::{Mutex, OnceLock};
    static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let mut warned = WARNED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !warned.insert(value.to_owned()) {
        return false;
    }
    log::warn!(
        "ignoring unsupported cursor {value:?}: CSS cursors without a gpui counterpart \
         (none, url(..), wait, progress, help, cell, zoom-in, zoom-out) are not applied"
    );
    true
}

/// Padding + border pixels on each side of an element's box.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EdgeInsets {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// Padding and border insets of an element, split so the automation bounds
/// tracker can translate its record canvas back to the border box.
///
/// The tracker's canvas is absolutely positioned at the element's
/// content-box origin (border + padding inside) and sized to the padding box
/// (border box minus border). Getting the real box back therefore needs each
/// side's padding + border for the origin, but only the border for the size.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BoundsInsets {
    pub padding: EdgeInsets,
    pub border: EdgeInsets,
}

/// Resolve an element's padding and border pixels, with the same precedence
/// as `apply_styles`: a per-side value overrides the shorthand.
pub fn bounds_insets(style: &StyleDesc) -> BoundsInsets {
    let side = |value: Option<f64>, shorthand: f64| value.unwrap_or(shorthand) as f32;
    let pad = style.padding.unwrap_or(0.0);
    let border = style.border_width.unwrap_or(0.0);
    BoundsInsets {
        padding: EdgeInsets {
            left: side(style.padding_left, pad),
            top: side(style.padding_top, pad),
            right: side(style.padding_right, pad),
            bottom: side(style.padding_bottom, pad),
        },
        border: EdgeInsets {
            left: side(style.border_left_width, border),
            top: side(style.border_top_width, border),
            right: side(style.border_right_width, border),
            bottom: side(style.border_bottom_width, border),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Styled;

    fn with_fill(fill: &str) -> StyleDesc {
        StyleDesc {
            background_color: Some(fill.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn box_shadow_single_remains_compatible_and_inset_defaults_to_false() {
        let legacy: StyleDesc = serde_json::from_str(
            r##"{"boxShadow":{"offsetX":1,"offsetY":2,"blurRadius":3,"spreadRadius":-1,"color":"#112233"}}"##,
        )
        .unwrap();
        let explicit: StyleDesc = serde_json::from_str(
            r##"{"boxShadow":{"offsetX":1,"offsetY":2,"blurRadius":3,"spreadRadius":-1,"color":"#112233","inset":false}}"##,
        )
        .unwrap();
        assert_eq!(legacy.box_shadow, explicit.box_shadow);
        let shadow = legacy
            .box_shadow
            .as_ref()
            .unwrap()
            .resolved_shadows()
            .unwrap();
        assert_eq!(shadow.len(), 1);
        assert_eq!(shadow[0].offset, gpui::point(gpui::px(1.), gpui::px(2.)));
        assert_eq!(shadow[0].blur_radius, gpui::px(3.));
        assert_eq!(shadow[0].spread_radius, gpui::px(-1.));
        assert!(!shadow[0].inset);
        let wire = serde_json::to_value(legacy).unwrap();
        assert!(wire["boxShadow"].is_object());
        assert_eq!(
            wire["boxShadow"],
            serde_json::json!({
                "offsetX": 1.0, "offsetY": 2.0, "blurRadius": 3.0,
                "spreadRadius": -1.0, "color": "#112233",
            })
        );
        let round_trip: StyleDesc = serde_json::from_value(wire).unwrap();
        assert_eq!(round_trip.box_shadow, explicit.box_shadow);
    }

    #[test]
    fn box_shadow_single_inset_maps_to_the_gpui_builder() {
        let style: StyleDesc = serde_json::from_str(
            r#"{"boxShadow":{"offsetX":0,"offsetY":2,"blurRadius":4,"spreadRadius":0,"color":"rgba(114,93,66,0.15)","inset":true}}"#,
        )
        .unwrap();
        let shadows = style
            .box_shadow
            .as_ref()
            .unwrap()
            .resolved_shadows()
            .unwrap();
        let expected = gpui::BoxShadow::new(
            gpui::px(0.),
            gpui::px(2.),
            crate::color::parse_color_rgba("rgba(114,93,66,0.15)")
                .unwrap()
                .into(),
        )
        .blur_radius(gpui::px(4.))
        .inset();
        assert_eq!(shadows, vec![expected]);
        assert_eq!(
            serde_json::to_value(style).unwrap()["boxShadow"]["inset"],
            true
        );
    }

    #[test]
    fn aspect_ratio_and_border_style_parse_off_the_wire() {
        let style: StyleDesc = serde_json::from_str(
            r#"{"aspectRatio":2.5,"borderStyle":"dashed"}"#,
        )
        .unwrap();
        assert_eq!(style.aspect_ratio, Some(2.5));
        assert_eq!(style.border_style.as_deref(), Some("dashed"));
        // Round trip keeps the keys, so a style patch does not drop them.
        let wire = serde_json::to_value(&style).unwrap();
        assert_eq!(wire["aspectRatio"], 2.5);
        assert_eq!(wire["borderStyle"], "dashed");
    }

    #[test]
    fn box_shadow_array_preserves_drop_and_inset_stack_order() {
        let style: StyleDesc = serde_json::from_str(
            r##"{"boxShadow":[{"offsetX":0,"offsetY":5,"blurRadius":8,"spreadRadius":1,"color":"#00000033"},{"offsetX":0,"offsetY":2,"blurRadius":0,"spreadRadius":0,"color":"#ffffff73","inset":true}]}"##,
        )
        .unwrap();
        let shadows = style
            .box_shadow
            .as_ref()
            .unwrap()
            .resolved_shadows()
            .unwrap();
        assert_eq!(shadows.len(), 2);
        assert!(shadows[0].inset);
        assert_eq!(shadows[0].offset.y, gpui::px(2.));
        assert!(!shadows[1].inset);
        assert_eq!(shadows[1].offset.y, gpui::px(5.));
        let wire = serde_json::to_value(style).unwrap();
        assert_eq!(wire["boxShadow"].as_array().unwrap().len(), 2);
        let round_trip: StyleDesc = serde_json::from_value(wire).unwrap();
        assert_eq!(
            round_trip.box_shadow.unwrap().resolved_shadows().unwrap(),
            shadows
        );
    }

    #[test]
    fn box_shadow_empty_array_explicitly_clears_the_stack() {
        let style: StyleDesc = serde_json::from_str(r#"{"boxShadow":[]}"#).unwrap();
        assert!(style
            .box_shadow
            .as_ref()
            .unwrap()
            .resolved_shadows()
            .unwrap()
            .is_empty());
        assert_eq!(
            serde_json::to_value(&style).unwrap()["boxShadow"],
            serde_json::json!([])
        );
        assert!(StyleDesc::default().box_shadow.is_none());
        let base = gpui::BoxShadow::new(gpui::px(0.), gpui::px(4.), gpui::black());
        let mut element = crate::renderer::apply_styles(gpui::div().shadow(vec![base]), &style);
        assert_eq!(element.style().box_shadow, Some(Vec::new()));
    }

    #[test]
    fn box_shadow_invalid_single_keeps_the_existing_ignore_behavior() {
        let style: StyleDesc = serde_json::from_str(
            r#"{"boxShadow":{"offsetX":0,"offsetY":2,"blurRadius":4,"spreadRadius":0,"color":"not-a-color"}}"#,
        ).unwrap();
        assert!(style.box_shadow.as_ref().unwrap().resolved_shadows().is_none());
        let base = gpui::BoxShadow::new(gpui::px(0.), gpui::px(4.), gpui::black());
        let mut element = crate::renderer::apply_styles(gpui::div().shadow(vec![base.clone()]), &style);
        assert_eq!(element.style().box_shadow, Some(vec![base]));
    }

    #[test]
    fn transparent_function_does_not_occlude() {
        assert!(!should_occlude(&with_fill("transparent")));
        assert!(!should_occlude(&with_fill("oklch(50% 0.2 30 / 0%)")));
    }

    #[test]
    fn outline_parses_width_color_and_offset() {
        let style: StyleDesc =
            serde_json::from_str(r##"{"outline":{"width":2,"color":"#00ff00"}}"##).unwrap();
        assert_eq!(
            style.outline,
            Some(OutlineValue {
                width: 2.0,
                color: "#00ff00".to_owned(),
                offset: 0.0
            })
        );

        let style: StyleDesc =
            serde_json::from_str(r#"{"outline":{"width":1,"color":"red","offset":-2}}"#).unwrap();
        assert_eq!(
            style.outline,
            Some(OutlineValue {
                width: 1.0,
                color: "red".to_owned(),
                offset: -2.0
            })
        );
    }

    #[test]
    fn invalid_fill_keeps_conservative_occlusion() {
        assert!(should_occlude(&with_fill("not-a-color")));
    }

    #[test]
    fn bounds_insets_matches_apply_styles_precedence() {
        let style = StyleDesc {
            padding: Some(4.0),
            padding_top: Some(8.0),
            border_width: Some(2.0),
            border_left_width: Some(5.0),
            ..Default::default()
        };
        assert_eq!(
            bounds_insets(&style),
            BoundsInsets {
                padding: EdgeInsets {
                    left: 4.0,
                    top: 8.0,
                    right: 4.0,
                    bottom: 4.0,
                },
                border: EdgeInsets {
                    left: 5.0,
                    top: 2.0,
                    right: 2.0,
                    bottom: 2.0,
                },
            }
        );
    }

    #[test]
    fn resolves_a_two_stop_linear_gradient() {
        let style: StyleDesc = serde_json::from_str(
            r##"{"background":{"type":"linear-gradient","angle":90,"stops":[{"color":"#ff0000","position":0},{"color":"#0000ff","position":1}],"colorSpace":"oklab"}}"##,
        )
        .unwrap();
        let expected = gpui::linear_gradient(
            90.0,
            gpui::linear_color_stop(crate::color::parse_color_rgba("#ff0000").unwrap(), 0.0),
            gpui::linear_color_stop(crate::color::parse_color_rgba("#0000ff").unwrap(), 1.0),
        )
        .color_space(gpui::ColorSpace::Oklab);

        assert_eq!(style.resolved_background(), Some(expected));
    }

    #[test]
    fn transparent_gradient_does_not_occlude() {
        let style: StyleDesc = serde_json::from_str(
            r##"{"background":{"type":"linear-gradient","angle":0,"stops":[{"color":"transparent","position":0},{"color":"#00000000","position":1}]}}"##,
        )
        .unwrap();

        assert!(!should_occlude(&style));
    }

    #[test]
    fn bounds_insets_defaults_to_zero() {
        assert_eq!(
            bounds_insets(&StyleDesc::default()),
            BoundsInsets::default()
        );
    }

    #[test]
    fn cursor_keywords_map_to_gpui_styles() {
        let cases = [
            ("auto", gpui::CursorStyle::Arrow),
            ("default", gpui::CursorStyle::Arrow),
            ("pointer", gpui::CursorStyle::PointingHand),
            ("text", gpui::CursorStyle::IBeam),
            (
                "vertical-text",
                gpui::CursorStyle::IBeamCursorForVerticalLayout,
            ),
            ("crosshair", gpui::CursorStyle::Crosshair),
            ("grab", gpui::CursorStyle::OpenHand),
            ("all-scroll", gpui::CursorStyle::OpenHand),
            ("grabbing", gpui::CursorStyle::ClosedHand),
            ("move", gpui::CursorStyle::ClosedHand),
            ("context-menu", gpui::CursorStyle::ContextualMenu),
            ("not-allowed", gpui::CursorStyle::OperationNotAllowed),
            ("no-drop", gpui::CursorStyle::OperationNotAllowed),
            ("alias", gpui::CursorStyle::DragLink),
            ("copy", gpui::CursorStyle::DragCopy),
            ("col-resize", gpui::CursorStyle::ResizeColumn),
            ("row-resize", gpui::CursorStyle::ResizeRow),
            ("ew-resize", gpui::CursorStyle::ResizeLeftRight),
            ("ns-resize", gpui::CursorStyle::ResizeUpDown),
            ("nesw-resize", gpui::CursorStyle::ResizeUpRightDownLeft),
            ("ne-resize", gpui::CursorStyle::ResizeUpRightDownLeft),
            ("sw-resize", gpui::CursorStyle::ResizeUpRightDownLeft),
            ("nwse-resize", gpui::CursorStyle::ResizeUpLeftDownRight),
            ("nw-resize", gpui::CursorStyle::ResizeUpLeftDownRight),
            ("se-resize", gpui::CursorStyle::ResizeUpLeftDownRight),
            ("n-resize", gpui::CursorStyle::ResizeUp),
            ("e-resize", gpui::CursorStyle::ResizeRight),
            ("s-resize", gpui::CursorStyle::ResizeDown),
            ("w-resize", gpui::CursorStyle::ResizeLeft),
        ];
        for (keyword, expected) in cases {
            assert_eq!(
                parse_cursor_style(keyword),
                Some(expected),
                "keyword {keyword}"
            );
        }
    }

    #[test]
    fn unsupported_cursor_keywords_map_to_none() {
        let cases = [
            "none",
            "wait",
            "progress",
            "help",
            "cell",
            "zoom-in",
            "zoom-out",
            "url(cursor.png)",
            "pointer ",
            "",
            "Pointer",
        ];
        for keyword in cases {
            assert_eq!(parse_cursor_style(keyword), None, "keyword {keyword:?}");
        }
    }

    #[test]
    fn unsupported_cursor_warning_fires_once_per_value() {
        // The dedupe set is process-wide, so probe with values unique to this test.
        assert!(warn_unsupported_cursor("cursor-tests-once"));
        assert!(!warn_unsupported_cursor("cursor-tests-once"));
        assert!(warn_unsupported_cursor("cursor-tests-once-again"));
    }
}
