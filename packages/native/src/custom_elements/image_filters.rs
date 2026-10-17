//! CSS image-filter functions, evaluated by a GPUI Asset on the background
//! executor. BGRA is GPUI's public RenderImage format. Color operations use
//! unpremultiplied sRGB; Gaussian blur and source-over use premultiplied alpha.
//! Formulae: https://www.w3.org/TR/filter-effects-1/#FilterPrimitivesOverview

use std::{
    hash::{Hash, Hasher},
    sync::Arc,
};

use serde::{Deserialize, Deserializer};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ImageFilters {
    key: String,
    operations: Vec<Filter>,
}

impl Hash for ImageFilters {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.key.hash(state);
    }
}

impl<'de> Deserialize<'de> for ImageFilters {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match ImageFilters::parse(&value) {
            Ok(Some(filters)) => Ok(filters),
            Ok(None) => Ok(ImageFilters::empty()),
            Err(error) => Err(serde::de::Error::custom(error)),
        }
    }
}

/// Image-local fractions, so the same source clip applies to every decoded
/// animation frame. Radii are elliptical after non-uniform objectFit scaling.
#[derive(Clone, Debug)]
pub(super) struct SourceClip {
    pub bounds: [f32; 4],
    /// Top-left, top-right, bottom-right, bottom-left; x/y image fractions.
    pub radii: [[f32; 2]; 4],
}

#[derive(Clone, Debug)]
pub(super) struct RasterGeometry {
    /// Fractions of the original image which are visible before filtering.
    pub crop: [f32; 4],
    pub width: u32,
    pub height: u32,
}

impl Hash for RasterGeometry {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for number in self.crop {
            number.to_bits().hash(state);
        }
        self.width.hash(state);
        self.height.hash(state);
    }
}

impl Hash for SourceClip {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for number in self.bounds.iter().chain(self.radii.iter().flatten()) {
            number.to_bits().hash(state);
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Filter {
    Brightness(f32),
    Contrast(f32),
    Saturate(f32),
    Grayscale(f32),
    Sepia(f32),
    Invert(f32),
    Opacity(f32),
    HueRotate(f32),
    Blur(f32),
    DropShadow {
        x: f32,
        y: f32,
        sigma: f32,
        color: Option<[f32; 4]>,
    },
}

fn css_number(value: f32) -> String {
    if !value.is_finite() {
        return "0".to_string();
    }
    let mut value = format!("{value:.6}");
    while value.ends_with('0') {
        value.pop();
    }
    if value.ends_with('.') {
        value.pop();
    }
    if value.is_empty() || value == "-0" {
        "0".to_string()
    } else {
        value
    }
}

fn interpolate_color(from: [f32; 4], to: [f32; 4], progress: f64) -> [f32; 4] {
    let from_alpha = from[3] as f64;
    let to_alpha = to[3] as f64;
    let alpha = from_alpha + (to_alpha - from_alpha) * progress;
    if alpha <= 0.0 {
        return [0.0; 4];
    }
    let channel = |index: usize| {
        ((from[index] as f64 * from_alpha
            + ((to[index] as f64 * to_alpha) - (from[index] as f64 * from_alpha)) * progress)
            / alpha) as f32
    };
    [
        channel(0),
        channel(1),
        channel(2),
        alpha as f32,
    ]
}

impl Filter {
    fn to_css(&self) -> String {
        match self {
            Filter::Brightness(value) => format!("brightness({})", css_number(*value)),
            Filter::Contrast(value) => format!("contrast({})", css_number(*value)),
            Filter::Saturate(value) => format!("saturate({})", css_number(*value)),
            Filter::Grayscale(value) => format!("grayscale({})", css_number(*value)),
            Filter::Sepia(value) => format!("sepia({})", css_number(*value)),
            Filter::Invert(value) => format!("invert({})", css_number(*value)),
            Filter::Opacity(value) => format!("opacity({})", css_number(*value)),
            Filter::HueRotate(value) => format!("hue-rotate({}rad)", css_number(*value)),
            Filter::Blur(value) => format!("blur({}px)", css_number(*value)),
            Filter::DropShadow {
                x,
                y,
                sigma,
                color,
            } => {
                let color = color
                    .map(|[blue, green, red, alpha]| {
                        format!(
                            "rgba({}, {}, {}, {})",
                            css_number(red * 255.0),
                            css_number(green * 255.0),
                            css_number(blue * 255.0),
                            css_number(alpha)
                        )
                    })
                    .unwrap_or_else(|| "currentColor".to_string());
                format!(
                    "drop-shadow({}px {}px {}px {color})",
                    css_number(*x),
                    css_number(*y),
                    css_number(*sigma)
                )
            }
        }
    }

    fn interpolate(&self, target: &Self, progress: f64) -> Self {
        if progress <= 0.0 {
            return self.clone();
        }
        if progress >= 1.0 {
            return target.clone();
        }
        let value = |from: f32, to: f32| (from as f64 + (to as f64 - from as f64) * progress) as f32;
        let discrete = || {
            if progress < 0.5 {
                self.clone()
            } else {
                target.clone()
            }
        };
        match (self, target) {
            (Filter::Brightness(from), Filter::Brightness(to)) => {
                Filter::Brightness(value(*from, *to))
            }
            (Filter::Contrast(from), Filter::Contrast(to)) => {
                Filter::Contrast(value(*from, *to))
            }
            (Filter::Saturate(from), Filter::Saturate(to)) => {
                Filter::Saturate(value(*from, *to))
            }
            (Filter::Grayscale(from), Filter::Grayscale(to)) => {
                Filter::Grayscale(value(*from, *to))
            }
            (Filter::Sepia(from), Filter::Sepia(to)) => Filter::Sepia(value(*from, *to)),
            (Filter::Invert(from), Filter::Invert(to)) => Filter::Invert(value(*from, *to)),
            (Filter::Opacity(from), Filter::Opacity(to)) => Filter::Opacity(value(*from, *to)),
            (Filter::HueRotate(from), Filter::HueRotate(to)) => {
                Filter::HueRotate(value(*from, *to))
            }
            (Filter::Blur(from), Filter::Blur(to)) => Filter::Blur(value(*from, *to)),
            (
                Filter::DropShadow {
                    x,
                    y,
                    sigma,
                    color,
                },
                Filter::DropShadow {
                    x: target_x,
                    y: target_y,
                    sigma: target_sigma,
                    color: target_color,
                },
            ) => {
                let color = match (color, target_color) {
                    (Some(from), Some(to)) => Some(interpolate_color(*from, *to, progress)),
                    (None, None) => None,
                    _ => return discrete(),
                };
                Filter::DropShadow {
                    x: value(*x, *target_x),
                    y: value(*y, *target_y),
                    sigma: value(*sigma, *target_sigma),
                    color,
                }
            }
            _ => discrete(),
        }
    }
}

impl ImageFilters {
    /// An invalid list is rejected as a whole, as with the CSS filter property.
    /// Lengths accept px and unitless zero. Angles accept deg/rad/grad/turn.
    pub(crate) fn parse(value: &str) -> Result<Option<Self>, String> {
        let value = value.trim();
        if value.is_empty() || value.eq_ignore_ascii_case("none") {
            return Ok(None);
        }
        let mut rest = value;
        let mut operations = Vec::new();
        let mut keys = Vec::new();
        while !rest.is_empty() {
            let open = rest.find('(').ok_or("expected a filter function")?;
            let name = rest[..open].trim().to_ascii_lowercase();
            if !name.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-') {
                return Err("invalid filter function name".into());
            }
            let mut depth = 1;
            let mut close = None;
            for (offset, ch) in rest[open + 1..].char_indices() {
                match ch {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    _ => {}
                }
                if depth == 0 {
                    close = Some(open + 1 + offset);
                    break;
                }
            }
            let close = close.ok_or("unclosed filter function")?;
            let argument = rest[open + 1..close].trim();
            let amount = |bounded: bool| -> Result<f32, String> {
                let amount = if argument.is_empty() {
                    1.0
                } else {
                    let (number, scale) = argument
                        .strip_suffix('%')
                        .map(|n| (n, 0.01))
                        .unwrap_or((argument, 1.0));
                    let parsed: f64 = number.parse().map_err(|_| "invalid filter number")?;
                    let value = (parsed * scale) as f32;
                    if !value.is_finite() {
                        return Err("non-finite filter number".into());
                    }
                    value
                };
                if amount < 0.0 {
                    return Err("filter amounts cannot be negative".into());
                }
                Ok(if bounded { amount.min(1.0) } else { amount })
            };
            let operation = match name.as_str() {
                "brightness" => Filter::Brightness(amount(false)?),
                "contrast" => Filter::Contrast(amount(false)?),
                "saturate" => Filter::Saturate(amount(false)?),
                "grayscale" => Filter::Grayscale(amount(true)?),
                "sepia" => Filter::Sepia(amount(true)?),
                "invert" => Filter::Invert(amount(true)?),
                "opacity" => Filter::Opacity(amount(true)?),
                "hue-rotate" => Filter::HueRotate(angle(argument)?),
                "blur" => {
                    let sigma = if argument.is_empty() {
                        0.0
                    } else {
                        length(argument)?
                    };
                    if sigma < 0.0 {
                        return Err("blur cannot be negative".into());
                    }
                    Filter::Blur(sigma)
                }
                "drop-shadow" => shadow(argument)?,
                _ => return Err(format!("unsupported image filter: {name}")),
            };
            keys.push(format!("{operation:?}"));
            operations.push(operation);
            rest = rest[close + 1..].trim_start();
        }
        Ok(Some(Self {
            key: keys.join(" "),
            operations,
        }))
    }

    /// The empty list serializes as CSS `none`, so a motion target can clear a
    /// filter that the base style or a previous target installed.
    pub(crate) fn empty() -> Self {
        Self {
            key: String::new(),
            operations: Vec::new(),
        }
    }

    fn from_operations(operations: Vec<Filter>) -> Self {
        let key = operations
            .iter()
            .map(|operation| format!("{operation:?}"))
            .collect::<Vec<_>>()
            .join(" ");
        Self { key, operations }
    }

    pub(crate) fn to_css(&self) -> String {
        if self.operations.is_empty() {
            return "none".to_string();
        }
        self.operations
            .iter()
            .map(Filter::to_css)
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Matching lists interpolate function by function. A changed function or
    /// list length switches discretely at the midpoint, like box-shadow.
    pub(crate) fn interpolate(&self, target: &Self, progress: f64) -> Self {
        if progress <= 0.0 {
            return self.clone();
        }
        if progress >= 1.0 {
            return target.clone();
        }
        if self.operations.len() != target.operations.len() {
            return if progress < 0.5 {
                self.clone()
            } else {
                target.clone()
            };
        }
        Self::from_operations(
            self.operations
                .iter()
                .zip(&target.operations)
                .map(|(from, to)| from.interpolate(to, progress))
                .collect(),
        )
    }

    pub(super) fn has_lengths(&self) -> bool {
        self.operations
            .iter()
            .any(|op| matches!(op, Filter::Blur(_) | Filter::DropShadow { .. }))
    }

    pub(super) fn uses_current_color(&self) -> bool {
        self.operations
            .iter()
            .any(|op| matches!(op, Filter::DropShadow { color: None, .. }))
    }

    /// pixel_scale maps a logical CSS pixel to each raster axis. Source images
    /// are sampled to the visible DPI grid for length filters, so an enlarged
    /// one-pixel source receives the same CSS blur as a high-resolution source.
    pub(super) fn apply(
        &self,
        original: Arc<gpui::RenderImage>,
        pixel_scale: [f32; 2],
        clip: Option<&SourceClip>,
        current_color: Option<[f32; 4]>,
        cancel: Option<&std::sync::atomic::AtomicBool>,
        raster: Option<&RasterGeometry>,
    ) -> Result<FilteredImage, String> {
        let mut frames = smallvec::SmallVec::<[image::Frame; 1]>::new();
        let mut origins = Vec::new();
        for frame in 0..original.frame_count() {
            check_cancel(cancel)?;
            let size = original.size(frame);
            let bytes = original.as_bytes(frame).ok_or("missing image frame")?;
            let width = u32::try_from(size.width.0).map_err(|_| "negative image width")?;
            let height = u32::try_from(size.height.0).map_err(|_| "negative image height")?;
            let mut surface = if let Some(raster) = raster {
                Surface::sample_bgra(width, height, bytes, raster, cancel)?
            } else {
                Surface::from_bgra(width, height, bytes, cancel)?
            };
            if let Some(clip) = clip {
                surface.clip(clip, cancel)?;
            }
            for operation in &self.operations {
                check_cancel(cancel)?;
                surface.apply(
                    operation,
                    pixel_scale,
                    current_color.unwrap_or([0.0, 0.0, 0.0, 1.0]),
                    cancel,
                )?;
            }
            let origin = [surface.x, surface.y];
            let buffer = image::RgbaImage::from_raw(
                surface.width,
                surface.height,
                surface.into_bgra(cancel)?,
            )
            .ok_or("invalid filtered image buffer")?;
            frames.push(image::Frame::from_parts(
                buffer,
                0,
                0,
                original.delay(frame),
            ));
            origins.push(origin);
        }
        Ok(FilteredImage {
            original,
            image: Arc::new(gpui::RenderImage::new(frames)),
            origins,
            raster: raster.cloned(),
        })
    }
}

pub(super) struct FilteredImage {
    pub original: Arc<gpui::RenderImage>,
    pub image: Arc<gpui::RenderImage>,
    /// Top-left of each expanded output frame relative to its source frame.
    pub origins: Vec<[i32; 2]>,
    pub raster: Option<RasterGeometry>,
}

fn check_cancel(cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed)) {
        Err("obsolete image filter job".into())
    } else {
        Ok(())
    }
}

fn finite(input: &str) -> Result<f32, String> {
    let value: f32 = input.trim().parse().map_err(|_| "invalid filter number")?;
    if value.is_finite() {
        Ok(if value == 0.0 { 0.0 } else { value })
    } else {
        Err("non-finite filter number".into())
    }
}

fn length(value: &str) -> Result<f32, String> {
    if let Some(number) = value.strip_suffix("px") {
        finite(number)
    } else {
        let number = finite(value)?;
        if number == 0.0 {
            Ok(number)
        } else {
            Err("image filter lengths require px".into())
        }
    }
}

fn angle(value: &str) -> Result<f32, String> {
    if value.is_empty() {
        return Ok(0.0);
    }
    for (unit, factor) in [
        ("grad", std::f32::consts::PI / 200.0),
        ("deg", std::f32::consts::PI / 180.0),
        ("rad", 1.0),
        ("turn", std::f32::consts::TAU),
    ] {
        if let Some(number) = value.strip_suffix(unit) {
            let result = finite(number)? * factor;
            return if result.is_finite() {
                Ok(result)
            } else {
                Err("non-finite filter angle".into())
            };
        }
    }
    let number = finite(value)?;
    if number == 0.0 {
        Ok(0.0)
    } else {
        Err("hue-rotate requires an angle unit".into())
    }
}

fn shadow(value: &str) -> Result<Filter, String> {
    // Split only outside color-function parentheses, allowing modern space
    // syntax and legacy comma-separated rgba() without disturbing either.
    let mut tokens = Vec::new();
    let mut depth = 0;
    let mut start = 0;
    for (index, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth == 0 && ch.is_whitespace() {
            if start < index {
                tokens.push(&value[start..index]);
            }
            start = index + ch.len_utf8();
        }
    }
    if start < value.len() {
        tokens.push(&value[start..]);
    }
    let mut lengths = Vec::new();
    let mut color = None;
    let mut has_color = false;
    for token in tokens {
        if let Ok(number) = length(token) {
            lengths.push(number);
        } else {
            if has_color {
                return Err("drop-shadow has more than one color".into());
            }
            has_color = true;
            if token.eq_ignore_ascii_case("currentcolor") {
                continue;
            }
            let parsed =
                crate::color::parse_color_rgba(token).ok_or("invalid drop-shadow color")?;
            color = Some([parsed.b, parsed.g, parsed.r, parsed.a]);
        }
    }
    if !(2..=3).contains(&lengths.len()) {
        return Err("drop-shadow requires two offsets and an optional blur".into());
    }
    let sigma = lengths.get(2).copied().unwrap_or(0.0);
    if sigma < 0.0 {
        return Err("drop-shadow blur cannot be negative".into());
    }
    Ok(Filter::DropShadow {
        x: lengths[0],
        y: lengths[1],
        sigma,
        color,
    })
}

struct Surface {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    /// Unpremultiplied normalized BGRA between operations.
    pixels: Vec<[f32; 4]>,
}

fn pixel_count(width: u32, height: u32) -> Result<usize, String> {
    let count = width as u64 * height as u64;
    // Bound intermediate storage as well as float→integer expansion. This is
    // an asset-processing error, never an allocation on the UI/paint thread.
    if width == 0 || height == 0 || count > 16_777_216 {
        return Err("filtered image exceeds 16 megapixels".into());
    }
    Ok(count as usize)
}

impl Surface {
    /// Sample only the visible objectFit region, at actual display density.
    /// Interpolation is premultiplied: hidden RGB in a transparent texel must
    /// never bleed into an upsampled pixel or its later Gaussian halo.
    fn sample_bgra(
        width: u32,
        height: u32,
        bytes: &[u8],
        raster: &RasterGeometry,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        let count = pixel_count(raster.width, raster.height)?;
        if width == 0 || height == 0 || bytes.len() as u64 != width as u64 * height as u64 * 4 {
            return Err("invalid sampled BGRA source".into());
        }
        let mut pixels = Vec::with_capacity(count);
        let sample = |x: i64, y: i64| {
            let x = x.clamp(0, width as i64 - 1) as usize;
            let y = y.clamp(0, height as i64 - 1) as usize;
            let p = &bytes[(y * width as usize + x) * 4..(y * width as usize + x + 1) * 4];
            let a = p[3] as f32 / 255.0;
            [
                p[0] as f32 / 255.0 * a,
                p[1] as f32 / 255.0 * a,
                p[2] as f32 / 255.0 * a,
                a,
            ]
        };
        for y in 0..raster.height {
            check_cancel(cancel)?;
            let sy = (raster.crop[1]
                + (y as f32 + 0.5) / raster.height as f32 * (raster.crop[3] - raster.crop[1]))
                * height as f32
                - 0.5;
            let iy = sy.floor() as i64;
            let ty = sy - sy.floor();
            for x in 0..raster.width {
                let sx = (raster.crop[0]
                    + (x as f32 + 0.5) / raster.width as f32 * (raster.crop[2] - raster.crop[0]))
                    * width as f32
                    - 0.5;
                let ix = sx.floor() as i64;
                let tx = sx - sx.floor();
                let mut pixel = [0.0; 4];
                for (value, weight) in [
                    (sample(ix, iy), (1.0 - tx) * (1.0 - ty)),
                    (sample(ix + 1, iy), tx * (1.0 - ty)),
                    (sample(ix, iy + 1), (1.0 - tx) * ty),
                    (sample(ix + 1, iy + 1), tx * ty),
                ] {
                    for c in 0..4 {
                        pixel[c] += value[c] * weight;
                    }
                }
                for c in 0..3 {
                    pixel[c] = if pixel[3] > 0.0 {
                        pixel[c] / pixel[3]
                    } else {
                        0.0
                    };
                }
                pixels.push(pixel);
            }
        }
        Ok(Self {
            width: raster.width,
            height: raster.height,
            x: 0,
            y: 0,
            pixels,
        })
    }
    fn clip(
        &mut self,
        clip: &SourceClip,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<(), String> {
        let [left, top, right, bottom] = [
            clip.bounds[0] * self.width as f32,
            clip.bounds[1] * self.height as f32,
            clip.bounds[2] * self.width as f32,
            clip.bounds[3] * self.height as f32,
        ];
        let mut radii = clip.radii.map(|radius| {
            [
                radius[0] * self.width as f32,
                radius[1] * self.height as f32,
            ]
        });
        // CSS reduces all corner radii by one common factor if opposing
        // radii exceed an edge; this also handles narrow image bounds.
        let mut factor = 1.0f32;
        for (available, requested) in [
            (right - left, radii[0][0] + radii[1][0]),
            (right - left, radii[2][0] + radii[3][0]),
            (bottom - top, radii[0][1] + radii[3][1]),
            (bottom - top, radii[1][1] + radii[2][1]),
        ] {
            if requested > 0.0 {
                factor = factor.min(available / requested);
            }
        }
        for radius in &mut radii {
            radius[0] *= factor.max(0.0);
            radius[1] *= factor.max(0.0);
        }
        let contains = |x: f32, y: f32| {
            if x < left || y < top || x >= right || y >= bottom {
                return false;
            }
            for (index, (radius, center)) in radii
                .into_iter()
                .zip([
                    [left + radii[0][0], top + radii[0][1]],
                    [right - radii[1][0], top + radii[1][1]],
                    [right - radii[2][0], bottom - radii[2][1]],
                    [left + radii[3][0], bottom - radii[3][1]],
                ])
                .enumerate()
            {
                let (rx, ry) = (radius[0], radius[1]);
                let relevant = match index {
                    0 => x < center[0] && y < center[1],
                    1 => x > center[0] && y < center[1],
                    2 => x > center[0] && y > center[1],
                    _ => x < center[0] && y > center[1],
                };
                if relevant && rx > 0.0 && ry > 0.0 {
                    return ((x - center[0]) / rx).powi(2) + ((y - center[1]) / ry).powi(2) <= 1.0;
                }
            }
            true
        };
        for y in 0..self.height {
            check_cancel(cancel)?;
            for x in 0..self.width {
                let mut coverage = 0;
                for dy in [0.25, 0.75] {
                    for dx in [0.25, 0.75] {
                        coverage += contains(x as f32 + dx, y as f32 + dy) as u32;
                    }
                }
                self.pixels[(y * self.width + x) as usize][3] *= coverage as f32 * 0.25;
            }
        }
        Ok(())
    }
    fn from_bgra(
        width: u32,
        height: u32,
        bytes: &[u8],
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        let count = pixel_count(width, height)?;
        if bytes.len() != count * 4 {
            return Err("invalid BGRA image buffer".into());
        }
        let mut pixels = Vec::with_capacity(count);
        for row in bytes.chunks_exact(width as usize * 4) {
            check_cancel(cancel)?;
            pixels.extend(row.chunks_exact(4).map(|p| {
                [
                    p[0] as f32 / 255.0,
                    p[1] as f32 / 255.0,
                    p[2] as f32 / 255.0,
                    p[3] as f32 / 255.0,
                ]
            }));
        }
        Ok(Self {
            width,
            height,
            x: 0,
            y: 0,
            pixels,
        })
    }

    fn into_bgra(self, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::with_capacity(self.pixels.len() * 4);
        for row in self.pixels.chunks_exact(self.width as usize) {
            check_cancel(cancel)?;
            bytes.extend(
                row.iter()
                    .flat_map(|p| p.map(|value| (value.clamp(0.0, 1.0) * 255.0).round() as u8)),
            );
        }
        Ok(bytes)
    }

    fn apply(
        &mut self,
        op: &Filter,
        scale: [f32; 2],
        current_color: [f32; 4],
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<(), String> {
        match *op {
            Filter::Blur(sigma) => {
                if sigma > 0.0 {
                    let sigma = [sigma * scale[0], sigma * scale[1]];
                    let pad = [radius(sigma[0])?, radius(sigma[1])?];
                    self.expand(-pad[0], -pad[1], pad[0], pad[1])?;
                    premultiply(&mut self.pixels);
                    gaussian(&mut self.pixels, self.width, self.height, sigma, cancel)?;
                    unpremultiply(&mut self.pixels);
                }
            }
            Filter::DropShadow { x, y, sigma, color } => {
                let color = color.unwrap_or(current_color);
                let offsets = [x * scale[0], y * scale[1]];
                if offsets
                    .iter()
                    .any(|value| !value.is_finite() || value.abs() > (i32::MAX / 2) as f32)
                {
                    return Err("drop-shadow offset is too large".into());
                }
                let sigma = [sigma * scale[0], sigma * scale[1]];
                let pad = [radius(sigma[0])? + 1, radius(sigma[1])? + 1];
                let left = (offsets[0].floor() as i64 - pad[0] as i64).min(0);
                let top = (offsets[1].floor() as i64 - pad[1] as i64).min(0);
                let right = (offsets[0].ceil() as i64 + pad[0] as i64).max(0);
                let bottom = (offsets[1].ceil() as i64 + pad[1] as i64).max(0);
                let to_i32 = |number| i32::try_from(number).map_err(|_| "drop-shadow is too large");
                self.expand(to_i32(left)?, to_i32(top)?, to_i32(right)?, to_i32(bottom)?)?;
                let mut alpha: Vec<[f32; 4]> = self.pixels.iter().map(|p| [p[3]; 4]).collect();
                gaussian(&mut alpha, self.width, self.height, sigma, cancel)?;
                for y in 0..self.height {
                    check_cancel(cancel)?;
                    for x in 0..self.width {
                        let index = (y * self.width + x) as usize;
                        let shadow_alpha = sample_alpha(
                            &alpha,
                            self.width,
                            self.height,
                            x as f32 - offsets[0],
                            y as f32 - offsets[1],
                        ) * color[3];
                        let front = self.pixels[index];
                        let out_alpha = front[3] + shadow_alpha * (1.0 - front[3]);
                        let mut out = [0.0; 4];
                        for channel in 0..3 {
                            out[channel] = if out_alpha > 0.0 {
                                (front[channel] * front[3]
                                    + color[channel] * shadow_alpha * (1.0 - front[3]))
                                    / out_alpha
                            } else {
                                0.0
                            };
                        }
                        out[3] = out_alpha;
                        self.pixels[index] = out;
                    }
                }
            }
            _ => {
                for row in self.pixels.chunks_exact_mut(self.width as usize) {
                    check_cancel(cancel)?;
                    for pixel in row {
                        let [b, g, r, a] = *pixel;
                        let mut rgb = [r, g, b];
                        match *op {
                            Filter::Brightness(amount) => rgb = rgb.map(|v| v * amount),
                            Filter::Contrast(amount) => {
                                rgb = rgb.map(|v| amount * v + (1.0 - amount) * 0.5)
                            }
                            Filter::Invert(amount) => {
                                rgb = rgb.map(|v| v * (1.0 - amount) + (1.0 - v) * amount)
                            }
                            Filter::Opacity(amount) => pixel[3] = a * amount,
                            Filter::Saturate(amount) => {
                                let luma = 0.213 * r + 0.715 * g + 0.072 * b;
                                rgb = rgb.map(|v| luma + amount * (v - luma));
                            }
                            Filter::Grayscale(amount) => {
                                let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                                rgb = rgb.map(|v| v + amount * (luma - v));
                            }
                            Filter::Sepia(amount) => {
                                let sepia = [
                                    0.393 * r + 0.769 * g + 0.189 * b,
                                    0.349 * r + 0.686 * g + 0.168 * b,
                                    0.272 * r + 0.534 * g + 0.131 * b,
                                ];
                                for i in 0..3 {
                                    rgb[i] += amount * (sepia[i] - rgb[i]);
                                }
                            }
                            Filter::HueRotate(angle) => {
                                let (s, c) = angle.sin_cos();
                                rgb = [
                                    (0.213 + 0.787 * c - 0.213 * s) * r
                                        + (0.715 - 0.715 * c - 0.715 * s) * g
                                        + (0.072 - 0.072 * c + 0.928 * s) * b,
                                    (0.213 - 0.213 * c + 0.143 * s) * r
                                        + (0.715 + 0.285 * c + 0.140 * s) * g
                                        + (0.072 - 0.072 * c - 0.283 * s) * b,
                                    (0.213 - 0.213 * c - 0.787 * s) * r
                                        + (0.715 - 0.715 * c + 0.715 * s) * g
                                        + (0.072 + 0.928 * c + 0.072 * s) * b,
                                ];
                            }
                            _ => unreachable!(),
                        }
                        pixel[0] = rgb[2].clamp(0.0, 1.0);
                        pixel[1] = rgb[1].clamp(0.0, 1.0);
                        pixel[2] = rgb[0].clamp(0.0, 1.0);
                    }
                }
            }
        }
        Ok(())
    }

    fn expand(&mut self, left: i32, top: i32, right: i32, bottom: i32) -> Result<(), String> {
        let width = u32::try_from(self.width as i64 + right as i64 - left as i64)
            .map_err(|_| "filter width overflow")?;
        let height = u32::try_from(self.height as i64 + bottom as i64 - top as i64)
            .map_err(|_| "filter height overflow")?;
        let mut pixels = vec![[0.0; 4]; pixel_count(width, height)?];
        for row in 0..self.height {
            let from = (row * self.width) as usize;
            let to = ((row as i64 - top as i64) * width as i64 - left as i64) as usize;
            pixels[to..to + self.width as usize]
                .copy_from_slice(&self.pixels[from..from + self.width as usize]);
        }
        self.width = width;
        self.height = height;
        self.x = self.x.checked_add(left).ok_or("filter origin overflow")?;
        self.y = self.y.checked_add(top).ok_or("filter origin overflow")?;
        self.pixels = pixels;
        Ok(())
    }
}

fn radius(sigma: f32) -> Result<i32, String> {
    let radius = (sigma * 3.0).ceil();
    if !radius.is_finite() || radius > 16384.0 {
        return Err("image blur radius is too large".into());
    }
    Ok(radius as i32)
}

fn premultiply(pixels: &mut [[f32; 4]]) {
    for p in pixels {
        for i in 0..3 {
            p[i] *= p[3];
        }
    }
}
fn unpremultiply(pixels: &mut [[f32; 4]]) {
    for p in pixels {
        for i in 0..3 {
            p[i] = if p[3] > 0.0 { p[i] / p[3] } else { 0.0 };
        }
    }
}

fn gaussian(
    pixels: &mut Vec<[f32; 4]>,
    width: u32,
    height: u32,
    sigma: [f32; 2],
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    for axis in 0..2 {
        check_cancel(cancel)?;
        if sigma[axis] <= 0.0 {
            continue;
        }
        // Three sliding boxes approximate a Gaussian in linear time. Keep an
        // exact kernel through 12 raster pixels (4 CSS pixels at 3x DPI), but
        // never do width*height*sigma work for large legal blurs. Transparent
        // expansion supplies zero edges.
        if sigma[axis] > 12.0 {
            for radius in gaussian_box_radii(sigma[axis]) {
                box_blur_axis(pixels, width, height, axis, radius, cancel)?;
            }
            continue;
        }
        let radius = radius(sigma[axis])?;
        let mut kernel: Vec<f32> = (-radius..=radius)
            .map(|i| {
                if i == 0 {
                    1.0
                } else {
                    (-(i as f32).powi(2) / (2.0 * sigma[axis].powi(2))).exp()
                }
            })
            .collect();
        let total: f32 = kernel.iter().sum();
        for value in &mut kernel {
            *value /= total;
        }
        let mut result = vec![[0.0; 4]; pixels.len()];
        for y in 0..height as i32 {
            check_cancel(cancel)?;
            for x in 0..width as i32 {
                let output = &mut result[(y as u32 * width + x as u32) as usize];
                for offset in -radius..=radius {
                    let nx = x + if axis == 0 { offset } else { 0 };
                    let ny = y + if axis == 1 { offset } else { 0 };
                    if nx < 0 || ny < 0 || nx >= width as i32 || ny >= height as i32 {
                        continue;
                    }
                    let input = pixels[(ny as u32 * width + nx as u32) as usize];
                    let weight = kernel[(offset + radius) as usize];
                    for channel in 0..4 {
                        output[channel] += input[channel] * weight;
                    }
                }
            }
        }
        *pixels = result;
    }
    Ok(())
}

fn gaussian_box_radii(sigma: f32) -> [usize; 3] {
    let ideal = (4.0 * sigma * sigma + 1.0).sqrt();
    let mut lower = ideal.floor() as usize;
    if lower % 2 == 0 {
        lower = lower.saturating_sub(1);
    }
    let lower = lower.max(1);
    let lower_f = lower as f32;
    let count = ((12.0 * sigma * sigma - 3.0 * lower_f * lower_f - 12.0 * lower_f - 9.0)
        / (-4.0 * lower_f - 4.0))
        .round()
        .clamp(0.0, 3.0) as usize;
    std::array::from_fn(|i| {
        if i < count {
            (lower - 1) / 2
        } else {
            (lower + 1) / 2
        }
    })
}

fn box_blur_axis(
    pixels: &mut Vec<[f32; 4]>,
    width: u32,
    height: u32,
    axis: usize,
    radius: usize,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    if radius == 0 {
        return Ok(());
    }
    let (lines, length, stride) = if axis == 0 {
        (height as usize, width as usize, 1)
    } else {
        (width as usize, height as usize, width as usize)
    };
    let mut output = vec![[0.0; 4]; pixels.len()];
    let weight = 1.0 / (radius * 2 + 1) as f64;
    for line in 0..lines {
        check_cancel(cancel)?;
        let base = if axis == 0 {
            line * width as usize
        } else {
            line
        };
        let mut sum = [0.0f64; 4];
        for i in 0..=radius.min(length - 1) {
            for channel in 0..4 {
                sum[channel] += pixels[base + i * stride][channel] as f64;
            }
        }
        for i in 0..length {
            let result = &mut output[base + i * stride];
            for channel in 0..4 {
                result[channel] = (sum[channel] * weight) as f32;
            }
            if let Some(remove) = i.checked_sub(radius) {
                for channel in 0..4 {
                    sum[channel] -= pixels[base + remove * stride][channel] as f64;
                }
            }
            let add = i + radius + 1;
            if add < length {
                for channel in 0..4 {
                    sum[channel] += pixels[base + add * stride][channel] as f64;
                }
            }
        }
    }
    *pixels = output;
    Ok(())
}

fn sample_alpha(pixels: &[[f32; 4]], width: u32, height: u32, x: f32, y: f32) -> f32 {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x.floor();
    let ty = y - y.floor();
    let sample = |x: i64, y: i64| {
        if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
            0.0
        } else {
            pixels[(y * width as i64 + x) as usize][3]
        }
    };
    sample(x0, y0) * (1.0 - tx) * (1.0 - ty)
        + sample(x0 + 1, y0) * tx * (1.0 - ty)
        + sample(x0, y0 + 1) * (1.0 - tx) * ty
        + sample(x0 + 1, y0 + 1) * tx * ty
}

#[cfg(test)]
mod tests {
    use super::*;
    fn apply(filter: &str, bytes: Vec<u8>, width: u32) -> FilteredImage {
        let image = Arc::new(
            gpui::RenderImage::from_bgra(width, bytes.len() as u32 / 4 / width, bytes).unwrap(),
        );
        ImageFilters::parse(filter)
            .unwrap()
            .unwrap()
            .apply(image, [1.0; 2], None, None, None, None)
            .unwrap()
    }
    #[test]
    fn image_filters_css_contrast_is_slope_around_half_not_image_crate_percentage() {
        let image = apply("contrast(200%)", vec![64, 128, 192, 117], 1);
        assert_eq!(image.image.as_bytes(0).unwrap(), &[1, 129, 255, 117]);
        assert_eq!(
            apply("contrast(0)", vec![0, 100, 255, 88], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[128, 128, 128, 88]
        );
    }
    #[test]
    fn image_filters_order_clamp_and_alpha_match_css() {
        assert_eq!(
            apply(
                "brightness(2) invert(1) opacity(25%)",
                vec![10, 80, 200, 128],
                1
            )
            .image
            .as_bytes(0)
            .unwrap(),
            &[235, 95, 0, 32]
        );
        assert_ne!(
            apply("invert(1) brightness(2)", vec![10, 80, 200, 128], 1)
                .image
                .as_bytes(0),
            apply("brightness(2) invert(1)", vec![10, 80, 200, 128], 1)
                .image
                .as_bytes(0)
        );
        assert_eq!(
            apply("grayscale(100%)", vec![0, 0, 255, 255], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[54, 54, 54, 255]
        );
        assert_eq!(
            apply("saturate(0)", vec![0, 0, 255, 255], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[54, 54, 54, 255]
        );
        assert_eq!(
            apply("sepia(1)", vec![0, 0, 255, 255], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[69, 89, 100, 255]
        );
        assert_eq!(
            apply("hue-rotate(1turn)", vec![20, 100, 180, 200], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[20, 100, 180, 200]
        );
    }
    #[test]
    fn image_filters_stamp_matrix_matches_css_reference_pixel() {
        assert_eq!(
            apply("saturate(.93) contrast(1.03)", vec![40, 120, 220, 255], 1)
                .image
                .as_bytes(0)
                .unwrap(),
            &[44, 121, 217, 255]
        );
    }
    #[test]
    fn image_filters_blur_uses_premultiplied_alpha_and_transparent_padding() {
        let filtered = apply(
            "blur(1px)",
            vec![255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0],
            3,
        );
        assert_eq!(filtered.origins[0], [-3, -3]);
        assert_eq!(filtered.image.size(0).width.0, 9);
        let pixels: Vec<_> = filtered
            .image
            .as_bytes(0)
            .unwrap()
            .chunks_exact(4)
            .filter(|p| p[3] > 0)
            .collect();
        assert!(pixels.len() > 1);
        assert!(pixels.iter().all(|p| p[0] == 0 && p[1] == 0 && p[2] == 255));
    }
    #[test]
    fn image_filters_shadow_follows_source_alpha_and_expands_without_changing_source() {
        let filtered = apply(
            "drop-shadow(2px 0 red)",
            vec![0, 255, 0, 255, 0, 0, 0, 0],
            2,
        );
        let width = filtered.image.size(0).width.0 as usize;
        let bytes = filtered.image.as_bytes(0).unwrap();
        let at = |x: usize, y: usize| &bytes[(y * width + x) * 4..(y * width + x + 1) * 4];
        let source_x = -filtered.origins[0][0] as usize;
        let source_y = -filtered.origins[0][1] as usize;
        assert_eq!(at(source_x, source_y), &[0, 255, 0, 255]);
        assert_eq!(at(source_x + 1, source_y), &[0, 0, 0, 0]);
        assert_eq!(at(source_x + 2, source_y), &[0, 0, 255, 255]);
        assert_eq!(filtered.original.size(0).width.0, 2);
    }
    #[test]
    fn image_filters_preserve_every_animation_frame_and_rational_delay() {
        let frames: smallvec::SmallVec<[image::Frame; 1]> = [(10, 23, 3), (240, 41, 2)]
            .map(|(red, n, d)| {
                image::Frame::from_parts(
                    image::RgbaImage::from_raw(1, 1, vec![0, 0, red, 255]).unwrap(),
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(n, d),
                )
            })
            .into_iter()
            .collect();
        let original = Arc::new(gpui::RenderImage::new(frames));
        let result = ImageFilters::parse("invert(1)")
            .unwrap()
            .unwrap()
            .apply(original.clone(), [1.0; 2], None, None, None, None)
            .unwrap();
        assert_eq!(result.image.frame_count(), 2);
        for i in 0..2 {
            assert_eq!(result.image.delay(i), original.delay(i));
        }
        assert_eq!(result.image.as_bytes(0).unwrap(), &[255, 255, 245, 255]);
        assert_eq!(result.image.as_bytes(1).unwrap(), &[255, 255, 15, 255]);
    }

    #[test]
    fn image_filters_length_scale_preserves_css_sigma_on_both_axes() {
        let original = Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0, 0, 255, 255]).unwrap());
        let result = ImageFilters::parse("blur(1px)")
            .unwrap()
            .unwrap()
            .apply(original, [2.0, 1.0], None, None, None, None)
            .unwrap();
        assert_eq!(result.origins[0], [-6, -3]);
        assert_eq!(result.image.size(0).width.0, 13);
        assert_eq!(result.image.size(0).height.0, 7);
    }

    #[test]
    fn image_filters_clip_cover_and_round_corners_before_shadow() {
        let original =
            Arc::new(gpui::RenderImage::from_bgra(4, 1, [0, 255, 0, 255].repeat(4)).unwrap());
        let clip = SourceClip {
            bounds: [0.25, 0.0, 0.75, 1.0],
            radii: [[0.0; 2]; 4],
        };
        let result = ImageFilters::parse("drop-shadow(1px 0 red)")
            .unwrap()
            .unwrap()
            .apply(original, [1.0; 2], Some(&clip), None, None, None)
            .unwrap();
        let width = result.image.size(0).width.0 as usize;
        let origin = result.origins[0];
        let bytes = result.image.as_bytes(0).unwrap();
        let at = |x: i32, y: i32| {
            let index = ((y - origin[1]) as usize * width + (x - origin[0]) as usize) * 4;
            &bytes[index..index + 4]
        };
        assert_eq!(at(0, 0), [0, 0, 0, 0]);
        assert_eq!(at(1, 0), [0, 255, 0, 255]);
        assert_eq!(at(2, 0), [0, 255, 0, 255]);
        assert_eq!(at(3, 0), [0, 0, 255, 255]);

        let original =
            Arc::new(gpui::RenderImage::from_bgra(16, 16, [0, 255, 0, 255].repeat(256)).unwrap());
        let clip = SourceClip {
            bounds: [0.0, 0.0, 1.0, 1.0],
            radii: [[0.5; 2]; 4],
        };
        let result = ImageFilters::parse("blur(0)")
            .unwrap()
            .unwrap()
            .apply(original, [1.0; 2], Some(&clip), None, None, None)
            .unwrap();
        let bytes = result.image.as_bytes(0).unwrap();
        assert_eq!(bytes[3], 0);
        assert_eq!(bytes[(8 * 16 + 8) * 4 + 3], 255);
    }

    #[test]
    fn image_filters_multiple_shadows_include_prior_shadow_alpha() {
        let result = apply(
            "drop-shadow(2px 0 red) drop-shadow(2px 0 blue)",
            vec![0, 255, 0, 255],
            1,
        );
        let width = result.image.size(0).width.0 as usize;
        let origin = result.origins[0];
        let bytes = result.image.as_bytes(0).unwrap();
        let at = |x: i32| {
            let index = ((-origin[1]) as usize * width + (x - origin[0]) as usize) * 4;
            &bytes[index..index + 4]
        };
        assert_eq!(at(0), [0, 255, 0, 255]);
        assert_eq!(at(2), [0, 0, 255, 255]);
        assert_eq!(at(4), [255, 0, 0, 255]);
    }

    #[test]
    fn image_filters_fractional_shadow_offsets_keep_alpha_coverage() {
        let result = apply("drop-shadow(.5px 0 red)", vec![0, 255, 0, 255], 1);
        let width = result.image.size(0).width.0 as usize;
        let origin = result.origins[0];
        let index = ((-origin[1]) as usize * width + (1 - origin[0]) as usize) * 4;
        assert_eq!(
            &result.image.as_bytes(0).unwrap()[index..index + 4],
            &[0, 0, 255, 128]
        );
    }

    #[test]
    fn image_filters_shadow_defaults_to_resolved_current_color() {
        let original = Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0, 255, 0, 255]).unwrap());
        let chain = ImageFilters::parse("drop-shadow(2px 0 currentColor)")
            .unwrap()
            .unwrap();
        assert!(chain.uses_current_color());
        let result = chain
            .apply(
                original,
                [1.0; 2],
                None,
                Some([1.0, 0.0, 0.0, 0.5]),
                None,
                None,
            )
            .unwrap();
        let width = result.image.size(0).width.0 as usize;
        let origin = result.origins[0];
        let index = ((-origin[1]) as usize * width + (2 - origin[0]) as usize) * 4;
        assert_eq!(
            &result.image.as_bytes(0).unwrap()[index..index + 4],
            &[255, 0, 0, 128]
        );
        assert!(ImageFilters::parse("drop-shadow(2px 0)")
            .unwrap()
            .unwrap()
            .uses_current_color());
    }

    #[test]
    fn image_filters_extreme_numbers_return_errors_instead_of_overflowing() {
        let original = Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0, 0, 255, 255]).unwrap());
        let huge = ImageFilters::parse("drop-shadow(1e38px 0 red)")
            .unwrap()
            .unwrap();
        assert!(huge
            .apply(original.clone(), [1.0; 2], None, None, None, None)
            .is_err());
        let huge = ImageFilters::parse("blur(1e38px)").unwrap().unwrap();
        assert!(huge
            .apply(original.clone(), [1.0; 2], None, None, None, None)
            .is_err());
        let tiny = ImageFilters::parse("blur(1e-30px)").unwrap().unwrap();
        let result = tiny
            .apply(original, [1.0; 2], None, None, None, None)
            .unwrap();
        let bytes = result.image.as_bytes(0).unwrap();
        assert!(bytes.chunks_exact(4).any(|p| p == [0, 0, 255, 255]));
        assert!(ImageFilters::parse("hue-rotate(1e38turn)").is_err());
    }

    #[test]
    fn image_filters_large_sigma_sliding_boxes_preserve_gaussian_variance() {
        let mut pixels = vec![[0.0; 4]; 301];
        pixels[150] = [1.0; 4];
        gaussian(&mut pixels, 301, 1, [20.0, 0.0], None).unwrap();
        let mass: f32 = pixels.iter().map(|p| p[3]).sum();
        let variance: f32 = pixels
            .iter()
            .enumerate()
            .map(|(i, p)| (i as f32 - 150.0).powi(2) * p[3])
            .sum();
        assert!((mass - 1.0).abs() < 0.00001);
        assert!((variance - 400.0).abs() < 10.0, "variance {variance}");
        for i in 0..150 {
            assert!((pixels[i][3] - pixels[300 - i][3]).abs() < 0.000001);
        }
    }

    #[test]
    fn image_filters_cancelled_assets_stop_before_copying_or_expanding_frames() {
        let original = Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0, 0, 255, 255]).unwrap());
        let cancel = std::sync::atomic::AtomicBool::new(true);
        let filter = ImageFilters::parse("blur(500px)").unwrap().unwrap();
        assert_eq!(
            filter
                .apply(original, [1.0; 2], None, None, Some(&cancel), None)
                .err()
                .as_deref(),
            Some("obsolete image filter job")
        );
    }

    #[test]
    fn image_filters_low_resolution_source_blurs_on_display_pixel_grid() {
        let original = Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0, 0, 255, 255]).unwrap());
        let raster = RasterGeometry {
            crop: [0.0, 0.0, 1.0, 1.0],
            width: 128,
            height: 128,
        };
        let filter = ImageFilters::parse("blur(2px)").unwrap().unwrap();
        let result = filter
            .apply(original, [2.0; 2], None, None, None, Some(&raster))
            .unwrap();
        assert_eq!(result.origins[0], [-12, -12]);
        assert_eq!(result.image.size(0).width.0, 152);
        let bytes = result.image.as_bytes(0).unwrap();
        let width = 152usize;
        let center = &bytes[(76 * width + 76) * 4..(76 * width + 77) * 4];
        assert_eq!(center, [0, 0, 255, 255]);
        let halo = &bytes[(76 * width + 8) * 4..(76 * width + 9) * 4];
        assert_eq!(&halo[..3], [0, 0, 255]);
        assert!(halo[3] > 15 && halo[3] < 100, "halo alpha {}", halo[3]);
    }

    #[test]
    fn image_filters_upscale_sampling_has_no_transparent_rgb_fringes() {
        let original = Arc::new(
            gpui::RenderImage::from_bgra(2, 1, vec![255, 0, 0, 0, 0, 0, 255, 255]).unwrap(),
        );
        let raster = RasterGeometry {
            crop: [0.0, 0.0, 1.0, 1.0],
            width: 64,
            height: 16,
        };
        let result = ImageFilters::parse("blur(0)")
            .unwrap()
            .unwrap()
            .apply(original, [1.0; 2], None, None, None, Some(&raster))
            .unwrap();
        for pixel in result
            .image
            .as_bytes(0)
            .unwrap()
            .chunks_exact(4)
            .filter(|p| p[3] > 0)
        {
            assert_eq!(&pixel[..3], [0, 0, 255]);
        }
    }
    #[test]
    fn image_filters_reject_invalid_lists_and_canonicalize_equivalent_values() {
        for value in [
            "url(x)",
            "contrast(-1)",
            "blur(2)",
            "blur(-1px)",
            "drop-shadow(0 0 -1px red)",
            "invert(1) broken(2)",
            "hue-rotate(30)",
            "brightness(NaN)",
            "blur(1px",
        ] {
            assert!(ImageFilters::parse(value).is_err(), "{value}");
        }
        assert!(ImageFilters::parse("none").unwrap().is_none());
        assert_eq!(
            ImageFilters::parse("saturate(93%) contrast(1.03)")
                .unwrap()
                .unwrap()
                .key,
            ImageFilters::parse("saturate(.93) contrast(103%)")
                .unwrap()
                .unwrap()
                .key
        );
        assert!(ImageFilters::parse("drop-shadow(rgba(0, 0, 0, .2) 1px 2px 3px)").is_ok());
    }
}
