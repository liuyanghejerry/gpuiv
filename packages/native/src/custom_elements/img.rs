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

#[path = "image_filters.rs"]
pub(crate) mod image_filters;
use image_filters::{FilteredImage, ImageFilters, RasterGeometry, SourceClip};

type FilterResult = Result<Arc<FilteredImage>, gpui::ImageCacheError>;

#[derive(Clone)]
struct FilterAssetSource {
    original: Arc<gpui::RenderImage>,
    filters: Arc<ImageFilters>,
    /// Logical CSS pixels → visible raster pixels, after objectFit and DPI. Color-only
    /// chains use 1:1 and therefore share the same asset at every layout size.
    pixel_scale: [f32; 2],
    clip: Option<SourceClip>,
    current_color: Option<[f32; 4]>,
    // Not part of the asset key: all consumers receive the registry token.
    cancel: Option<Arc<std::sync::atomic::AtomicBool>>,
    raster: Option<RasterGeometry>,
}

impl std::hash::Hash for FilterAssetSource {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.original.id.hash(state);
        self.filters.hash(state);
        self.pixel_scale[0].to_bits().hash(state);
        self.pixel_scale[1].to_bits().hash(state);
        self.clip.hash(state);
        self.current_color
            .map(|color| color.map(f32::to_bits))
            .hash(state);
        self.raster.hash(state);
    }
}

enum FilteredImageLoader {}

impl gpui::Asset for FilteredImageLoader {
    type Source = FilterAssetSource;
    type Output = FilterResult;

    fn load(
        source: Self::Source,
        _cx: &mut gpui::App,
    ) -> impl std::future::Future<Output = Self::Output> + Send + 'static {
        async move {
            source
                .filters
                .apply(
                    source.original,
                    source.pixel_scale,
                    source.clip.as_ref(),
                    source.current_color,
                    source.cancel.as_deref(),
                    source.raster.as_ref(),
                )
                .map(Arc::new)
                .map_err(|message| gpui::ImageCacheError::Asset(message.into()))
        }
    }
}

#[derive(Default)]
struct FilterAssetRegistry(Rc<RefCell<std::collections::HashMap<u64, FilterUsers>>>);
impl gpui::Global for FilterAssetRegistry {}

#[derive(Default)]
struct FilterUsers {
    count: usize,
    epoch: u64,
    windows: std::collections::HashMap<gpui::AnyWindowHandle, usize>,
    retired_windows: std::collections::HashSet<gpui::AnyWindowHandle>,
    cancel: Arc<std::sync::atomic::AtomicBool>,
}

type FilterUsersMap = Rc<RefCell<std::collections::HashMap<u64, FilterUsers>>>;

struct FilterAssetLease {
    source: FilterAssetSource,
    key: u64,
    cleanup: gpui::AsyncApp,
    window: gpui::AnyWindowHandle,
    users: FilterUsersMap,
}

impl FilterAssetLease {
    fn acquire(mut source: FilterAssetSource, window: &gpui::Window, cx: &mut gpui::App) -> Self {
        let key = gpui::hash(&source);
        let users = cx.default_global::<FilterAssetRegistry>().0.clone();
        let handle = window.window_handle();
        {
            let mut entries = users.borrow_mut();
            let entry = entries.entry(key).or_default();
            entry.count += 1;
            entry.epoch += 1;
            *entry.windows.entry(handle).or_default() += 1;
            entry.retired_windows.remove(&handle);
            source.cancel = Some(entry.cancel.clone());
        }
        Self {
            source,
            key,
            cleanup: cx.to_async(),
            window: handle,
            users,
        }
    }
}

impl Drop for FilterAssetLease {
    fn drop(&mut self) {
        let epoch = {
            let mut entries = self.users.borrow_mut();
            let Some(entry) = entries.get_mut(&self.key) else {
                return;
            };
            entry.count -= 1;
            entry.epoch += 1;
            let count = entry
                .windows
                .get_mut(&self.window)
                .expect("image filter lease has a window");
            *count -= 1;
            if *count != 0 {
                return;
            }
            entry.windows.remove(&self.window);
            entry.retired_windows.insert(self.window);
            entry.epoch
        };
        // Destruction can run inside an App borrow. The same public foreground
        // executor used by App::spawn runs this after the current operation.
        // CPU cache eviction belongs to App, not a possibly closed window.
        let cleanup = self.cleanup.clone();
        let source = self.source.clone();
        let key = self.key;
        let window = self.window;
        let users = self.users.clone();
        self.cleanup
            .foreground_executor()
            .spawn(async move {
                cleanup.update(move |cx| {
                    use futures::FutureExt as _;
                    let (drop_atlas, evict, retired) = {
                        let entries = users.borrow();
                        let Some(entry) = entries.get(&key) else {
                            return;
                        };
                        let evict = entry.count == 0 && entry.epoch == epoch;
                        (
                            !entry.windows.contains_key(&window),
                            evict,
                            if evict {
                                entry.retired_windows.iter().copied().collect::<Vec<_>>()
                            } else {
                                vec![window]
                            },
                        )
                    };
                    if !drop_atlas && !evict {
                        return;
                    }
                    let (task, _) = cx.fetch_asset::<FilteredImageLoader>(&source);
                    if drop_atlas {
                        if let Some(Ok(image)) = task.now_or_never() {
                            for window in retired {
                                window
                                    .update(cx, |_, window, _| {
                                        window.drop_image(image.image.clone()).ok();
                                    })
                                    .ok();
                            }
                        }
                    }
                    if evict {
                        if let Some(entry) = users.borrow_mut().remove(&key) {
                            entry
                                .cancel
                                .store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        // This executes even after the source window has closed.
                        cx.remove_asset::<FilteredImageLoader>(&source);
                    }
                });
            })
            .detach();
    }
}

#[derive(Default)]
struct FilterPaintState {
    destroyed: bool,
    revision: u64,
    lease: Option<FilterAssetLease>,
    observer: Option<gpui::Task<()>>,
}

impl FilterPaintState {
    fn reset(&mut self) {
        self.revision += 1;
        self.observer = None;
        self.lease = None;
    }
}

#[derive(Default)]
struct FilterAnimation {
    original_id: Option<gpui::ImageId>,
    frame: usize,
    last: Option<web_time::Instant>,
}

impl FilterAnimation {
    fn advance(
        &mut self,
        original: &gpui::RenderImage,
        now: web_time::Instant,
        active: bool,
    ) -> usize {
        if self.original_id != Some(original.id) {
            self.original_id = Some(original.id);
            self.frame = 0;
            self.last = None;
        }
        self.frame = self.frame.min(original.frame_count().saturating_sub(1));
        if original.frame_count() > 1 && active {
            if let Some(last) = self.last {
                let duration = std::time::Duration::from(original.delay(self.frame));
                let elapsed = now - last;
                if elapsed >= duration {
                    self.frame = (self.frame + 1) % original.frame_count();
                    self.last = Some(now - elapsed.saturating_sub(duration));
                }
            } else {
                self.last = Some(now);
            }
        } else {
            self.last = None;
        }
        self.frame
    }
}

/// GPUI's Img remains the owner of intrinsic sizing, styles, events, focus,
/// accessibility, loading fallback, and animation-frame requests. Only the
/// image paint is replaced: public `paint_image` accepts a larger visible
/// region, so blur/shadow overflow need not resize the image's layout box.
/// GPUI's public ImgLayoutState does not expose its current animation frame.
/// Animated images therefore retain one host-owned phase for both filtered and
/// unfiltered paint; toggling a filter cannot resume an old, paused phase. The
/// basis still requests frames and supplies the ordinary loading fallback.
/// This does not patch GPUI state or draw an unfiltered intermediate frame.
struct FilteredImg {
    basis: gpui::Stateful<gpui::Img>,
    original: ImageLookup,
    filters: Option<Arc<ImageFilters>>,
    object_fit: gpui::ObjectFit,
    state: Rc<RefCell<FilterPaintState>>,
    animation: Rc<RefCell<FilterAnimation>>,
    paint_result: Option<FilterResult>,
    frame: usize,
}

type ImageLookup = Arc<dyn Fn(&mut gpui::Window, &mut gpui::App) -> Option<ImageResult>>;

fn image_source_clip(
    bounds: gpui::Bounds<gpui::Pixels>,
    image: gpui::Bounds<gpui::Pixels>,
    radii: gpui::Corners<gpui::Pixels>,
) -> Option<SourceClip> {
    let normalized = [
        (f32::from(bounds.origin.x) - f32::from(image.origin.x)) / f32::from(image.size.width),
        (f32::from(bounds.origin.y) - f32::from(image.origin.y)) / f32::from(image.size.height),
        (f32::from(bounds.origin.x) + f32::from(bounds.size.width) - f32::from(image.origin.x))
            / f32::from(image.size.width),
        (f32::from(bounds.origin.y) + f32::from(bounds.size.height) - f32::from(image.origin.y))
            / f32::from(image.size.height),
    ];
    let corners = [
        f32::from(radii.top_left),
        f32::from(radii.top_right),
        f32::from(radii.bottom_right),
        f32::from(radii.bottom_left),
    ];
    if normalized[0] <= 0.0
        && normalized[1] <= 0.0
        && normalized[2] >= 1.0
        && normalized[3] >= 1.0
        && corners.iter().all(|r| *r <= 0.0)
    {
        return None;
    }
    Some(SourceClip {
        bounds: normalized,
        radii: corners.map(|radius| {
            [
                radius / f32::from(image.size.width),
                radius / f32::from(image.size.height),
            ]
        }),
    })
}

fn image_filter_geometry(
    filters: &ImageFilters,
    _size: gpui::Size<gpui::DevicePixels>,
    bounds: gpui::Bounds<gpui::Pixels>,
    image_bounds: gpui::Bounds<gpui::Pixels>,
    radii: gpui::Corners<gpui::Pixels>,
    density: f32,
) -> ([f32; 2], Option<SourceClip>, Option<RasterGeometry>) {
    if filters.has_lengths() {
        let visible = bounds.intersect(&image_bounds);
        let width = (f32::from(visible.size.width) * density).ceil().max(1.0) as u32;
        let height = (f32::from(visible.size.height) * density).ceil().max(1.0) as u32;
        let raster = RasterGeometry {
            crop: [
                f32::from(visible.origin.x - image_bounds.origin.x)
                    / f32::from(image_bounds.size.width),
                f32::from(visible.origin.y - image_bounds.origin.y)
                    / f32::from(image_bounds.size.height),
                f32::from(visible.origin.x + visible.size.width - image_bounds.origin.x)
                    / f32::from(image_bounds.size.width),
                f32::from(visible.origin.y + visible.size.height - image_bounds.origin.y)
                    / f32::from(image_bounds.size.height),
            ],
            width,
            height,
        };
        (
            [
                width as f32 / f32::from(visible.size.width),
                height as f32 / f32::from(visible.size.height),
            ],
            image_source_clip(bounds, visible, radii),
            Some(raster),
        )
    } else {
        // Pointwise color functions commute with GPUI's own rounded/cover
        // clip. Their cached pixels are independent of every layout dimension.
        ([1.0; 2], None, None)
    }
}

fn filtered_paint_bounds(
    bounds: gpui::Bounds<gpui::Pixels>,
    source: gpui::Bounds<gpui::Pixels>,
    original: gpui::Size<gpui::DevicePixels>,
    output: gpui::Size<gpui::DevicePixels>,
    origin: [i32; 2],
    raster: Option<&RasterGeometry>,
) -> gpui::Bounds<gpui::Pixels> {
    let (source, width, height) = if let Some(raster) = raster {
        // Use the exact GPUI intersection again. Reconstructing its position
        // from source fractions would amplify float error for huge panoramas.
        (
            bounds.intersect(&source),
            raster.width as f32,
            raster.height as f32,
        )
    } else {
        (source, original.width.0 as f32, original.height.0 as f32)
    };
    let scale_x = f32::from(source.size.width) / width;
    let scale_y = f32::from(source.size.height) / height;
    gpui::Bounds::new(
        gpui::point(
            source.origin.x + gpui::px(origin[0] as f32 * scale_x),
            source.origin.y + gpui::px(origin[1] as f32 * scale_y),
        ),
        gpui::size(
            gpui::px(output.width.0 as f32 * scale_x),
            gpui::px(output.height.0 as f32 * scale_y),
        ),
    )
}

fn prepare_filtered_asset(
    paint_state: &Rc<RefCell<FilterPaintState>>,
    source: FilterAssetSource,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) -> Option<FilterResult> {
    let key = gpui::hash(&source);
    let mut state = paint_state.borrow_mut();
    if state.lease.as_ref().map(|lease| lease.key) != Some(key) {
        state.reset();
        state.lease = Some(FilterAssetLease::acquire(source.clone(), window, cx));
        let shared_source = state.lease.as_ref().unwrap().source.clone();
        let (task, _) = cx.fetch_asset::<FilteredImageLoader>(&shared_source);
        let weak = Rc::downgrade(paint_state);
        let revision = state.revision;
        let view = window.current_view();
        state.observer = Some(window.spawn(cx, async move |cx| {
            task.await;
            cx.on_next_frame(move |_, cx| {
                if let Some(state) = weak.upgrade() {
                    let state = state.borrow();
                    if !state.destroyed && state.revision == revision {
                        cx.notify(view);
                    }
                }
            });
        }));
    }
    drop(state);
    window.get_asset::<FilteredImageLoader>(&source, cx)
}

impl gpui::IntoElement for FilteredImg {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl gpui::Element for FilteredImg {
    type RequestLayoutState = <gpui::Stateful<gpui::Img> as gpui::Element>::RequestLayoutState;
    type PrepaintState = <gpui::Stateful<gpui::Img> as gpui::Element>::PrepaintState;

    fn id(&self) -> Option<gpui::ElementId> {
        self.basis.id()
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        self.basis.source_location()
    }
    fn a11y_role(&self) -> Option<gpui::Role> {
        self.basis.a11y_role()
    }
    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        self.basis.write_a11y_info(node);
    }

    fn request_layout(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, Self::RequestLayoutState) {
        let result = self.basis.request_layout(id, inspector, window, cx);
        if let Some(Ok(original)) = (self.original)(window, cx) {
            self.frame = self.animation.borrow_mut().advance(
                &original,
                web_time::Instant::now(),
                window.is_window_active() && !cx.reduce_motion(),
            );
        }
        result
    }

    fn prepaint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        layout: &mut Self::RequestLayoutState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> Self::PrepaintState {
        use gpui::InteractiveElement as _;
        let Some(filters) = self.filters.clone() else {
            return self
                .basis
                .prepaint(id, inspector, bounds, layout, window, cx);
        };
        let Some(Ok(original)) = (self.original)(window, cx) else {
            return self
                .basis
                .prepaint(id, inspector, bounds, layout, window, cx);
        };
        if original.frame_count() == 0 {
            return self
                .basis
                .prepaint(id, inspector, bounds, layout, window, cx);
        }
        let size = original.size(self.frame);
        let image_bounds = self.object_fit.get_bounds(bounds, size);
        let paint_state = self.state.clone();
        let paint_result = &mut self.paint_result;
        self.basis.interactivity().prepaint(
            id,
            inspector,
            bounds,
            bounds.size,
            window,
            cx,
            |style, _, hitbox, window, cx| {
                if f32::from(image_bounds.size.width) <= 0.0
                    || f32::from(image_bounds.size.height) <= 0.0
                {
                    return hitbox;
                }
                let visible = bounds.intersect(&image_bounds);
                if f32::from(visible.size.width) <= 0.0 || f32::from(visible.size.height) <= 0.0 {
                    return hitbox;
                }
                let (pixel_scale, clip, raster) = image_filter_geometry(
                    &filters,
                    size,
                    bounds,
                    image_bounds,
                    style.corner_radii.to_pixels(window.rem_size()),
                    window.scale_factor(),
                );
                let current_color = if filters.uses_current_color() {
                    let color = style
                        .text_style()
                        .and_then(|text| text.color)
                        .unwrap_or(window.text_style().color);
                    let color = gpui::Rgba::from(color);
                    Some([color.b, color.g, color.r, color.a])
                } else {
                    None
                };
                let source = FilterAssetSource {
                    original,
                    filters,
                    pixel_scale,
                    clip,
                    current_color,
                    cancel: None,
                    raster,
                };
                *paint_result = prepare_filtered_asset(&paint_state, source, window, cx);
                hitbox
            },
        )
    }

    fn paint(
        &mut self,
        id: Option<&gpui::GlobalElementId>,
        inspector: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        layout: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) {
        use gpui::InteractiveElement as _;
        // The original source's loading/error fallback remains GPUI-owned.
        let Some(Ok(original)) = (self.original)(window, cx) else {
            self.basis
                .paint(id, inspector, bounds, layout, hitbox, window, cx);
            return;
        };
        let frame = self.frame;
        let has_lengths = self
            .filters
            .as_ref()
            .is_some_and(|filters| filters.has_lengths());
        let paint_data = if self.filters.is_some() {
            self.paint_result
                .clone()
                .and_then(Result::ok)
                .and_then(|filtered| {
                    filtered.origins.get(frame).copied().map(|origin| {
                        (
                            filtered.original.clone(),
                            filtered.image.clone(),
                            origin,
                            filtered.raster.clone(),
                        )
                    })
                })
        } else {
            Some((original.clone(), original, [0, 0], None))
        };
        let object_fit = &self.object_fit;
        self.basis.interactivity().paint(
            id,
            inspector,
            bounds,
            hitbox.as_ref(),
            window,
            cx,
            |style, window, _cx| {
                let Some((original, image, origin, raster)) = paint_data else {
                    return;
                };
                if frame >= original.frame_count() {
                    return;
                }
                let original_size = original.size(frame);
                let source_bounds = object_fit.get_bounds(bounds, original_size);
                let size = image.size(frame);
                let expanded = filtered_paint_bounds(
                    bounds,
                    source_bounds,
                    original_size,
                    size,
                    origin,
                    raster.as_ref(),
                );
                // Filters apply after the source image's own clip. For a plain
                // image the expanded output may overflow, subject to an ancestor's
                // GPUI content mask. Color-only filters keep exact corner clipping.
                let (clip, radii) = if !has_lengths {
                    (bounds, style.corner_radii.to_pixels(window.rem_size()))
                } else {
                    (expanded, gpui::Corners::default())
                };
                if let Err(error) = window.paint_image(clip, expanded, radii, image, frame, false) {
                    log::error!("failed to paint filtered image: {error}");
                }
            },
        );
    }
}

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
    filters: Option<Arc<ImageFilters>>,
    /// Parsed `style.filter`, which native motion rewrites every frame.
    style_filter: Option<(String, Option<Arc<ImageFilters>>)>,
    filter_state: Rc<RefCell<FilterPaintState>>,
    filter_animation: Rc<RefCell<FilterAnimation>>,
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
        self.filter_state.borrow_mut().reset();
        let mut state = self.load_state.borrow_mut();
        state.generation += 1;
        state.completed = false;
        state.src = src.to_string();
    }

    /// A style filter comes from native motion or from the caller's style and
    /// overrides the `filter` prop. Cache the parse so a still target does not
    /// rebuild the asset key every frame.
    fn effective_filters(
        &mut self,
        style: Option<&crate::style::StyleDesc>,
    ) -> Option<Arc<ImageFilters>> {
        let Some(value) = style.and_then(|style| style.filter.as_deref()) else {
            return self.filters.clone();
        };
        if let Some((cached, filters)) = &self.style_filter {
            if cached == value {
                return filters.clone();
            }
        }
        let parsed = match ImageFilters::parse(value) {
            Ok(Some(filters)) => Some(Arc::new(filters)),
            Ok(None) => None,
            Err(error) => {
                log::warn!("ignoring invalid style filter: {error}");
                None
            }
        };
        self.style_filter = Some((value.to_string(), parsed.clone()));
        parsed
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

    #[test]
    fn image_filters_changes_do_not_repeat_source_load_or_reset_generation() {
        let mut element = ImgElement::default();
        element.load_src("fixture.png");
        let generation = element.load_state.borrow().generation;
        element.load_state.borrow_mut().load = true;
        let image = std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap());
        let result = Ok(image);
        assert!(element
            .load_state
            .borrow_mut()
            .complete(generation, &result)
            .is_some());
        let first_revision = element.filter_state.borrow().revision;
        element.set_prop("filter", serde_json::json!("saturate(.93) contrast(1.03)"));
        assert!(element.filters.is_some());
        assert!(element.filter_state.borrow().revision > first_revision);
        assert_eq!(element.load_state.borrow().generation, generation);
        assert!(element
            .load_state
            .borrow_mut()
            .complete(generation, &result)
            .is_none());
        element.set_prop("filter", serde_json::json!("none"));
        assert!(element.filters.is_none());
        assert_eq!(element.load_state.borrow().generation, generation);
        element.set_prop("filter", serde_json::json!("blur(-2px)"));
        assert!(element.filters.is_none());
        element.load_src("next.png");
        assert!(element.load_state.borrow().generation > generation);
        assert!(element
            .load_state
            .borrow_mut()
            .complete(generation, &result)
            .is_none());
        element.destroy();
        assert!(element.filter_state.borrow().destroyed);
    }

    #[test]
    fn style_filter_overrides_the_prop_and_is_cached_by_value() {
        let mut element = ImgElement::default();
        element.set_prop("filter", serde_json::json!("saturate(0.5)"));
        let style: crate::style::StyleDesc =
            serde_json::from_value(serde_json::json!({ "filter": "blur(2px)" })).unwrap();
        let filters = element.effective_filters(Some(&style)).unwrap();
        assert_eq!(filters.to_css(), "blur(2px)");
        let repeated = element.effective_filters(Some(&style)).unwrap();
        assert!(std::sync::Arc::ptr_eq(&filters, &repeated));
        let fallback = element.effective_filters(None).unwrap();
        assert_eq!(fallback.to_css(), "saturate(0.5)");
    }

    #[test]
    fn image_filters_cache_keys_include_source_filter_scale_and_clip() {
        use super::{FilterAssetSource, ImageFilters, SourceClip};
        let original = std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap());
        let source = FilterAssetSource {
            original,
            filters: std::sync::Arc::new(ImageFilters::parse("saturate(93%)").unwrap().unwrap()),
            pixel_scale: [1.0; 2],
            clip: None,
            current_color: None,
            cancel: None,
            raster: None,
        };
        let mut equivalent = source.clone();
        equivalent.filters =
            std::sync::Arc::new(ImageFilters::parse("saturate(.93)").unwrap().unwrap());
        assert_eq!(gpui::hash(&source), gpui::hash(&equivalent));
        let mut changed = source.clone();
        changed.pixel_scale = [2.0; 2];
        assert_ne!(gpui::hash(&source), gpui::hash(&changed));
        changed = source.clone();
        changed.clip = Some(SourceClip {
            bounds: [0.0, 0.0, 0.5, 1.0],
            radii: [[0.0; 2]; 4],
        });
        assert_ne!(gpui::hash(&source), gpui::hash(&changed));
        changed = source.clone();
        changed.original =
            std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap());
        assert_ne!(gpui::hash(&source), gpui::hash(&changed));
    }

    #[test]
    fn image_filters_animation_phase_survives_filter_toggle_and_inactive_time() {
        let frames: smallvec::SmallVec<[image::Frame; 1]> = (0..3)
            .map(|_| {
                image::Frame::from_parts(
                    image::RgbaImage::from_raw(1, 1, vec![0; 4]).unwrap(),
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(100, 1),
                )
            })
            .collect();
        let image = gpui::RenderImage::new(frames);
        let mut phase = super::FilterAnimation::default();
        let start = web_time::Instant::now();
        let at = |ms| start + std::time::Duration::from_millis(ms);
        assert_eq!(phase.advance(&image, at(0), true), 0);
        assert_eq!(phase.advance(&image, at(110), true), 1); // filtered
        assert_eq!(phase.advance(&image, at(210), true), 2); // filter=none
        assert_eq!(phase.advance(&image, at(310), true), 0); // filtered again
        assert_eq!(phase.advance(&image, at(320), false), 0);
        assert_eq!(phase.advance(&image, at(2000), true), 0);
        assert_eq!(phase.advance(&image, at(2110), true), 1);
    }

    #[test]
    fn image_filters_color_assets_share_across_sizes_and_native_corner_clips() {
        use super::{image_filter_geometry, FilterAssetSource, FilteredImageLoader, ImageFilters};
        let app = gpui::TestAppContext::single();
        let original = std::sync::Arc::new(
            gpui::RenderImage::from_bgra(2, 1, vec![40, 120, 220, 255, 0, 0, 255, 255]).unwrap(),
        );
        let filters = std::sync::Arc::new(
            ImageFilters::parse("saturate(.93) contrast(1.03)")
                .unwrap()
                .unwrap(),
        );
        let source_for = |width: f32, height: f32, radius: f32| {
            let bounds = gpui::Bounds::new(
                gpui::point(gpui::px(0.0), gpui::px(0.0)),
                gpui::size(gpui::px(width), gpui::px(height)),
            );
            let image_bounds = gpui::ObjectFit::Cover.get_bounds(bounds, original.size(0));
            let (pixel_scale, clip, raster) = image_filter_geometry(
                &filters,
                original.size(0),
                bounds,
                image_bounds,
                gpui::Corners::all(gpui::px(radius)),
                2.0,
            );
            FilterAssetSource {
                original: original.clone(),
                filters: filters.clone(),
                pixel_scale,
                clip,
                current_color: None,
                cancel: None,
                raster,
            }
        };
        let a = source_for(100.0, 100.0, 10.0);
        let b = source_for(400.0, 30.0, 25.0);
        assert_eq!(gpui::hash(&a), gpui::hash(&b));
        let (first, second) = app.update(|cx| {
            (
                cx.fetch_asset::<FilteredImageLoader>(&a).0,
                cx.fetch_asset::<FilteredImageLoader>(&b).0,
            )
        });
        let (first, second) = app
            .foreground_executor()
            .block_test(async { futures::join!(first, second) });
        let first = first.unwrap();
        let second = second.unwrap();
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert_eq!(&first.image.as_bytes(0).unwrap()[..4], &[44, 121, 217, 255]);
        app.quit();
    }

    #[test]
    fn image_filters_last_window_close_releases_app_asset_and_cancels_obsolete_work() {
        use super::{FilterAssetLease, FilterAssetSource, FilteredImageLoader, ImageFilters};
        let mut app = gpui::TestAppContext::single();
        let window = app.add_empty_window();
        let source = FilterAssetSource {
            original: std::sync::Arc::new(gpui::RenderImage::from_bgra(1, 1, vec![0; 4]).unwrap()),
            filters: std::sync::Arc::new(ImageFilters::parse("contrast(1.1)").unwrap().unwrap()),
            pixel_scale: [1.0; 2],
            clip: None,
            current_color: None,
            cancel: None,
            raster: None,
        };
        let lease =
            window.update(|window, cx| FilterAssetLease::acquire(source.clone(), window, cx));
        let token = lease.source.cancel.clone().unwrap();
        window.cx.update(|cx| {
            cx.fetch_asset::<FilteredImageLoader>(&lease.source);
            assert!(cx.has_asset::<FilteredImageLoader>(&source));
        });
        window.update(|window, _| window.remove_window());
        drop(lease);
        window.cx.run_until_parked();
        window
            .cx
            .update(|cx| assert!(!cx.has_asset::<FilteredImageLoader>(&source)));
        assert!(token.load(std::sync::atomic::Ordering::Relaxed));
        window.cx.quit();
    }

    #[test]
    fn image_filters_fractional_cover_crop_is_sampled_opaque_at_display_density() {
        let original = std::sync::Arc::new(
            gpui::RenderImage::from_bgra(2, 1, [0, 255, 0, 255].repeat(2)).unwrap(),
        );
        let filters = super::ImageFilters::parse("drop-shadow(20px 0 magenta)")
            .unwrap()
            .unwrap();
        let bounds = gpui::Bounds::new(
            gpui::point(gpui::px(12.25), gpui::px(20.75)),
            gpui::size(gpui::px(64.0), gpui::px(64.0)),
        );
        let image_bounds = gpui::ObjectFit::Cover.get_bounds(bounds, original.size(0));
        let (scale, clip, raster) = super::image_filter_geometry(
            &filters,
            original.size(0),
            bounds,
            image_bounds,
            gpui::Corners::default(),
            2.0,
        );
        let raster = raster.unwrap();
        assert_eq!(raster.crop, [0.25, 0.0, 0.75, 1.0]);
        assert_eq!((raster.width, raster.height), (128, 128));
        assert_eq!(scale, [2.0; 2]);
        let result = filters
            .apply(
                original.clone(),
                scale,
                clip.as_ref(),
                None,
                None,
                Some(&raster),
            )
            .unwrap();
        let width = result.image.size(0).width.0 as usize;
        let origin = result.origins[0];
        let bytes = result.image.as_bytes(0).unwrap();
        let at = |x: i32, y: i32| {
            let i = ((y - origin[1]) as usize * width + (x - origin[0]) as usize) * 4;
            &bytes[i..i + 4]
        };
        assert_eq!(at(8, 64), [0, 255, 0, 255]);
        assert_eq!(at(120, 64), [0, 255, 0, 255]);
        assert_eq!(at(148, 64), [255, 0, 255, 255]);
        let painted = super::filtered_paint_bounds(
            bounds,
            image_bounds,
            original.size(0),
            result.image.size(0),
            origin,
            Some(&raster),
        );
        assert!((f32::from(painted.origin.x) - 12.25).abs() < 0.0001);
        assert!((f32::from(painted.origin.y) - (20.75 - 0.5)).abs() < 0.0001);
        assert!((f32::from(painted.size.width) - 84.5).abs() < 0.0001);
    }

    #[test]
    fn image_filters_panorama_samples_only_visible_region_without_float_position_drift() {
        let original = std::sync::Arc::new(
            gpui::RenderImage::from_bgra(100_000, 1, [0, 255, 0, 255].repeat(100_000)).unwrap(),
        );
        let filters = super::ImageFilters::parse("blur(2px)").unwrap().unwrap();
        let bounds = gpui::Bounds::new(
            gpui::point(gpui::px(12.25), gpui::px(20.75)),
            gpui::size(gpui::px(64.0), gpui::px(64.0)),
        );
        let image_bounds = gpui::ObjectFit::Cover.get_bounds(bounds, original.size(0));
        let (scale, clip, raster) = super::image_filter_geometry(
            &filters,
            original.size(0),
            bounds,
            image_bounds,
            gpui::Corners::default(),
            2.0,
        );
        let raster = raster.unwrap();
        assert_eq!((raster.width, raster.height), (128, 128));
        assert!(raster.crop[2] - raster.crop[0] < 0.0001);
        let result = filters
            .apply(
                original.clone(),
                scale,
                clip.as_ref(),
                None,
                None,
                Some(&raster),
            )
            .unwrap();
        assert_eq!(result.image.size(0).width.0, 152);
        let painted = super::filtered_paint_bounds(
            bounds,
            image_bounds,
            original.size(0),
            result.image.size(0),
            result.origins[0],
            Some(&raster),
        );
        assert_eq!(f32::from(painted.origin.x), 6.25);
        assert_eq!(f32::from(painted.origin.y), 14.75);
        assert_eq!(f32::from(painted.size.width), 76.0);
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
        let lookup: ImageLookup = match self.source.clone() {
            ImgSource::Path(path) => {
                let resource = gpui::Resource::from(path);
                self.observe_asset::<gpui::ImgResourceLoader>(&resource, window, cx);
                Arc::new(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::ImgResourceLoader>(&resource, cx)
                })
            }
            ImgSource::Uri(uri) => {
                let resource = gpui::Resource::from(uri);
                self.observe_asset::<gpui::ImgResourceLoader>(&resource, window, cx);
                Arc::new(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::ImgResourceLoader>(&resource, cx)
                })
            }
            ImgSource::Data(image) => {
                self.observe_asset::<gpui::AssetLogger<EncodedImageLoader>>(&image, window, cx);
                Arc::new(move |window: &mut gpui::Window, cx: &mut gpui::App| {
                    window.use_asset::<gpui::AssetLogger<EncodedImageLoader>>(&image, cx)
                })
            }
            ImgSource::Render(image) => {
                let generation = self.load_state.borrow().generation;
                complete_image_load(&self.load_state, generation, &Ok(image.clone()));
                Arc::new(move |_, _| Some(Ok(image.clone())))
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
        let image_source = lookup.clone();
        let el = gpui::img(move |window: &mut gpui::Window, cx: &mut gpui::App| {
            image_source(window, cx)
        });
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
        let el = crate::automation::track_own_bounds(el, ctx.id);
        let animated = lookup(window, cx)
            .is_some_and(|result| result.is_ok_and(|image| image.frame_count() > 1));
        let filters = self.effective_filters(ctx.style);
        if filters.is_some() || animated {
            FilteredImg {
                basis: el,
                original: lookup,
                filters,
                object_fit: self.object_fit.as_gpui(),
                state: self.filter_state.clone(),
                animation: self.filter_animation.clone(),
                paint_result: None,
                frame: 0,
            }
            .into_any_element()
        } else {
            el.into_any_element()
        }
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
            "filter" => {
                self.filters = match ImageFilters::parse(value.as_str().unwrap_or_default()) {
                    Ok(filters) => filters.map(Arc::new),
                    Err(error) => {
                        log::warn!("ignoring invalid <img filter>: {error}");
                        None
                    }
                };
                self.filter_state.borrow_mut().reset();
            }
            _ => {}
        }
    }

    fn supported_props(&self) -> &'static [&'static str] {
        &["src", "objectFit", "alt", "filter"]
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
        let mut filter = self.filter_state.borrow_mut();
        filter.destroyed = true;
        filter.reset();
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
