/// The `<canvas>` element: a JS-owned pixel buffer that GPUI paints as a
/// grid of textured tiles.
///
/// Pixels never travel through `applyBatch` JSON — uploads are dedicated
/// napi calls (`uploadCanvasPixels` / `uploadCanvasFromContext`), the same
/// relationship `ImageData` has to a DOM canvas. JS keeps its own copy as
/// the source of truth; the store below holds the full canvas as a
/// straight-alpha BGRA mirror and hands GPUI one `RenderImage` per
/// 256×256 tile. A flush splices only the dirty region into the mirror and
/// rebuilds only the tiles it intersects, so the bytes pushed to the GPU
/// atlas scale with the dirty area, not the canvas size. A flush with no
/// pending region uploads nothing at all.
///
/// The sprite atlas is keyed by `RenderImage::id`, and gpui offers no way
/// to update a sub-rect of an existing tile — every changed image is a new
/// allocation plus a full upload of its own bytes. Splitting the canvas
/// into tiles keeps each of those uploads bounded by the tile size, and
/// replaced tiles are released through `Window::drop_image` on the next
/// render so the atlas does not grow while a stroke repaints.
///
/// Tile images carry a 1px duplicated border: the atlas is sampled with a
/// linear filter, so a tile's outer texels would otherwise blend with
/// whatever atlas region sits next to it whenever the canvas paints scaled
/// (a zoomed paint canvas). `CanvasTile` compensates by mapping the inner
/// region — not the border — onto the element box.
use std::collections::HashMap;
use std::panic::Location;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use gpui::prelude::*;

/// Canvas tiles are 256×256: fine-grained enough that a brush stroke
/// touches a handful of tiles, large enough that tile bookkeeping stays
/// cheap for a 4K canvas (a 2880×1920 buffer is a 12×8 grid).
const CANVAS_TILE: usize = 256;

/// An exclusive pixel rectangle within a canvas buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
}

impl Rect {
    fn covering(width: u32, height: u32) -> Self {
        Rect { x0: 0, y0: 0, x1: width, y1: height }
    }

    /// Normalize an `(x, y, w, h)` rectangle against the buffer, or `None`
    /// when it is empty.
    fn from_xywh(x: u32, y: u32, w: u32, h: u32, width: u32, height: u32) -> Option<Self> {
        if w == 0 || h == 0 || x >= width || y >= height {
            return None;
        }
        Some(Rect {
            x0: x.min(width - 1),
            y0: y.min(height - 1),
            x1: x.saturating_add(w).min(width),
            y1: y.saturating_add(h).min(height),
        })
    }

    fn is_empty(&self) -> bool {
        self.x0 >= self.x1 || self.y0 >= self.y1
    }
}

/// Bytes built into tile images — what the GPU renderer's atlas will
/// upload. Shared by every clone of a store, read by the tests that pin
/// upload cost to the dirty area.
#[derive(Default)]
pub struct CanvasStats {
    uploaded_bytes: AtomicU64,
}

impl CanvasStats {
    fn record(&self, bytes: usize) {
        self.uploaded_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
    }
}

/// One uploaded canvas surface: the full BGRA mirror plus the tile images
/// sliced out of it.
struct CanvasSurface {
    width: u32,
    height: u32,
    /// Straight-alpha BGRA, row-major, `width * height * 4` bytes — the
    /// byte order gpui's atlas expects.
    mirror: Vec<u8>,
    tile_cols: usize,
    tile_rows: usize,
    /// One `RenderImage` per tile, indexed `row * tile_cols + col`.
    tiles: Vec<Option<Arc<gpui::RenderImage>>>,
    /// Images replaced by newer flushes, awaiting `Window::drop_image`.
    retired: Vec<Arc<gpui::RenderImage>>,
}

impl CanvasSurface {
    fn new(width: u32, height: u32) -> Self {
        let mirror = vec![0u8; width as usize * height as usize * 4];
        let tile_cols = if width == 0 { 0 } else { (width as usize + CANVAS_TILE - 1) / CANVAS_TILE };
        let tile_rows = if height == 0 { 0 } else { (height as usize + CANVAS_TILE - 1) / CANVAS_TILE };
        CanvasSurface {
            width,
            height,
            mirror,
            tile_cols,
            tile_rows,
            tiles: vec![None; tile_cols * tile_rows],
            retired: Vec::new(),
        }
    }

    /// A size change invalidates everything: fresh mirror, all tiles
    /// retired, like a DOM canvas `width` assignment.
    fn reinit(&mut self, width: u32, height: u32) {
        self.retired.extend(self.tiles.drain(..).flatten());
        *self = CanvasSurface::new(width, height);
    }

    /// Splice `rgba` (a full straight-alpha RGBA buffer, row stride
    /// `width * 4`) into the mirror over `rect` only.
    fn splice_rgba(&mut self, rgba: &[u8], rect: Rect) {
        let width = self.width as usize;
        for row in rect.y0 as usize..rect.y1 as usize {
            let base = (row * width + rect.x0 as usize) * 4;
            for col in 0..(rect.x1 - rect.x0) as usize {
                let i = base + col * 4;
                self.mirror[i] = rgba[i + 2];
                self.mirror[i + 1] = rgba[i + 1];
                self.mirror[i + 2] = rgba[i];
                self.mirror[i + 3] = rgba[i + 3];
            }
        }
    }

    /// Rebuild every tile intersecting `rect` from the mirror.
    fn rebuild_tiles(&mut self, rect: Rect, stats: &CanvasStats) {
        if self.width == 0 || self.height == 0 || rect.is_empty() {
            return;
        }
        let c0 = rect.x0 as usize / CANVAS_TILE;
        let c1 = (rect.x1 as usize).div_ceil(CANVAS_TILE);
        let r0 = rect.y0 as usize / CANVAS_TILE;
        let r1 = (rect.y1 as usize).div_ceil(CANVAS_TILE);
        for row in r0..r1.min(self.tile_rows) {
            for col in c0..c1.min(self.tile_cols) {
                let index = row * self.tile_cols + col;
                if let Some(old) = self.tiles[index].take() {
                    self.retired.push(old);
                }
                let x0 = col * CANVAS_TILE;
                let y0 = row * CANVAS_TILE;
                let x1 = (x0 + CANVAS_TILE).min(self.width as usize);
                let y1 = (y0 + CANVAS_TILE).min(self.height as usize);
                stats.record((x1 - x0 + 2) * (y1 - y0 + 2) * 4);
                self.tiles[index] =
                    Some(build_tile(&self.mirror, self.width as usize, self.height as usize, x0, y0, x1, y1));
            }
        }
    }
}

/// Slice one tile out of the mirror, with a 1px clamped border on every
/// side (see the module docs on linear-filter bleed).
fn build_tile(
    mirror: &[u8],
    width: usize,
    height: usize,
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
) -> Arc<gpui::RenderImage> {
    let tile_w = x1 - x0;
    let tile_h = y1 - y0;
    let stride = (tile_w + 2) * 4;
    let mut buffer = vec![0u8; stride * (tile_h + 2)];
    for row in 0..tile_h + 2 {
        let source_y = (y0 + row).saturating_sub(1).min(height - 1);
        for col in 0..tile_w + 2 {
            let source_x = (x0 + col).saturating_sub(1).min(width - 1);
            let source = (source_y * width + source_x) * 4;
            let destination = row * stride + col * 4;
            buffer[destination] = mirror[source];
            buffer[destination + 1] = mirror[source + 1];
            buffer[destination + 2] = mirror[source + 2];
            buffer[destination + 3] = mirror[source + 3];
        }
    }
    let buffer = image::ImageBuffer::from_raw((tile_w + 2) as u32, (tile_h + 2) as u32, buffer)
        .expect("tile buffer dimensions match its allocation");
    Arc::new(gpui::RenderImage::new(smallvec::smallvec![image::Frame::new(
        buffer
    )]))
}

/// A cheap copy of a surface's tile grid, taken under the store lock for
/// one render pass.
pub(crate) struct CanvasSnapshot {
    pub(crate) width: u32,
    pub(crate) height: u32,
    cols: usize,
    tiles: Vec<Option<Arc<gpui::RenderImage>>>,
}

impl CanvasSnapshot {
    /// The tiles as `(col, row, image)` triples.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (usize, usize, Arc<gpui::RenderImage>)> + '_ {
        self.tiles
            .iter()
            .enumerate()
            .filter_map(|(index, tile)| tile.clone().map(|image| (index % self.cols, index / self.cols, image)))
    }
}

/// Shared store of uploaded canvas pixels, keyed by host element id.
///
/// Lives on `GpuixRenderer`/`TestGpuixRenderer` and is cloned into `GpuixView`,
/// so uploads from the Node thread and paints on the UI thread meet behind one
/// mutex, on every platform.
#[derive(Clone, Default)]
pub struct CanvasStore {
    surfaces: Arc<Mutex<HashMap<u64, CanvasSurface>>>,
    /// Images orphaned by element destruction; the renderer drops them from
    /// the atlas on the next render, the same fate as replaced tiles.
    orphaned: Arc<Mutex<Vec<Arc<gpui::RenderImage>>>>,
    stats: Arc<CanvasStats>,
}

impl CanvasStore {
    /// Upload `rgba` (a full `width * height * 4` straight-alpha RGBA
    /// buffer) over `rect` only — `None` means the whole canvas. GPU-side,
    /// only the tiles intersecting the rect are rebuilt.
    pub fn upload_region(
        &self,
        id: u64,
        width: u32,
        height: u32,
        rgba: &[u8],
        rect: Option<(u32, u32, u32, u32)>,
    ) -> std::result::Result<(), String> {
        let expected = width as usize * height as usize * 4;
        if rgba.len() != expected {
            return Err(format!(
                "canvas buffer for element {id} is {} bytes, expected {expected} for {width}x{height}",
                rgba.len()
            ));
        }

        let mut surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces
            .entry(id)
            .or_insert_with(|| CanvasSurface::new(width, height));
        if surface.width != width || surface.height != height {
            surface.reinit(width, height);
        }
        let rect = match rect {
            Some((x, y, w, h)) => match Rect::from_xywh(x, y, w, h, width, height) {
                Some(rect) => rect,
                // An explicitly empty rect uploads nothing.
                None => return Ok(()),
            },
            None => Rect::covering(width, height),
        };
        surface.splice_rgba(rgba, rect);
        let stats = self.stats.clone();
        surface.rebuild_tiles(rect, &stats);
        Ok(())
    }

    /// Pull the pending dirty region out of a 2D context core, splicing it
    /// straight into the mirror — Rust to Rust, no byte round-trip through
    /// JS and no full-canvas conversion. Returns `false` when nothing was
    /// pending, so the caller can skip the repaint too.
    pub fn upload_from_core(
        &self,
        id: u64,
        ctx: &crate::canvas2d::context::GpuixCanvas2DCore,
    ) -> std::result::Result<bool, String> {
        let (width, height) = ctx.dimensions();
        let mut surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces
            .entry(id)
            .or_insert_with(|| CanvasSurface::new(width, height));
        if surface.width != width || surface.height != height {
            surface.reinit(width, height);
        }
        let Some((x0, y0, x1, y1)) = ctx.flush_dirty_bgra(&mut surface.mirror) else {
            return Ok(false);
        };
        let rect = Rect { x0, y0, x1: x1.min(width), y1: y1.min(height) };
        let stats = self.stats.clone();
        surface.rebuild_tiles(rect, &stats);
        Ok(true)
    }

    /// The stored buffer, converted back to RGBA. Reads the last upload —
    /// JS owns the drawing state, so this is a bridge round-trip check, not
    /// a GPU readback.
    pub fn read(&self, id: u64) -> Option<Vec<u8>> {
        let surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces.get(&id)?;
        let mut rgba = surface.mirror.clone();
        swap_red_blue(&mut rgba);
        Some(rgba)
    }

    /// The tile grid for `build_canvas`.
    pub(crate) fn snapshot(&self, id: u64) -> Option<CanvasSnapshot> {
        let surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces.get(&id)?;
        Some(CanvasSnapshot {
            width: surface.width,
            height: surface.height,
            cols: surface.tile_cols,
            tiles: surface.tiles.clone(),
        })
    }

    /// Bytes built into tile images since the store was created — the
    /// upload cost the GPU renderer pays.
    pub fn uploaded_bytes(&self) -> u64 {
        self.stats.uploaded_bytes.load(Ordering::Relaxed)
    }

    /// Hand replaced and orphaned images to `drop_image` (`Window::
    /// drop_image` on the render thread) so their atlas tiles are freed.
    /// Called at the top of every render, before elements reference the
    /// new tiles.
    pub fn drain_retired(&self, mut drop_image: impl FnMut(Arc<gpui::RenderImage>)) {
        {
            let mut orphaned = self.orphaned.lock().unwrap();
            for image in orphaned.drain(..) {
                drop_image(image);
            }
        }
        let mut surfaces = self.surfaces.lock().unwrap();
        for surface in surfaces.values_mut() {
            for image in surface.retired.drain(..) {
                drop_image(image);
            }
        }
    }

    /// Drop surfaces for elements the last batch destroyed. `applyBatch`
    /// reports destroyed ids as f64. Their images move to the orphan list;
    /// there is no window on this thread, so the atlas frees them on the
    /// next render.
    pub fn remove_destroyed(&self, destroyed: &[f64]) {
        if destroyed.is_empty() {
            return;
        }
        let mut surfaces = self.surfaces.lock().unwrap();
        let mut orphaned = self.orphaned.lock().unwrap();
        for id in destroyed {
            // Element ids are integers carried as f64; truncation recovers
            // them (see `raw_element_id`).
            if let Some(mut surface) = surfaces.remove(&(*id as u64)) {
                orphaned.append(&mut surface.retired);
                for tile in surface.tiles.drain(..).flatten() {
                    orphaned.push(tile);
                }
            }
        }
    }
}

fn swap_red_blue(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
}

/// One grid cell of a painted canvas: lays out as a fraction of the canvas
/// box, then paints its tile image with the inner (border-free) region
/// mapped onto the visible quad.
///
/// The container box is recovered at paint time from the cell's own bounds
/// and its known fraction of the box, which keeps `object_fit` math local:
/// `ObjectFit::get_bounds` over the recovered box yields the same content
/// rect in every tile, so adjacent tiles agree on their shared edges.
struct CanvasTile {
    image: Arc<gpui::RenderImage>,
    object_fit: crate::custom_elements::img::ImgObjectFit,
    canvas_width: u32,
    canvas_height: u32,
    /// The cell's rect as fractions of the container box.
    cell: [f32; 4],
    /// The tile's inner region as fractions of the canvas buffer.
    inner: [f32; 4],
}

impl gpui::Element for CanvasTile {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&gpui::GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> (gpui::LayoutId, ()) {
        let mut style = gpui::Style::default();
        style.position = gpui::Position::Absolute;
        style.inset.left = gpui::Length::Definite(gpui::DefiniteLength::Fraction(self.cell[0]));
        style.inset.top = gpui::Length::Definite(gpui::DefiniteLength::Fraction(self.cell[1]));
        style.size.width = gpui::Length::Definite(gpui::DefiniteLength::Fraction(self.cell[2]));
        style.size.height = gpui::Length::Definite(gpui::DefiniteLength::Fraction(self.cell[3]));
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&gpui::GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        _bounds: gpui::Bounds<gpui::Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _window: &mut gpui::Window,
        _cx: &mut gpui::App,
    ) -> Self::PrepaintState {
    }

    fn paint(
        &mut self,
        _id: Option<&gpui::GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: gpui::Bounds<gpui::Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut gpui::Window,
        _cx: &mut gpui::App,
    ) {
        if self.cell[2] <= 0.0 || self.cell[3] <= 0.0 || self.canvas_width == 0 || self.canvas_height == 0 {
            return;
        }
        let bounds_width = f32::from(bounds.size.width);
        let bounds_height = f32::from(bounds.size.height);
        let box_width = bounds_width / self.cell[2];
        let box_height = bounds_height / self.cell[3];
        let container = gpui::Bounds {
            origin: gpui::point(
                gpui::px(f32::from(bounds.origin.x) - self.cell[0] * box_width),
                gpui::px(f32::from(bounds.origin.y) - self.cell[1] * box_height),
            ),
            size: gpui::size(gpui::px(box_width), gpui::px(box_height)),
        };
        let content = self.object_fit.as_gpui().get_bounds(
            container,
            gpui::size(
                gpui::DevicePixels(self.canvas_width as i32),
                gpui::DevicePixels(self.canvas_height as i32),
            ),
        );
        // This tile's inner region, mapped into the content rect.
        let inner = gpui::Bounds {
            origin: gpui::point(
                gpui::px(f32::from(content.origin.x) + self.inner[0] * f32::from(content.size.width)),
                gpui::px(f32::from(content.origin.y) + self.inner[1] * f32::from(content.size.height)),
            ),
            size: gpui::size(
                gpui::px(self.inner[2] * f32::from(content.size.width)),
                gpui::px(self.inner[3] * f32::from(content.size.height)),
            ),
        };
        let visible = bounds.intersect(&inner);
        if visible.size.width <= gpui::Pixels::ZERO || visible.size.height <= gpui::Pixels::ZERO {
            return;
        }
        // Expand by one canvas pixel on each side so the border texels land
        // outside the visible quad.
        let unit_x = f32::from(content.size.width) / self.canvas_width as f32;
        let unit_y = f32::from(content.size.height) / self.canvas_height as f32;
        let image_bounds = gpui::Bounds {
            origin: gpui::point(
                gpui::px(f32::from(inner.origin.x) - unit_x),
                gpui::px(f32::from(inner.origin.y) - unit_y),
            ),
            size: gpui::size(
                gpui::px(f32::from(inner.size.width) + 2.0 * unit_x),
                gpui::px(f32::from(inner.size.height) + 2.0 * unit_y),
            ),
        };
        let _ = window.paint_image(
            visible,
            image_bounds,
            gpui::Corners::default(),
            self.image.clone(),
            0,
            false,
        );
    }
}

impl gpui::IntoElement for CanvasTile {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

/// Build the GPUI element for a retained `<canvas>`.
///
/// An uploaded surface paints as a grid of tiles stretched to the styled
/// box, with the same `objectFit` semantics one big image had. Before the
/// first upload the element is a styled empty box that still carries every
/// event and the bounds tracker, so a canvas is clickable the moment it
/// mounts.
///
/// The `Name` element id is what lets gpui keep element state across
/// frames; host ids are already unique per renderer.
pub(crate) fn build_canvas(
    element: &crate::retained_tree::RetainedElement,
    style: Option<&crate::style::StyleDesc>,
    surfaces: &CanvasStore,
    event_callback: &Option<crate::renderer::EventCallback>,
    arm_pointer_capture: bool,
) -> gpui::AnyElement {
    let id = element.id;
    let element_id = gpui::SharedString::from(format!("__gpuix_canvas_{id}"));
    let object_fit = element
        .custom_props
        .get("objectFit")
        .and_then(|value| value.as_str())
        .map(crate::custom_elements::img::ImgObjectFit::from_str)
        .unwrap_or_default();

    let Some(snapshot) = surfaces.snapshot(id) else {
        let mut fallback = gpui::div()
            .id(element_id)
            .bg(gpui::rgba(0x1f2230ff))
            .border_1()
            .border_color(gpui::rgba(0x5d6481ff));
        if let Some(style) = style {
            fallback = crate::renderer::apply_interactive_styles(fallback, style);
        }
        if style
            .and_then(|style| style.position.as_deref())
            .is_none()
        {
            fallback = fallback.relative();
        }
        fallback = fallback.child(crate::automation::bounds_tracker(
            id,
            None,
            style
                .map(crate::style::bounds_insets)
                .unwrap_or_default(),
        ));
        let fallback =
            crate::renderer::wire_host_events(fallback, element, event_callback, arm_pointer_capture);
        return fallback.into_any_element();
    };

    let mut grid = gpui::div().id(element_id);
    if style
        .and_then(|style| style.position.as_deref())
        .is_none()
    {
        grid = grid.relative();
    }
    if let Some(style) = style {
        grid = crate::renderer::apply_interactive_styles(grid, style);
    }
    let width = snapshot.width as f32;
    let height = snapshot.height as f32;
    for (col, row, image) in snapshot.iter() {
        let x0 = (col * CANVAS_TILE) as f32;
        let y0 = (row * CANVAS_TILE) as f32;
        let x1 = ((col + 1) * CANVAS_TILE).min(snapshot.width as usize) as f32;
        let y1 = ((row + 1) * CANVAS_TILE).min(snapshot.height as usize) as f32;
        grid = grid.child(CanvasTile {
            image,
            object_fit: object_fit.clone(),
            canvas_width: snapshot.width,
            canvas_height: snapshot.height,
            cell: [x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height],
            inner: [x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height],
        });
    }
    let grid = crate::renderer::wire_host_events(grid, element, event_callback, arm_pointer_capture);
    crate::automation::track_own_bounds(grid, id).into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One pixel: red, green, blue, half-transparent.
    const RGBA: [u8; 16] = [
        255, 0, 0, 255, // red
        0, 255, 0, 255, // green
        0, 0, 255, 255, // blue
        10, 20, 30, 128, // mixed
    ];

    /// The bytes one tile image carries for an inner `w × h` region.
    fn tile_bytes(w: usize, h: usize) -> u64 {
        ((w + 2) * (h + 2) * 4) as u64
    }

    #[test]
    fn upload_and_read_round_trips_rgba() {
        let store = CanvasStore::default();
        store.upload_region(7, 2, 2, &RGBA, None).unwrap();

        assert_eq!(store.read(7).as_deref(), Some(RGBA.as_slice()));
    }

    #[test]
    fn upload_rejects_wrong_buffer_length() {
        let store = CanvasStore::default();
        let error = store.upload_region(7, 2, 2, &RGBA[..12], None).unwrap_err();
        assert!(error.contains("expected 16"), "{error}");
        assert_eq!(store.read(7), None);
    }

    #[test]
    fn destroyed_ids_drop_their_surfaces() {
        let store = CanvasStore::default();
        store.upload_region(1, 1, 1, &RGBA[..4], None).unwrap();
        store.upload_region(2, 1, 1, &RGBA[..4], None).unwrap();

        store.remove_destroyed(&[1.0]);
        assert_eq!(store.read(1), None);
        assert!(store.read(2).is_some());
    }

    #[test]
    fn region_upload_splices_only_the_rect() {
        let store = CanvasStore::default();
        let red = vec![255u8, 0, 0, 255];
        let green = vec![0u8, 255, 0, 255];
        store.upload_region(7, 2, 1, &[red.clone(), red.clone()].concat(), None).unwrap();
        store
            .upload_region(7, 2, 1, &[green.clone(), red.clone()].concat(), Some((0, 0, 1, 1)))
            .unwrap();

        assert_eq!(store.read(7).as_deref(), Some(&[green, red].concat()[..]));
    }

    #[test]
    fn empty_dirty_region_uploads_nothing() {
        let store = CanvasStore::default();
        let full = vec![7u8; 4 * 4 * 4];
        store.upload_region(7, 4, 4, &full, None).unwrap();
        let before = store.uploaded_bytes();

        store
            .upload_region(7, 4, 4, &full, Some((1, 1, 0, 0)))
            .unwrap();
        assert_eq!(store.uploaded_bytes(), before);
    }

    #[test]
    fn uploaded_bytes_scale_with_dirty_area_not_canvas_size() {
        let store = CanvasStore::default();
        let (width, height) = (1024u32, 1024u32);
        let full = vec![128u8; width as usize * height as usize * 4];
        store.upload_region(7, width, height, &full, None).unwrap();
        let after_full = store.uploaded_bytes();
        // A 1024×1024 canvas is a 4×4 tile grid; every tile uploads once.
        assert_eq!(after_full, 16 * tile_bytes(256, 256));

        // A 64×64 stroke near the center touches the 2×2 tiles around
        // (480, 480): four tiles, not sixteen.
        store
            .upload_region(7, width, height, &full, Some((480, 480, 64, 64)))
            .unwrap();
        let after_stroke = store.uploaded_bytes();
        assert_eq!(after_stroke - after_full, 4 * tile_bytes(256, 256));

        // A wider stroke touches more tiles, still proportionally.
        store
            .upload_region(7, width, height, &full, Some((0, 512, 1024, 64)))
            .unwrap();
        let after_strip = store.uploaded_bytes();
        assert_eq!(after_strip - after_stroke, 4 * tile_bytes(256, 256));
        assert!(after_strip - after_full < after_full);
    }

    #[test]
    fn core_flush_uploads_once_and_skips_when_clean() {
        let ctx = crate::canvas2d::context::GpuixCanvas2DCore::new(300.0, 300.0);
        let store = CanvasStore::default();

        // A fill in the top-left corner: one op, one flush, one tile
        // (300×300 is a 2×2 grid of 256×256 / 256×44 / 44×256 / 44×44).
        ctx.set_fill_rgba(0.0, 255.0, 0.0, 1.0);
        assert!(ctx.fill_rect(8.0, 8.0, 64.0, 64.0));
        assert!(store.upload_from_core(7, &ctx).unwrap());
        let after_first = store.uploaded_bytes();
        assert_eq!(after_first, tile_bytes(256, 256));

        // Nothing new: the second flush uploads zero bytes and reports
        // "unchanged" so the renderer skips the repaint.
        assert!(!store.upload_from_core(7, &ctx).unwrap());
        assert_eq!(store.uploaded_bytes(), after_first);

        // A far-corner stroke rebuilds only its own (44×44) tile.
        ctx.set_fill_rgba(255.0, 0.0, 0.0, 1.0);
        assert!(ctx.fill_rect(260.0, 260.0, 30.0, 30.0));
        assert!(store.upload_from_core(7, &ctx).unwrap());
        assert_eq!(store.uploaded_bytes() - after_first, tile_bytes(44, 44));

        // The mirror reflects both strokes.
        let rgba = store.read(7).unwrap();
        let px = |x: usize, y: usize| {
            let i = (y * 300 + x) * 4;
            [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
        };
        assert_eq!(px(20, 20), [0, 255, 0, 255]);
        assert_eq!(px(270, 270), [255, 0, 0, 255]);
        assert_eq!(px(150, 150), [0, 0, 0, 0]);
    }

    #[test]
    fn core_flush_round_trips_through_the_mirror() {
        let ctx = crate::canvas2d::context::GpuixCanvas2DCore::new(2.0, 2.0);
        let store = CanvasStore::default();
        // Half-transparent straight RGBA, premultiplied in the core.
        ctx.set_fill_rgba(255.0, 0.0, 0.0, 0.5);
        assert!(ctx.fill_rect(0.0, 0.0, 1.0, 1.0));
        assert!(store.upload_from_core(7, &ctx).unwrap());

        assert_eq!(
            store.read(7).as_deref(),
            Some([255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].as_slice())
        );
    }

    #[test]
    fn replaced_tiles_are_retired_then_dropped() {
        let store = CanvasStore::default();
        let full = vec![9u8; 8 * 8 * 4];
        store.upload_region(7, 8, 8, &full, None).unwrap();
        let snapshot = store.snapshot(7).unwrap();
        let first: Vec<_> = snapshot.iter().map(|(_, _, image)| image.id).collect();

        // A new flush retires the old tile image…
        store
            .upload_region(7, 8, 8, &vec![1u8; 8 * 8 * 4], Some((0, 0, 4, 4)))
            .unwrap();
        let retired: Vec<_> = {
            let mut ids = Vec::new();
            store.drain_retired(|image| ids.push(image.id));
            ids
        };
        assert_eq!(retired, first);

        // …and draining twice hands nothing out again.
        store.drain_retired(|_| panic!("retired list must be empty after a drain"));
    }

    #[test]
    fn destroyed_surfaces_orphan_their_tiles() {
        let store = CanvasStore::default();
        store.upload_region(7, 8, 8, &vec![3u8; 8 * 8 * 4], None).unwrap();
        store.remove_destroyed(&[7.0]);

        let mut dropped = 0;
        store.drain_retired(|_| dropped += 1);
        assert_eq!(dropped, 1);
        assert_eq!(store.read(7), None);
    }
}
