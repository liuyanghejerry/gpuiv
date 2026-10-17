//! Native motion tracks resolved during GPUI rendering, outside React.

use std::time::Duration;

use serde::{Deserialize, Deserializer};
use web_time::Instant;

use crate::custom_elements::img::image_filters::ImageFilters;
use crate::style::{BoxShadowListValue, BoxShadowValue, DimensionValue, StyleDesc};

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MotionStyle {
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub opacity: Option<f64>,
    pub top: Option<f64>,
    pub right: Option<f64>,
    pub bottom: Option<f64>,
    pub left: Option<f64>,
    pub border_radius: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_color_target")]
    background_color: Option<MotionColorTarget>,
    #[serde(default, deserialize_with = "deserialize_color_target")]
    color: Option<MotionColorTarget>,
    #[serde(default, deserialize_with = "deserialize_color_target")]
    border_color: Option<MotionColorTarget>,
    box_shadow: Option<MotionShadows>,
    /// Image filter list; consumed by `<img>` and painted by its filter pipeline.
    filter: Option<ImageFilters>,
}

/// Resolve CSS colors only when a target changes. The frame clock interpolates
/// premultiplied sRGB, so fading a saturated color to transparent cannot acquire
/// a dark fringe from transparent's otherwise arbitrary RGB channels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct MotionColor {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

impl MotionColor {
    fn parse(value: &str) -> Result<Self, String> {
        let color = crate::color::parse_color_rgba(value)
            .ok_or_else(|| format!("invalid motion color: {value}"))?;
        Ok(Self {
            r: color.r as f64,
            g: color.g as f64,
            b: color.b as f64,
            a: color.a as f64,
        })
    }

    fn interpolate(self, target: Self, progress: f64) -> Self {
        if progress <= 0.0 {
            return self;
        }
        if progress >= 1.0 {
            return target;
        }
        let a = self.a + (target.a - self.a) * progress;
        let channel = |from: f64, to: f64| {
            if a > 0.0 {
                (from * self.a + (to * target.a - from * self.a) * progress) / a
            } else {
                0.0
            }
        };
        Self {
            r: channel(self.r, target.r),
            g: channel(self.g, target.g),
            b: channel(self.b, target.b),
            a,
        }
    }

    fn css(self) -> String {
        // Fractional channels preserve continuous retargets; hexadecimal output
        // would quantize every sampled color to 8 bits before the next target.
        format!(
            "rgba({}, {}, {}, {})",
            self.r * 255.0,
            self.g * 255.0,
            self.b * 255.0,
            self.a
        )
    }
}

impl<'de> Deserialize<'de> for MotionColor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(serde::de::Error::custom)
    }
}

/// Unlike an omitted target, explicit null stops owning this paint property.
/// The retained base style (including GPUI's normal inherited text color) is
/// then left untouched. It does not mean painting transparent black.
#[derive(Clone, Copy, Debug, PartialEq)]
enum MotionColorTarget {
    Color(MotionColor),
    Release,
}

fn deserialize_color_target<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<MotionColorTarget>, D::Error> {
    let value = Option::<String>::deserialize(deserializer)?;
    value
        .map(|value| MotionColor::parse(&value).map(MotionColorTarget::Color))
        .transpose()
        .map(|value| Some(value.unwrap_or(MotionColorTarget::Release)))
        .map_err(serde::de::Error::custom)
}

impl MotionColorTarget {
    fn color(self) -> Option<MotionColor> {
        match self {
            Self::Color(color) => Some(color),
            Self::Release => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct MotionShadow {
    offset_x: f64,
    offset_y: f64,
    blur_radius: f64,
    spread_radius: f64,
    color: MotionColor,
    inset: bool,
}

impl MotionShadow {
    fn transparent(inset: bool) -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
            blur_radius: 0.0,
            spread_radius: 0.0,
            color: MotionColor {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.0,
            },
            inset,
        }
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        let value = |from, to| from + (to - from) * progress;
        Self {
            offset_x: value(self.offset_x, target.offset_x),
            offset_y: value(self.offset_y, target.offset_y),
            blur_radius: value(self.blur_radius, target.blur_radius),
            spread_radius: value(self.spread_radius, target.spread_radius),
            color: self.color.interpolate(target.color, progress),
            inset: target.inset,
        }
    }

    fn style(&self) -> BoxShadowValue {
        BoxShadowValue {
            offset_x: self.offset_x,
            offset_y: self.offset_y,
            blur_radius: self.blur_radius,
            spread_radius: self.spread_radius,
            color: self.color.css(),
            inset: self.inset,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct MotionShadows(Vec<MotionShadow>);

impl<'de> Deserialize<'de> for MotionShadows {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let shadows = match BoxShadowListValue::deserialize(deserializer)? {
            BoxShadowListValue::Single(value) => vec![value],
            BoxShadowListValue::Multiple(values) => values,
        };
        shadows
            .into_iter()
            .map(|shadow| {
                Ok(MotionShadow {
                    offset_x: shadow.offset_x,
                    offset_y: shadow.offset_y,
                    blur_radius: shadow.blur_radius,
                    spread_radius: shadow.spread_radius,
                    color: MotionColor::parse(&shadow.color).map_err(serde::de::Error::custom)?,
                    inset: shadow.inset,
                })
            })
            .collect::<Result<Vec<_>, D::Error>>()
            .map(Self)
    }
}

impl MotionShadows {
    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        if progress <= 0.0 {
            return self.clone();
        }
        if progress >= 1.0 {
            return target.clone();
        }
        // CSS box-shadow cannot interpolate an inset shadow with a drop shadow.
        // Keep the whole list discrete rather than momentarily changing its
        // paint group or inventing extra layers GPUI never declared.
        if self
            .0
            .iter()
            .zip(&target.0)
            .any(|(from, to)| from.inset != to.inset)
        {
            return if progress < 0.5 {
                self.clone()
            } else {
                target.clone()
            };
        }
        Self(
            (0..self.0.len().max(target.0.len()))
                .map(|index| match (self.0.get(index), target.0.get(index)) {
                    (Some(from), Some(to)) => from.interpolate(to, progress),
                    (None, Some(to)) => {
                        MotionShadow::transparent(to.inset).interpolate(to, progress)
                    }
                    (Some(from), None) => {
                        from.interpolate(&MotionShadow::transparent(from.inset), progress)
                    }
                    (None, None) => unreachable!(),
                })
                .collect(),
        )
    }
}

impl MotionStyle {
    fn with_fallback(self, fallback: Self) -> Self {
        Self {
            width: self.width.or(fallback.width),
            height: self.height.or(fallback.height),
            opacity: self.opacity.or(fallback.opacity),
            top: self.top.or(fallback.top),
            right: self.right.or(fallback.right),
            bottom: self.bottom.or(fallback.bottom),
            left: self.left.or(fallback.left),
            border_radius: self.border_radius.or(fallback.border_radius),
            background_color: self.background_color.or(fallback.background_color),
            color: self.color.or(fallback.color),
            border_color: self.border_color.or(fallback.border_color),
            box_shadow: self.box_shadow.or(fallback.box_shadow),
            filter: self.filter.or(fallback.filter),
        }
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        fn color(
            from: Option<MotionColorTarget>,
            to: Option<MotionColorTarget>,
            progress: f64,
        ) -> Option<MotionColorTarget> {
            to.map(|to| match to {
                MotionColorTarget::Release => to,
                MotionColorTarget::Color(target) => MotionColorTarget::Color(
                    from.and_then(MotionColorTarget::color)
                        .unwrap_or(target)
                        .interpolate(target, progress),
                ),
            })
        }
        fn value(from: Option<f64>, to: Option<f64>, progress: f64) -> Option<f64> {
            to.map(|to| from.unwrap_or(to) + (to - from.unwrap_or(to)) * progress)
        }

        Self {
            width: value(self.width, target.width, progress),
            height: value(self.height, target.height, progress),
            opacity: value(self.opacity, target.opacity, progress),
            top: value(self.top, target.top, progress),
            right: value(self.right, target.right, progress),
            bottom: value(self.bottom, target.bottom, progress),
            left: value(self.left, target.left, progress),
            border_radius: value(self.border_radius, target.border_radius, progress),
            background_color: color(self.background_color, target.background_color, progress),
            color: color(self.color, target.color, progress),
            border_color: color(self.border_color, target.border_color, progress),
            box_shadow: target.box_shadow.as_ref().map(|to| {
                self.box_shadow
                    .as_ref()
                    .unwrap_or(to)
                    .interpolate(to, progress)
            }),
            filter: target.filter.as_ref().map(|to| {
                self.filter
                    .as_ref()
                    .unwrap_or(to)
                    .interpolate(to, progress)
            }),
        }
    }

    fn release_color_tracks(&mut self, target: &Self) {
        for (from, to) in [
            (&mut self.background_color, target.background_color),
            (&mut self.color, target.color),
            (&mut self.border_color, target.border_color),
        ] {
            if to == Some(MotionColorTarget::Release) {
                *from = to;
            }
        }
    }

    pub(crate) fn apply_to(self, style: &mut StyleDesc) {
        if let Some(value) = self.width {
            style.width = Some(DimensionValue::Pixels(value));
        }
        if let Some(value) = self.height {
            style.height = Some(DimensionValue::Pixels(value));
        }
        if let Some(value) = self.opacity {
            style.opacity = Some(value);
        }
        if let Some(value) = self.top {
            style.top = Some(value);
        }
        if let Some(value) = self.right {
            style.right = Some(value);
        }
        if let Some(value) = self.bottom {
            style.bottom = Some(value);
        }
        if let Some(value) = self.left {
            style.left = Some(value);
        }
        if let Some(value) = self.border_radius {
            style.border_radius = Some(value);
        }
        if let Some(MotionColorTarget::Color(value)) = self.background_color {
            style.background_color = Some(value.css());
        }
        if let Some(MotionColorTarget::Color(value)) = self.color {
            style.color = Some(value.css());
        }
        if let Some(MotionColorTarget::Color(value)) = self.border_color {
            style.border_color = Some(value.css());
        }
        if let Some(value) = self.box_shadow {
            // StyleDesc translates this declared stack through GPUI's existing
            // Styled::shadow(Vec<BoxShadow>), including its inset flag.
            style.box_shadow = Some(BoxShadowListValue::Multiple(
                value.0.iter().map(MotionShadow::style).collect(),
            ));
        }
        if let Some(value) = self.filter {
            style.filter = Some(value.to_css());
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionInitial {
    Disabled(bool),
    Style(MotionStyle),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
enum MotionEase {
    Name(String),
    CubicBezier([f64; 4]),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionTransition {
    #[serde(default = "default_duration")]
    duration: f64,
    #[serde(default)]
    delay: f64,
    #[serde(default = "default_ease")]
    ease: MotionEase,
}

impl Default for MotionTransition {
    fn default() -> Self {
        Self {
            duration: default_duration(),
            delay: 0.0,
            ease: default_ease(),
        }
    }
}

fn default_duration() -> f64 {
    0.3
}

fn default_ease() -> MotionEase {
    MotionEase::Name("easeOut".to_string())
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MotionDescription {
    #[serde(default)]
    generation: u64,
    #[serde(default)]
    is_exit: bool,
    #[serde(default)]
    initial: Option<MotionInitial>,
    animate: MotionStyle,
    #[serde(default)]
    transition: MotionTransition,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct MotionFrame {
    pub active: bool,
    pub just_settled: bool,
    pub generation: u64,
}

pub(crate) struct MotionState {
    source: serde_json::Value,
    from: MotionStyle,
    target: MotionStyle,
    transition: MotionTransition,
    started: Instant,
    valid: bool,
    needs_settle: bool,
    generation: u64,
}

impl MotionState {
    pub(crate) fn new(source: &serde_json::Value, now: Instant) -> Result<Self, String> {
        let description = parse_description(source)?;
        let mut from = match description.initial {
            Some(MotionInitial::Style(style)) => style,
            Some(MotionInitial::Disabled(false)) | None => description.animate.clone(),
            Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
        };

        let target = description.animate.with_fallback(from.clone());
        let needs_settle = description.is_exit || from != target;
        from.release_color_tracks(&target);
        Ok(Self {
            source: source.clone(),
            from,
            target,
            transition: description.transition,
            started: now,
            valid: true,
            needs_settle,
            generation: description.generation,
        })
    }

    pub(crate) fn invalid(source: &serde_json::Value, now: Instant) -> Self {
        Self {
            source: source.clone(),
            from: MotionStyle::default(),
            target: MotionStyle::default(),
            transition: MotionTransition::default(),
            started: now,
            valid: false,
            needs_settle: source_is_exit(source),
            generation: source_generation(source),
        }
    }

    pub(crate) fn sync(&mut self, source: &serde_json::Value, now: Instant) -> Result<(), String> {
        if self.source == *source {
            return Ok(());
        }

        let previous_generation = self.generation;
        let description = match parse_description(source) {
            Ok(description) => description,
            Err(error) => {
                self.source = source.clone();
                self.valid = false;
                self.generation = source_generation(source);
                self.needs_settle =
                    source_is_exit(source) || self.generation != previous_generation;
                return Err(error);
            }
        };
        self.from = if self.valid {
            self.visible_style(now)
                .unwrap_or_else(|| self.target.clone())
        } else {
            match description.initial {
                Some(MotionInitial::Style(style)) => style,
                Some(MotionInitial::Disabled(false)) | None => description.animate.clone(),
                Some(MotionInitial::Disabled(true)) => unreachable!("validated above"),
            }
        };
        self.target = description.animate.with_fallback(self.from.clone());
        let target_changed = self.from != self.target;
        self.from.release_color_tracks(&self.target);
        self.transition = description.transition;
        self.started = now;
        self.source = source.clone();
        self.valid = true;
        self.generation = description.generation;
        self.needs_settle =
            description.is_exit || self.generation != previous_generation || target_changed;
        Ok(())
    }

    pub(crate) fn visible_style(&self, now: Instant) -> Option<MotionStyle> {
        self.valid.then(|| self.sample(now).0)
    }

    fn sample(&self, now: Instant) -> (MotionStyle, bool) {
        let delay = seconds(self.transition.delay);
        let duration = seconds(self.transition.duration);
        let elapsed = now.saturating_duration_since(self.started);
        let raw = if duration.is_zero() {
            if elapsed < delay {
                0.0
            } else {
                1.0
            }
        } else if elapsed <= delay {
            0.0
        } else {
            elapsed.saturating_sub(delay).as_secs_f64() / duration.as_secs_f64()
        };
        let active = self.from != self.target && raw < 1.0;
        let progress = ease(raw.clamp(0.0, 1.0), &self.transition.ease);
        (self.from.interpolate(&self.target, progress), active)
    }

    pub(crate) fn frame(&mut self, now: Instant) -> MotionFrame {
        let (_, active) = if self.valid {
            self.sample(now)
        } else {
            (MotionStyle::default(), false)
        };
        if active {
            self.needs_settle = true;
        }
        let just_settled = self.needs_settle && !active;
        if just_settled {
            self.needs_settle = false;
        }
        MotionFrame {
            active,
            just_settled,
            generation: self.generation,
        }
    }
}

fn source_generation(source: &serde_json::Value) -> u64 {
    source
        .get("generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default()
}

fn source_is_exit(source: &serde_json::Value) -> bool {
    source
        .get("isExit")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_default()
}

fn parse_description(source: &serde_json::Value) -> Result<MotionDescription, String> {
    let description: MotionDescription =
        serde_json::from_value(source.clone()).map_err(|error| error.to_string())?;

    if matches!(description.initial, Some(MotionInitial::Disabled(true))) {
        return Err("motion initial only accepts false or a style object".to_string());
    }
    validate_style(&description.animate)?;
    if let Some(MotionInitial::Style(initial)) = &description.initial {
        validate_style(initial)?;
    }
    validate_seconds(description.transition.duration, "duration")?;
    validate_seconds(description.transition.delay, "delay")?;
    validate_ease(&description.transition.ease)?;
    Ok(description)
}

fn validate_style(style: &MotionStyle) -> Result<(), String> {
    for (name, value) in [
        ("width", style.width),
        ("height", style.height),
        ("opacity", style.opacity),
        ("top", style.top),
        ("right", style.right),
        ("bottom", style.bottom),
        ("left", style.left),
        ("borderRadius", style.border_radius),
    ] {
        if value.is_some_and(|value| !value.is_finite() || value.abs() > f32::MAX as f64) {
            return Err(format!("motion {name} must fit a finite 32-bit float"));
        }
    }
    if style.width.is_some_and(|value| value < 0.0)
        || style.height.is_some_and(|value| value < 0.0)
        || style.border_radius.is_some_and(|value| value < 0.0)
    {
        return Err("motion sizes and borderRadius must be non-negative".to_string());
    }
    if style
        .opacity
        .is_some_and(|value| !(0.0..=1.0).contains(&value))
    {
        return Err("motion opacity must be between 0 and 1".to_string());
    }
    if let Some(shadows) = &style.box_shadow {
        for shadow in &shadows.0 {
            for value in [
                shadow.offset_x,
                shadow.offset_y,
                shadow.blur_radius,
                shadow.spread_radius,
            ] {
                if !value.is_finite() || value.abs() > f32::MAX as f64 {
                    return Err(
                        "motion boxShadow lengths must fit a finite 32-bit float".to_string()
                    );
                }
            }
            if shadow.blur_radius < 0.0 {
                return Err("motion boxShadow blurRadius must be non-negative".to_string());
            }
        }
    }
    Ok(())
}

fn validate_seconds(value: f64, name: &str) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 || Duration::try_from_secs_f64(value).is_err() {
        return Err(format!(
            "motion {name} must be a supported finite non-negative number"
        ));
    }
    Ok(())
}

fn validate_ease(ease: &MotionEase) -> Result<(), String> {
    match ease {
        MotionEase::Name(name)
            if matches!(
                name.as_str(),
                "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut"
            ) => {}
        MotionEase::Name(name) => return Err(format!("unknown motion easing: {name}")),
        MotionEase::CubicBezier([x1, y1, x2, y2]) => {
            if ![x1, y1, x2, y2].iter().all(|value| value.is_finite())
                || !(0.0..=1.0).contains(x1)
                || !(0.0..=1.0).contains(x2)
            {
                return Err(
                    "motion cubic bezier values must be finite and x values must be 0..1"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

fn seconds(value: f64) -> Duration {
    Duration::try_from_secs_f64(value).expect("motion durations are validated when parsed")
}

fn ease(progress: f64, ease: &MotionEase) -> f64 {
    let curve = match ease {
        MotionEase::CubicBezier(curve) => *curve,
        MotionEase::Name(name) => match name.as_str() {
            "linear" => return progress,
            "easeIn" => [0.42, 0.0, 1.0, 1.0],
            "easeInOut" => [0.42, 0.0, 0.58, 1.0],
            "ease" => [0.25, 0.1, 0.25, 1.0],
            _ => [0.0, 0.0, 0.58, 1.0],
        },
    };
    cubic_bezier(progress, curve)
}

fn cubic_bezier(x: f64, [x1, y1, x2, y2]: [f64; 4]) -> f64 {
    fn sample(t: f64, a: f64, b: f64) -> f64 {
        let c = 3.0 * a;
        let b = 3.0 * (b - a) - c;
        let a = 1.0 - c - b;
        ((a * t + b) * t + c) * t
    }

    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..20 {
        let middle = (low + high) / 2.0;
        if sample(middle, x1, x2) < x {
            low = middle;
        } else {
            high = middle;
        }
    }
    sample((low + high) / 2.0, y1, y2).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_and_retargets_from_the_visible_value() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let middle = state.frame(started + Duration::from_millis(500));
        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(500))
                .unwrap()
                .width,
            Some(50.0)
        );
        assert!(middle.active);
        assert!(!middle.just_settled);

        let reversed = serde_json::json!({
            "initial": false,
            "animate": { "width": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let reversed_at = started + Duration::from_millis(500);
        state.sync(&reversed, reversed_at).unwrap();
        assert_eq!(state.visible_style(reversed_at).unwrap().width, Some(50.0));
        assert_eq!(
            state
                .visible_style(reversed_at + Duration::from_millis(500))
                .unwrap()
                .width,
            Some(25.0)
        );
    }

    #[test]
    fn disabled_initial_state_starts_at_the_target() {
        let now = Instant::now();
        let description = serde_json::json!({
            "initial": false,
            "animate": { "width": 260.0 },
            "transition": { "duration": 0.2 }
        });
        let mut state = MotionState::new(&description, now).unwrap();
        let frame = state.frame(now);

        assert_eq!(state.visible_style(now).unwrap().width, Some(260.0));
        assert!(!frame.active);
        assert!(!frame.just_settled);
    }

    #[test]
    fn rejects_unsafe_numbers_and_invalid_initial_booleans() {
        let now = Instant::now();
        for description in [
            serde_json::json!({ "animate": { "width": 1e300 }, "transition": {} }),
            serde_json::json!({ "animate": { "opacity": 2.0 }, "transition": {} }),
            serde_json::json!({ "animate": {}, "transition": { "duration": 1e300 } }),
            serde_json::json!({ "initial": true, "animate": {}, "transition": {} }),
        ] {
            assert!(MotionState::new(&description, now).is_err());
        }
    }

    #[test]
    fn finishes_at_the_exact_target() {
        let started = Instant::now();
        let description = serde_json::json!({
            "initial": { "width": 0.0 },
            "animate": { "width": 100.0 },
            "transition": { "duration": 0.2, "ease": "linear" }
        });
        let mut state = MotionState::new(&description, started).unwrap();
        let frame = state.frame(started + Duration::from_millis(200));

        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(200))
                .unwrap()
                .width,
            Some(100.0)
        );
        assert!(!frame.active);
        assert!(frame.just_settled);
        assert!(
            !state
                .frame(started + Duration::from_millis(201))
                .just_settled
        );
    }

    #[test]
    fn retarget_with_zero_duration_settles_on_the_next_frame() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "initial": false,
            "animate": { "opacity": 1.0 },
            "transition": { "duration": 0.2, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();
        assert!(!state.frame(started).just_settled);

        let exit = serde_json::json!({
            "initial": false,
            "animate": { "opacity": 0.0 },
            "transition": { "duration": 0.0, "ease": "linear" }
        });
        state.sync(&exit, started).unwrap();
        let frame = state.frame(started);
        assert_eq!(state.visible_style(started).unwrap().opacity, Some(0.0));
        assert!(!frame.active);
        assert!(frame.just_settled);
    }

    #[test]
    fn a_new_generation_settles_when_the_target_already_matches() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "generation": 1,
            "initial": false,
            "animate": { "opacity": 1.0 }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let exit = serde_json::json!({
            "generation": 2,
            "initial": false,
            "animate": { "opacity": 1.0 }
        });
        state.sync(&exit, started).unwrap();

        assert!(state.frame(started).just_settled);
        assert!(!state.frame(started).just_settled);
    }

    #[test]
    fn retarget_keeps_values_omitted_from_the_new_target() {
        let started = Instant::now();
        let initial = serde_json::json!({
            "generation": 1,
            "initial": false,
            "animate": { "width": 100.0, "opacity": 1.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        let mut state = MotionState::new(&initial, started).unwrap();

        let exit = serde_json::json!({
            "generation": 2,
            "initial": false,
            "animate": { "opacity": 0.0 },
            "transition": { "duration": 1.0, "ease": "linear" }
        });
        state.sync(&exit, started).unwrap();

        state.frame(started + Duration::from_millis(500));
        let style = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        assert_eq!(style.width, Some(100.0));
        assert_eq!(style.opacity, Some(0.5));
    }

    fn linear(initial: serde_json::Value, animate: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "generation": 1, "initial": initial, "animate": animate,
            "transition": { "duration": 1.0, "ease": "linear" } })
    }

    fn assert_color(actual: MotionColor, expected: [f64; 4]) {
        for (actual, expected) in [actual.r, actual.g, actual.b, actual.a]
            .into_iter()
            .zip(expected)
        {
            assert!(
                (actual - expected).abs() < 0.00001,
                "{actual} != {expected}"
            );
        }
    }

    fn shadow(color: &str, offset: f64, inset: bool) -> serde_json::Value {
        serde_json::json!({ "offsetX": offset, "offsetY": offset * 2.0,
            "blurRadius": offset.abs() * 3.0, "spreadRadius": offset,
            "color": color, "inset": inset })
    }

    #[test]
    fn interpolates_all_color_channels_with_premultiplied_alpha() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "backgroundColor": "rgba(255,0,0,1)", "color": "black", "borderColor": "transparent" }),
            serde_json::json!({ "backgroundColor": "rgba(0,0,255,0.5)", "color": "white", "borderColor": "#00ff00" }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let middle = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        assert_color(
            middle.background_color.unwrap().color().unwrap(),
            [2.0 / 3.0, 0.0, 1.0 / 3.0, 0.75],
        );
        assert_color(middle.color.unwrap().color().unwrap(), [0.5, 0.5, 0.5, 1.0]);
        assert_color(
            middle.border_color.unwrap().color().unwrap(),
            [0.0, 1.0, 0.0, 0.5],
        );
        let mut style = StyleDesc::default();
        middle.apply_to(&mut style);
        let parsed =
            crate::color::parse_color_rgba(style.background_color.as_deref().unwrap()).unwrap();
        assert!((parsed.r - 2.0 / 3.0).abs() < 0.00001);
        assert_eq!(parsed.a, 0.75);
        assert!(style.color.is_some() && style.border_color.is_some());
    }

    #[test]
    fn fading_to_transparent_keeps_the_visible_rgb_channels() {
        let color = MotionColor::parse("#ff8000").unwrap();
        let halfway = color.interpolate(MotionColor::parse("transparent").unwrap(), 0.5);
        assert_color(halfway, [1.0, 128.0 / 255.0, 0.0, 0.5]);
        assert_eq!(color.interpolate(color, 1.0), color);
    }

    #[test]
    fn color_retarget_is_continuous_and_settles_only_the_latest_generation() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "backgroundColor": "red" }),
            serde_json::json!({ "backgroundColor": "blue" }),
        );
        let mut state = MotionState::new(&source, started).unwrap();
        let at = started + Duration::from_millis(400);
        let before = state.visible_style(at).unwrap().background_color;
        let mut reversed = linear(
            serde_json::json!(false),
            serde_json::json!({ "backgroundColor": "transparent" }),
        );
        reversed["generation"] = serde_json::json!(2);
        state.sync(&reversed, at).unwrap();
        assert_eq!(state.visible_style(at).unwrap().background_color, before);
        assert!(state.frame(started + Duration::from_millis(1000)).active);
        let halfway = state
            .visible_style(at + Duration::from_millis(500))
            .unwrap()
            .background_color
            .unwrap();
        assert_color(halfway.color().unwrap(), [0.6, 0.0, 0.4, 0.5]);
        let complete = state.frame(at + Duration::from_secs(1));
        assert!(!complete.active && complete.just_settled);
        assert_eq!(complete.generation, 2);
        assert!(!state.frame(at + Duration::from_secs(2)).just_settled);
    }

    #[test]
    fn shadow_layers_interpolate_lengths_colors_and_preserve_declared_order() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "boxShadow": [shadow("red", 2.0, false), shadow("white", 1.0, true)] }),
            serde_json::json!({ "boxShadow": [shadow("blue", 6.0, false), shadow("transparent", 3.0, true)] }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let middle = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        let shadows = &middle.box_shadow.as_ref().unwrap().0;
        assert_eq!(
            (
                shadows[0].offset_x,
                shadows[0].offset_y,
                shadows[0].blur_radius,
                shadows[0].spread_radius
            ),
            (4.0, 8.0, 12.0, 4.0)
        );
        assert_color(shadows[0].color, [0.5, 0.0, 0.5, 1.0]);
        assert_color(shadows[1].color, [1.0, 1.0, 1.0, 0.5]);
        let mut style = StyleDesc::default();
        middle.apply_to(&mut style);
        let gpui_shadows = style.box_shadow.unwrap().resolved_shadows().unwrap();
        assert!(gpui_shadows[0].inset);
        assert!(!gpui_shadows[1].inset);
        assert_eq!(gpui_shadows[1].offset.x, gpui::px(4.0));
    }

    #[test]
    fn shadow_list_length_changes_pad_transparent_zero_layers_with_matching_inset() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "boxShadow": shadow("red", 2.0, false) }),
            serde_json::json!({ "boxShadow": [shadow("red", 2.0, false), shadow("#00ff00", 4.0, true)] }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let middle = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap();
        let shadows = &middle.box_shadow.as_ref().unwrap().0;
        assert_eq!(shadows.len(), 2);
        assert!(shadows[1].inset);
        assert_eq!(shadows[1].offset_x, 2.0);
        assert_color(shadows[1].color, [0.0, 1.0, 0.0, 0.5]);
    }

    #[test]
    fn clearing_shadows_fades_layers_before_applying_the_exact_empty_list() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "boxShadow": shadow("red", 4.0, true) }),
            serde_json::json!({ "boxShadow": [] }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let halfway = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap()
            .box_shadow
            .unwrap();
        assert_eq!(halfway.0[0].offset_x, 2.0);
        assert!(halfway.0[0].inset);
        assert_color(halfway.0[0].color, [1.0, 0.0, 0.0, 0.5]);
        let done = state
            .visible_style(started + Duration::from_secs(1))
            .unwrap()
            .box_shadow
            .unwrap();
        assert!(done.0.is_empty());
    }

    #[test]
    fn incompatible_inset_changes_switch_the_whole_shadow_list_at_the_midpoint() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "boxShadow": [shadow("red", 2.0, false), shadow("white", 1.0, true)] }),
            serde_json::json!({ "boxShadow": [shadow("blue", 8.0, true), shadow("black", 5.0, true)] }),
        );
        let state = MotionState::new(&source, started).unwrap();
        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(499))
                .unwrap()
                .box_shadow,
            state.from.box_shadow
        );
        assert_eq!(
            state
                .visible_style(started + Duration::from_millis(500))
                .unwrap()
                .box_shadow,
            state.target.box_shadow
        );
    }

    #[test]
    fn retargeting_a_shadow_starts_from_the_current_interpolated_stack() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "boxShadow": [] }),
            serde_json::json!({ "boxShadow": shadow("red", 8.0, false) }),
        );
        let mut state = MotionState::new(&source, started).unwrap();
        let at = started + Duration::from_millis(500);
        let before = state.visible_style(at).unwrap().box_shadow;
        let mut reverse = linear(
            serde_json::json!(false),
            serde_json::json!({ "boxShadow": [] }),
        );
        reverse["generation"] = serde_json::json!(2);
        state.sync(&reverse, at).unwrap();
        assert_eq!(state.visible_style(at).unwrap().box_shadow, before);
        let halfway = state
            .visible_style(at + Duration::from_millis(500))
            .unwrap()
            .box_shadow
            .unwrap();
        assert_eq!(halfway.0[0].offset_x, 2.0);
        assert_eq!(halfway.0[0].color.a, 0.25);
    }

    #[test]
    fn rejects_invalid_colors_shadow_numbers_and_negative_blur() {
        let now = Instant::now();
        for animate in [
            serde_json::json!({ "backgroundColor": "not-a-color" }),
            serde_json::json!({ "color": 123 }),
            serde_json::json!({ "borderColor": "#gg0000" }),
            serde_json::json!({ "boxShadow": shadow("invalid", 1.0, false) }),
            serde_json::json!({ "boxShadow": { "offsetX": 1e300, "offsetY": 0, "blurRadius": 0, "spreadRadius": 0, "color": "red" } }),
            serde_json::json!({ "boxShadow": { "offsetX": 0, "offsetY": 0, "blurRadius": -1, "spreadRadius": 0, "color": "red" } }),
        ] {
            assert!(MotionState::new(&linear(serde_json::json!(false), animate), now).is_err());
        }
    }

    #[test]
    fn explicit_null_releases_color_tracks_to_base_style_and_settles_without_extra_frames() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!(false),
            serde_json::json!({ "backgroundColor": "red", "color": "blue", "borderColor": "green" }),
        );
        let mut state = MotionState::new(&source, started).unwrap();
        let mut release = linear(
            serde_json::json!(false),
            serde_json::json!({ "backgroundColor": null, "color": null, "borderColor": null }),
        );
        release["generation"] = serde_json::json!(2);
        state.sync(&release, started).unwrap();
        let frame = state.frame(started);
        assert!(!frame.active && frame.just_settled);
        assert_eq!(frame.generation, 2);
        let mut base: StyleDesc = serde_json::from_value(
            serde_json::json!({ "backgroundColor": "yellow", "borderColor": "black" }),
        )
        .unwrap();
        state.visible_style(started).unwrap().apply_to(&mut base);
        assert_eq!(base.background_color.as_deref(), Some("yellow"));
        assert_eq!(base.border_color.as_deref(), Some("black"));
        assert!(
            base.color.is_none(),
            "a released color must keep normal inheritance"
        );
        // Omission still preserves an existing target; it is distinct from null.
        let mut omitted = linear(serde_json::json!(false), serde_json::json!({ "width": 20 }));
        omitted["generation"] = serde_json::json!(3);
        state.sync(&omitted, started).unwrap();
        assert_eq!(
            state.visible_style(started).unwrap().color,
            Some(MotionColorTarget::Release)
        );
    }

    #[test]
    fn interpolates_matching_filter_lists_and_serializes_css() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "filter": "drop-shadow(0px 4px 10px rgba(91, 78, 30, 0.22))" }),
            serde_json::json!({ "filter": "drop-shadow(0px 4px 14px rgba(91, 78, 30, 0.32))" }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let halfway = state
            .visible_style(started + Duration::from_millis(500))
            .unwrap()
            .filter
            .unwrap()
            .to_css();
        assert!(halfway.contains("drop-shadow(0px 4px 12px rgba(91, 78, 30, 0.27))"));
    }

    #[test]
    fn filter_motion_targets_apply_to_the_base_style() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "filter": "blur(2px) saturate(0.5)" }),
            serde_json::json!({ "filter": "blur(6px) saturate(1.5)" }),
        );
        let mut state = MotionState::new(&source, started).unwrap();
        let mut style = StyleDesc::default();
        state
            .visible_style(started + Duration::from_millis(500))
            .unwrap()
            .apply_to(&mut style);
        assert_eq!(
            style.filter.as_deref(),
            Some("blur(4px) saturate(1)")
        );
    }

    #[test]
    fn mismatched_filter_lists_switch_at_the_midpoint() {
        let started = Instant::now();
        let source = linear(
            serde_json::json!({ "filter": "blur(2px)" }),
            serde_json::json!({ "filter": "saturate(0.5)" }),
        );
        let state = MotionState::new(&source, started).unwrap();
        let early = state
            .visible_style(started + Duration::from_millis(400))
            .unwrap()
            .filter
            .unwrap()
            .to_css();
        let late = state
            .visible_style(started + Duration::from_millis(600))
            .unwrap()
            .filter
            .unwrap()
            .to_css();
        assert_eq!(early, "blur(2px)");
        assert_eq!(late, "saturate(0.5)");
    }
}
