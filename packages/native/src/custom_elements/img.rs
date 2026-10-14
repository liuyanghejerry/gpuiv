/// Image custom elements for raster images and tintable SVG icons.
///
/// This provides a native `<img>` for GPUIV Vue apps while keeping the same
/// custom-element prop pipeline (`setCustomProp`/`custom_props`).
///
/// HTTP(S) `src` is a GPUI URI resource. GPUI fetches it through the app
/// `HttpClient` on a background task and paints once decode finishes. A
/// definite `width` and `height` keep the layout box stable during that load.
use super::{CustomElement, CustomElementFactory, CustomRenderContext};
use base64::Engine as _;
use std::{cell::RefCell, rc::Rc, sync::Arc};

type ImageResult = Result<Arc<gpui::RenderImage>, gpui::ImageCacheError>;

/// GPUI's encoded-image decoder is private. This asset only exposes its public
/// `Image::to_image_data` operation to `use_asset`, preserving background decode
/// and GPUI's cache instead of decoding during a paint.
enum EncodedImageLoader {}

impl gpui::Asset for EncodedImageLoader {
    type Source = Arc<gpui::Image>;
    type Output = ImageResult;

    fn load(
        source: Self::Source,
        cx: &mut gpui::App,
    ) -> impl std::future::Future<Output = Self::Output> + Send + 'static {
        let renderer = cx.svg_renderer();
        async move { source.to_image_data(renderer).map_err(Into::into) }
    }
}

struct ImageLoadState {
    alive: bool,
    generation: u64,
    completed: bool,
    src: String,
    id: u64,
    load: bool,
    error: bool,
    callback: Option<crate::renderer::EventCallback>,
}

impl Default for ImageLoadState {
    fn default() -> Self {
        Self {
            alive: true,
            generation: 0,
            completed: false,
            src: String::new(),
            id: 0,
            load: false,
            error: false,
            callback: None,
        }
    }
}

impl ImageLoadState {
    /// Returns an event only for the current, still-mounted source. Layout and
    /// paint can ask for an image repeatedly; load/error are terminal once per
    /// source generation, rather than once per frame (including animated GIFs).
    fn complete(
        &mut self,
        generation: u64,
        result: &ImageResult,
    ) -> Option<(&'static str, String)> {
        if !self.alive || self.generation != generation || self.completed {
            return None;
        }
        self.completed = true;
        match result {
            Ok(image) if self.load => {
                // Public GPUI reports the decoded bitmap in DevicePixels.
                // SVGs rasterized by SvgRenderer are 2x their logical source
                // size for smoothness; GPUI's logical render_size/scale_factor
                // are private. Report actual bitmap dimensions consistently
                // rather than guessing a resource format or bypassing GPUI.
                let size = image.size(0);
                Some((
                    "load",
                    serde_json::json!({ "src": self.src, "generation": generation,
                    "naturalWidth": size.width.0, "naturalHeight": size.height.0 })
                    .to_string(),
                ))
            }
            Err(error) if self.error => Some((
                "error",
                serde_json::json!({ "src": self.src,
                "generation": generation, "error": error.to_string() })
                .to_string(),
            )),
            _ => None,
        }
    }
}

fn complete_image_load(
    state: &Rc<RefCell<ImageLoadState>>,
    generation: u64,
    result: &ImageResult,
) -> bool {
    let (current, event, callback, id) = {
        let mut state = state.borrow_mut();
        let current = state.alive && state.generation == generation;
        let event = state.complete(generation, result);
        (current, event, state.callback.clone(), state.id)
    };
    if let Some((event_type, value)) = event {
        crate::renderer::emit_event_full(&callback, id, event_type, |payload| {
            payload.value = Some(value)
        });
    }
    current
}

pub struct ImgFactory;

pub struct SvgFactory;

impl CustomElementFactory for SvgFactory {
    fn element_type(&self) -> &str {
        "svg"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(SvgElement::default())
    }
}

impl CustomElementFactory for ImgFactory {
    fn element_type(&self) -> &str {
        "img"
    }

    fn create(&self, _id: u64) -> Box<dyn CustomElement> {
        Box::new(ImgElement::default())
    }
}

#[derive(Debug, Clone)]
pub(crate) enum ImgObjectFit {
    Fill,
    Contain,
    Cover,
    ScaleDown,
    None,
}

impl Default for ImgObjectFit {
    fn default() -> Self {
        Self::Contain
    }
}

impl ImgObjectFit {
    pub(crate) fn from_str(value: &str) -> Self {
        match value {
            "fill" => Self::Fill,
            "cover" => Self::Cover,
            "scaleDown" => Self::ScaleDown,
            "none" => Self::None,
            _ => Self::Contain,
        }
    }

    pub(crate) fn as_gpui(&self) -> gpui::ObjectFit {
        match self {
            Self::Fill => gpui::ObjectFit::Fill,
            Self::Contain => gpui::ObjectFit::Contain,
            Self::Cover => gpui::ObjectFit::Cover,
            Self::ScaleDown => gpui::ObjectFit::ScaleDown,
            Self::None => gpui::ObjectFit::None,
        }
    }
}

#[derive(Debug, Clone, Default)]
enum ImgSource {
    #[default]
    Empty,
    Path(std::path::PathBuf),
    Uri(gpui::SharedUri),
    Data(std::sync::Arc<gpui::Image>),
    Render(std::sync::Arc<gpui::RenderImage>),
    Invalid,
}

#[derive(Default)]
pub struct ImgElement {
    source: ImgSource,
    object_fit: ImgObjectFit,
    alt: String,
    dropped: Option<std::sync::Arc<gpui::RenderImage>>,
    load_state: Rc<RefCell<ImageLoadState>>,
    load_task: Option<gpui::Task<()>>,
}

impl ImgElement {
    fn load_src(&mut self, src: &str) {
        self.begin_source(src);
        let src = src.trim();
        self.source = if src.is_empty() {
            ImgSource::Empty
        } else if src.starts_with("data:") {
            // TODO: Replace JSON data URLs with binary mutations to keep base64 decoding off paint.
            decode_image_data_url(src)
                .map(|(format, bytes)| {
                    ImgSource::Data(std::sync::Arc::new(gpui::Image::from_bytes(format, bytes)))
                })
                .unwrap_or(ImgSource::Invalid)
        } else if let Some(uri) = http_image_uri(src) {
            ImgSource::Uri(uri)
        } else {
            ImgSource::Path(src.into())
        };
    }

    fn begin_source(&mut self, src: &str) {
        self.load_task = None;
        let mut state = self.load_state.borrow_mut();
        state.generation += 1;
        state.completed = false;
        state.src = src.to_string();
    }

    fn observe_asset<A: gpui::Asset<Output = ImageResult>>(
        &mut self,
        source: &A::Source,
        window: &gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) {
        if self.load_task.is_some() {
            return;
        }
        let (task, _) = cx.fetch_asset::<A>(source);
        let state = self.load_state.clone();
        let generation = state.borrow().generation;
        let entity_id = cx.entity_id();
        // `use_asset` only subscribes its first consumer for repaint. Observe
        // the shared GPUI task once for this host/source so a second window also
        // paints on completion. Dropping this observer does not cancel the
        // shared asset or evict data used by another image.
        self.load_task = Some(cx.spawn_in(window, async move |_view, cx| {
            let result = task.await;
            if complete_image_load(&state, generation, &result) {
                // Match Window::use_asset: batch resource completions into the
                // next frame. A separate view.update per image can redraw the
                // full window per resource in GPUI's test-support effect loop,
                // starving queued UI commands.
                cx.on_next_frame(move |_, cx| {
                    let state = state.borrow();
                    if state.alive && state.generation == generation {
                        cx.notify(entity_id);
                    }
                });
            }
        }));
    }
}

fn http_image_uri(src: &str) -> Option<gpui::SharedUri> {
    let scheme_end = src.find("://")?;
    let scheme = &src[..scheme_end];
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    (src.len() > scheme_end + 3).then(|| gpui::SharedUri::from(src.to_string()))
}

/// An `<img>`-shaped element for a raw `src` string outside the
/// custom-element pipeline (markdown image blocks). Classifies the source the
/// same way `ImgElement::load_src` does. `None` when the src is empty or a
/// malformed data URL — callers render their own placeholder.
pub(crate) fn standalone_img(
    src: &str,
    id: gpui::SharedString,
) -> Option<gpui::Stateful<gpui::Img>> {
    use gpui::{InteractiveElement as _, StyledImage as _};

    let src = src.trim();
    if src.is_empty() {
        return None;
    }
    let source = if src.starts_with("data:") {
        let (format, bytes) = decode_image_data_url(src)?;
        gpui::ImageSource::Image(std::sync::Arc::new(gpui::Image::from_bytes(format, bytes)))
    } else if let Some(uri) = http_image_uri(src) {
        gpui::ImageSource::from(uri)
    } else {
        gpui::ImageSource::from(std::path::PathBuf::from(src))
    };
    Some(
        gpui::img(source)
            .with_fallback(|| img_notice_box("img: load failed"))
            .id(id),
    )
}

/// The bordered muted box shown where an image element cannot paint content.
/// The message goes through `chrome_text` so a fallback is visible to
/// `getPaintedText()`.
pub(crate) fn img_notice_box(message: &str) -> gpui::AnyElement {
    use gpui::prelude::*;

    gpui::div()
        .flex()
        .items_center()
        .justify_center()
        .bg(gpui::rgba(0x1f2230ff))
        .border(gpui::px(1.0))
        .border_color(gpui::rgba(0x5d6481ff))
        .text_color(gpui::rgba(0xa4accdff))
        .child(crate::text::chrome_text(
            gpui::SharedString::from(message.to_string()),
            None,
        ))
        .into_any_element()
}

/// Install the GPUI HTTP client so `<img src="https://…">` can fetch.
///
/// Desktop Application defaults to `NullHttpClient`, which fails every URI
/// load. One client serves the whole process.
pub fn init(cx: &mut gpui::App) {
    match reqwest_client::ReqwestClient::user_agent("gpuiv") {
        Ok(client) => cx.set_http_client(std::sync::Arc::new(client)),
        Err(error) => log::error!(
            "GPUIV HTTP client failed to start; <img src=\"http…\"> will not load: {error:#}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{http_image_uri, CustomElement, ImageLoadState, ImgElement, ImgSource};

    #[test]
    fn only_http_urls_become_uri_sources() {
        assert!(http_image_uri("https://example.test/a.png").is_some());
        assert!(http_image_uri("HTTP://localhost:9/a.png").is_some());
        assert!(http_image_uri("HTTPS://example.test/a.png").is_some());
        assert!(http_image_uri("/tmp/a.png").is_none());
        assert!(http_image_uri("data:image/png;base64,xx").is_none());
        assert!(http_image_uri("file:///tmp/a.png").is_none());
        assert!(http_image_uri("https://").is_none());
        assert!(http_image_uri("http://").is_none());
    }

    #[test]
    fn image_load_reports_decoded_dimensions_once_per_source() {
        let mut state = ImageLoadState {
            generation: 7,
            src: "  fixture.png  ".into(),
            load: true,
            ..Default::default()
        };
        let image = std::sync::Arc::new(gpui::RenderImage::from_bgra(2, 3, vec![0; 24]).unwrap());
        let result = Ok(image);
        let (kind, value) = state.complete(7, &result).unwrap();
        assert_eq!(kind, "load");
        let value: serde_json::Value = serde_json::from_str(&value).unwrap();
        assert_eq!(value["src"], "  fixture.png  ");
        assert_eq!(value["naturalWidth"], 2);
        assert_eq!(value["naturalHeight"], 3);
        assert!(state.complete(7, &result).is_none());
    }

    #[test]
    fn image_load_rejects_stale_and_destroyed_sources() {
        let mut element = ImgElement::default();
        element.load_src("old.png");
        let old = element.load_state.borrow().generation;
        element.load_src("new.png");
        let current = element.load_state.borrow().generation;
        element.load_state.borrow_mut().error = true;
        let result = Err(gpui::ImageCacheError::Asset("fixture failure".into()));
        assert!(element
            .load_state
            .borrow_mut()
            .complete(old, &result)
            .is_none());
        let (kind, value) = element
            .load_state
            .borrow_mut()
            .complete(current, &result)
            .unwrap();
        assert_eq!(kind, "error");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&value).unwrap()["src"],
            "new.png"
        );
        element.load_src("pending.png");
        let pending = element.load_state.borrow().generation;
        element.destroy();
        assert!(element
            .load_state
            .borrow_mut()
            .complete(pending, &result)
            .is_none());
    }

    #[test]
    fn image_live_updates_keep_the_same_load_generation() {
        let mut element = ImgElement::default();
        let first = std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap());
        assert!(element.replace_live_image(first.clone()).is_none());
        let generation = element.load_state.borrow().generation;
        let second = std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap());
        assert!(element.replace_live_image(second).is_some());
        assert_eq!(element.load_state.borrow().generation, generation);
        assert!(matches!(element.source, ImgSource::Render(_)));
        element.load_src("");
        assert!(matches!(element.source, ImgSource::Empty));
        assert!(element.load_state.borrow().generation > generation);
    }
}

fn img_fallback(ctx: &CustomRenderContext, alt: &str, message: &str) -> gpui::AnyElement {
    use gpui::prelude::*;

    let mut fallback = super::custom_surface(
        gpui::div()
            .id(gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id)))
            .flex()
            .items_center()
            .justify_center()
            .bg(gpui::rgba(0x1f2230ff))
            .border(gpui::px(1.0))
            .border_color(gpui::rgba(0x5d6481ff))
            .text_color(gpui::rgba(0xa4accdff)),
        ctx,
    );
    fallback =
        crate::accessibility::apply_accessibility(fallback, ctx.props, Some(gpui::Role::Image));
    fallback = crate::accessibility::apply_image_label(fallback, ctx.props, alt);
    // `chrome_text`, not a raw string: a raw child is invisible to
    // `getPaintedText()`, so this state could only be tested by screenshot.
    fallback
        .child(ctx.chrome_text(message.to_string(), None))
        .into_any_element()
}

impl CustomElement for ImgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        if let Some(image) = self.dropped.take() {
            window.drop_image(image).ok();
        }

        {
            let mut state = self.load_state.borrow_mut();
            state.id = ctx.id;
            state.callback = ctx.event_callback.clone();
            state.load = ctx.events.contains("load");
            state.error = ctx.events.contains("error");
        }
        let el = match self.source.clone() {
            ImgSource::Path(path) => {
                let resource = gpui::Resource::from(path);
                self.observe_asset::<gpui::ImgResourceLoader>(&resource, window, cx);
                gpui::img(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::ImgResourceLoader>(&resource, cx)
                })
            }
            ImgSource::Uri(uri) => {
                let resource = gpui::Resource::from(uri);
                self.observe_asset::<gpui::ImgResourceLoader>(&resource, window, cx);
                gpui::img(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::ImgResourceLoader>(&resource, cx)
                })
            }
            ImgSource::Data(image) => {
                self.observe_asset::<gpui::AssetLogger<EncodedImageLoader>>(&image, window, cx);
                gpui::img(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::AssetLogger<EncodedImageLoader>>(&image, cx)
                })
            }
            ImgSource::Render(image) => {
                let generation = self.load_state.borrow().generation;
                complete_image_load(&self.load_state, generation, &Ok(image.clone()));
                gpui::img(image)
            }
            ImgSource::Empty => return img_fallback(&ctx, &self.alt, "img: no src"),
            ImgSource::Invalid => {
                let generation = self.load_state.borrow().generation;
                complete_image_load(
                    &self.load_state,
                    generation,
                    &Err(gpui::ImageCacheError::Asset(
                        "invalid image data URL".into(),
                    )),
                );
                return img_fallback(&ctx, &self.alt, "img: load failed");
            }
        };
        // The id is what makes gpui's `ImgState` persist. Without it `Img` has no
        // `GlobalElementId`, so the animated-GIF frame index and the delayed
        // loading state are rebuilt from scratch on every frame and an animation
        // never advances past frame zero.
        let mut el = el
            .object_fit(self.object_fit.as_gpui())
            .with_fallback(|| img_notice_box("img: load failed"))
            .id(gpui::SharedString::from(format!("__gpuix_img_{}", ctx.id)));

        if let Some(style) = ctx.style {
            el = crate::renderer::apply_interactive_styles(el, style);
            // GPUI fills `aspect_ratio` from the bitmap once it loads. That
            // overrides a definite height and jumps the box. A CSS `<img>` with
            // both width and height keeps that box; `objectFit` paints inside it.
            if let (
                Some(crate::style::DimensionValue::Pixels(width)),
                Some(crate::style::DimensionValue::Pixels(height)),
            ) = (style.width.as_ref(), style.height.as_ref())
            {
                if *width > 0.0 && *height > 0.0 {
                    el = el.aspect_ratio((*width as f32) / (*height as f32));
                }
            }
        }

        let mut el =
            crate::accessibility::apply_accessibility(el, ctx.props, Some(gpui::Role::Image));
        el = crate::accessibility::apply_image_label(el, ctx.props, &self.alt);
        let el = super::wire_standard_events(el, &ctx);
        crate::automation::track_own_bounds(el, ctx.id).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => {
                // A live upload owns the bitmap until a real `src` change (not
                // the null a re-render can send) replaces it.
                if value.is_null() && matches!(self.source, ImgSource::Render(_)) {
                    return;
                }
                if let ImgSource::Render(image) = &self.source {
                    self.dropped = Some(image.clone());
                }
                self.load_src(value.as_str().unwrap_or(""));
            }
            "objectFit" => {
                self.object_fit = value
                    .as_str()
                    .map(ImgObjectFit::from_str)
                    .unwrap_or_default()
            }
            "alt" => self.alt = value.as_str().unwrap_or_default().to_string(),
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "objectFit", "alt"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &[
            "click",
            "mouseEnter",
            "mouseLeave",
            "fileDrop",
            "load",
            "error",
        ]
    }

    fn destroy(&mut self) {
        self.load_state.borrow_mut().alive = false;
        self.load_task = None;
    }

    fn live_image(&self) -> Option<std::sync::Arc<gpui::RenderImage>> {
        match &self.source {
            ImgSource::Render(image) => Some(image.clone()),
            _ => None,
        }
    }

    fn replace_live_image(
        &mut self,
        image: std::sync::Arc<gpui::RenderImage>,
    ) -> Option<std::sync::Arc<gpui::RenderImage>> {
        let previous = self.live_image();
        if previous.is_none() {
            let src = self.load_state.borrow().src.clone();
            self.begin_source(&src);
        }
        self.source = ImgSource::Render(image);
        previous
    }

    fn take_dropped_image(&mut self) -> Option<std::sync::Arc<gpui::RenderImage>> {
        self.dropped.take()
    }
}

/// Byte order of a packed live image buffer. GPUI stores the result as BGRA.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PixelFormat {
    Rgba,
    Bgra,
}

impl PixelFormat {
    pub fn parse(format: Option<&str>) -> std::result::Result<Self, String> {
        match format {
            None | Some("rgba") => Ok(Self::Rgba),
            Some("bgra") => Ok(Self::Bgra),
            Some(other) => Err(format!(
                "Unknown pixel format {other:?}, expected \"rgba\" or \"bgra\""
            )),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Rgba => "RGBA",
            Self::Bgra => "BGRA",
        }
    }
}

pub fn render_image_from_pixels(
    width: u32,
    height: u32,
    mut bytes: Vec<u8>,
    format: PixelFormat,
) -> std::result::Result<std::sync::Arc<gpui::RenderImage>, String> {
    let name = format.name();
    let expected = (width as u64)
        .checked_mul(height as u64)
        .and_then(|pixels| pixels.checked_mul(4))
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| format!("{name} pixel buffer {width}x{height} is too large"))?;
    if bytes.len() != expected {
        return Err(format!(
            "{name} pixel buffer length {} does not match {width}x{height} ({expected} bytes)",
            bytes.len(),
        ));
    }
    if format == PixelFormat::Rgba {
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    gpui::RenderImage::from_bgra(width, height, bytes)
        .map(std::sync::Arc::new)
        .ok_or_else(|| format!("{name} pixel buffer is not a valid image"))
}

pub fn render_image_from_encoded(
    bytes: Vec<u8>,
    svg_renderer: gpui::SvgRenderer,
) -> std::result::Result<std::sync::Arc<gpui::RenderImage>, String> {
    let format =
        sniff_image_format(&bytes).ok_or_else(|| "unrecognized image format".to_string())?;
    gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg_renderer)
        .map_err(|error| error.to_string())
}

fn sniff_image_format(bytes: &[u8]) -> Option<gpui::ImageFormat> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some(gpui::ImageFormat::Png)
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        Some(gpui::ImageFormat::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(gpui::ImageFormat::Gif)
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(gpui::ImageFormat::Webp)
    } else if bytes.starts_with(b"BM") {
        Some(gpui::ImageFormat::Bmp)
    } else if bytes.starts_with(&[0x49, 0x49, 0x2A, 0x00])
        || bytes.starts_with(&[0x4D, 0x4D, 0x00, 0x2A])
    {
        Some(gpui::ImageFormat::Tiff)
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        Some(gpui::ImageFormat::Ico)
    } else if bytes.starts_with(b"P1")
        || bytes.starts_with(b"P2")
        || bytes.starts_with(b"P3")
        || bytes.starts_with(b"P4")
        || bytes.starts_with(b"P5")
        || bytes.starts_with(b"P6")
    {
        Some(gpui::ImageFormat::Pnm)
    } else if looks_like_svg(bytes) {
        Some(gpui::ImageFormat::Svg)
    } else {
        None
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let start = std::str::from_utf8(bytes)
        .ok()
        .map(|text| text.trim_start())
        .unwrap_or("");
    start.starts_with("<svg") || start.starts_with("<?xml")
}

#[derive(Debug, Clone, Default)]
pub struct SvgElement {
    src: String,
    bytes: Option<std::sync::Arc<[u8]>>,
    source: String,
}

impl SvgElement {
    fn load_src(&mut self, src: String) {
        self.bytes = svg_bytes(&src).map(std::sync::Arc::from);
        self.src = src;
    }
}

fn svg_bytes(src: &str) -> Option<Vec<u8>> {
    if src.starts_with("data:") {
        let (format, bytes) = decode_image_data_url(src)?;
        return (format == gpui::ImageFormat::Svg).then_some(bytes);
    }
    #[cfg(target_family = "wasm")]
    return None;
    #[cfg(not(target_family = "wasm"))]
    std::fs::read(src).ok()
}

pub(crate) fn decode_image_data_url(src: &str) -> Option<(gpui::ImageFormat, Vec<u8>)> {
    let (metadata, data) = src.strip_prefix("data:")?.split_once(',')?;
    let mut parts = metadata.split(';');
    let mime_type = parts.next()?.to_ascii_lowercase();
    let format = gpui::ImageFormat::from_mime_type(&mime_type)?;
    let is_base64 = parts.any(|part| part.eq_ignore_ascii_case("base64"));
    let bytes = if is_base64 {
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .ok()?
    } else {
        percent_decode(data)
    };
    Some((format, bytes))
}

fn percent_decode(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

impl CustomElement for SvgElement {
    fn render(
        &mut self,
        ctx: CustomRenderContext,
        _window: &mut gpui::Window,
        _cx: &mut gpui::Context<crate::renderer::GpuixView>,
    ) -> gpui::AnyElement {
        use gpui::prelude::*;

        let bytes = if self.source.trim().is_empty() {
            self.bytes.as_deref()
        } else {
            Some(self.source.as_bytes())
        };
        let element_id = gpui::SharedString::from(format!("__gpuix_svg_{}", ctx.id));
        let Some(bytes) = bytes else {
            let empty = super::custom_surface(gpui::div().id(element_id), &ctx);
            return empty.into_any_element();
        };

        let tint = ctx
            .style
            .and_then(|style| style.color.as_deref())
            .and_then(crate::color::parse_color_rgba)
            .unwrap_or_else(|| gpui::rgb(0xe2e2e2).into());
        let mut icon = gpui::svg()
            .data(bytes)
            .flex_none()
            .text_color(tint)
            .id(element_id);
        if let Some(style) = ctx.style {
            icon = crate::renderer::apply_interactive_styles(icon, style);
        }
        icon = crate::accessibility::apply_accessibility(icon, ctx.props, None);
        let icon = super::wire_standard_events(icon, &ctx);
        crate::automation::track_own_bounds(icon, ctx.id).into_any_element()
    }

    fn set_prop(&mut self, key: &str, value: serde_json::Value) {
        match key {
            "src" => self.load_src(value.as_str().unwrap_or_default().to_string()),
            "source" => self.source = value.as_str().unwrap_or_default().to_string(),
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "source"]
    }

    fn supported_events(&self) -> &'static [&'static str] {
        &["click", "mouseEnter", "mouseLeave", "fileDrop"]
    }

    fn destroy(&mut self) {}
}
