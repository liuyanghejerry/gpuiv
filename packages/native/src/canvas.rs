/// The `<canvas>` element: a JS-owned pixel buffer that GPUI paints as a
/// texture every frame.
///
/// Pixels never travel through `applyBatch` JSON — a full-buffer upload is a
/// dedicated napi call (`uploadCanvasPixels`) carrying raw RGBA bytes, the same
/// relationship `ImageData` has to a DOM canvas. JS keeps its own copy as the
/// source of truth; the store below only holds what the GPU needs to paint and
/// what `readCanvasPixels` hands back for color picking and tests.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use gpui::prelude::*;

/// One uploaded canvas surface, in the byte order gpui's sprite atlas expects.
struct CanvasSurface {
    width: u32,
    height: u32,
    image: Arc<gpui::RenderImage>,
}

/// Shared store of uploaded canvas pixels, keyed by host element id.
///
/// Lives on `GpuixRenderer`/`TestGpuixRenderer` and is cloned into `GpuixView`,
/// so uploads from the Node thread and paints on the UI thread meet behind one
/// mutex, on every platform.
#[derive(Clone, Default)]
pub struct CanvasStore {
    surfaces: Arc<Mutex<HashMap<u64, CanvasSurface>>>,
}

impl CanvasStore {
    /// Replace the surface for `id` with `rgba` (4 bytes per pixel, row-major).
    pub fn upload(
        &self,
        id: u64,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) -> std::result::Result<(), String> {
        let expected = width as usize * height as usize * 4;
        if rgba.len() != expected {
            return Err(format!(
                "canvas buffer for element {id} is {} bytes, expected {expected} for {width}x{height}",
                rgba.len()
            ));
        }

        // gpui's atlas consumes BGRA: `decode_static_image_from_decoder` swaps
        // R and B for the same reason before building its `Frame`.
        let mut bgra = rgba.to_vec();
        swap_red_blue(&mut bgra);
        let buffer = image::ImageBuffer::from_raw(width, height, bgra)
            .ok_or_else(|| format!("canvas buffer for element {id} does not fit {width}x{height}"))?;
        let render_image = Arc::new(gpui::RenderImage::new(smallvec::smallvec![image::Frame::new(
            buffer
        )]));

        self.surfaces.lock().unwrap().insert(
            id,
            CanvasSurface {
                width,
                height,
                image: render_image,
            },
        );
        Ok(())
    }

    /// The stored buffer, converted back to RGBA. Reads the last upload —
    /// JS owns the drawing state, so this is a bridge round-trip check, not a
    /// GPU readback.
    pub fn read(&self, id: u64) -> Option<Vec<u8>> {
        let surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces.get(&id)?;
        let mut rgba = surface.image.as_bytes(0)?.to_vec();
        swap_red_blue(&mut rgba);
        Some(rgba)
    }

    /// The rendered image backing this canvas, for `build_canvas`.
    pub fn get(&self, id: u64) -> Option<Arc<gpui::RenderImage>> {
        self.surfaces
            .lock()
            .unwrap()
            .get(&id)
            .map(|surface| surface.image.clone())
    }

    pub fn dimensions(&self, id: u64) -> Option<(u32, u32)> {
        let surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces.get(&id)?;
        Some((surface.width, surface.height))
    }

    /// Drop surfaces for elements the last batch destroyed. `applyBatch`
    /// reports destroyed ids as f64.
    pub fn remove_destroyed(&self, destroyed: &[f64]) {
        if destroyed.is_empty() {
            return;
        }
        let mut surfaces = self.surfaces.lock().unwrap();
        for id in destroyed {
            // Element ids are integers carried as f64; truncation recovers
            // them (see `raw_element_id`).
            surfaces.remove(&(*id as u64));
        }
    }
}

fn swap_red_blue(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
}

/// Build the GPUI element for a retained `<canvas>`.
///
/// An uploaded surface paints through `gpui::img` with the buffer stretched to
/// the styled box (`objectFit: "fill"` — the DOM `drawImage` stretch), so the
/// usual img machinery — corner clipping, object fit — applies. Before the
/// first upload the element is a styled empty box that still carries every
/// event and the bounds tracker, so a canvas is clickable the moment it mounts.
///
/// The `Name` element id is what lets gpui keep `ImgState` (and hover/active)
/// across frames; host ids are already unique per renderer.
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
        .unwrap_or_default()
        .as_gpui();

    let Some(surface) = surfaces.get(id) else {
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

    let mut el = gpui::img(surface).object_fit(object_fit).id(element_id);
    if let Some(style) = style {
        el = crate::renderer::apply_interactive_styles(el, style);
    }
    let el = crate::renderer::wire_host_events(el, element, event_callback, arm_pointer_capture);
    crate::automation::track_own_bounds(el, id).into_any_element()
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

    #[test]
    fn upload_and_read_round_trips_rgba() {
        let store = CanvasStore::default();
        store.upload(7, 2, 2, &RGBA).unwrap();

        assert_eq!(store.dimensions(7), Some((2, 2)));
        assert_eq!(store.read(7).as_deref(), Some(RGBA.as_slice()));
    }

    #[test]
    fn upload_rejects_wrong_buffer_length() {
        let store = CanvasStore::default();
        let error = store.upload(7, 2, 2, &RGBA[..12]).unwrap_err();
        assert!(error.contains("expected 16"), "{error}");
        assert_eq!(store.read(7), None);
    }

    #[test]
    fn destroyed_ids_drop_their_surfaces() {
        let store = CanvasStore::default();
        store.upload(1, 1, 1, &RGBA[..4]).unwrap();
        store.upload(2, 1, 1, &RGBA[..4]).unwrap();

        store.remove_destroyed(&[1.0]);
        assert_eq!(store.read(1), None);
        assert!(store.read(2).is_some());
    }
}
