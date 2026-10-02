//! Dirty pixel bounds grouped by upload tile. Independent strokes in one
//! flush share a rectangle only when they land in the same tile.

/// Existing canvas upload granularity, shared by the raster core and store.
pub(crate) const CANVAS_TILE: usize = 256;
pub(crate) type DirtyRect = (usize, usize, usize, usize);

pub(crate) struct DirtyTiles {
    width: usize,
    height: usize,
    cols: usize,
    rects: Vec<Option<DirtyRect>>,
}

impl DirtyTiles {
    pub(crate) fn new(width: usize, height: usize) -> Self {
        let cols = width.div_ceil(CANVAS_TILE);
        Self {
            width,
            height,
            cols,
            rects: vec![None; cols * height.div_ceil(CANVAS_TILE)],
        }
    }

    pub(crate) fn mark(&mut self, (x0, y0, x1, y1): DirtyRect) {
        let x1 = x1.min(self.width);
        let y1 = y1.min(self.height);
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        for row in y0 / CANVAS_TILE..y1.div_ceil(CANVAS_TILE) {
            for col in x0 / CANVAS_TILE..x1.div_ceil(CANVAS_TILE) {
                let next = (
                    x0.max(col * CANVAS_TILE),
                    y0.max(row * CANVAS_TILE),
                    x1.min((col + 1) * CANVAS_TILE),
                    y1.min((row + 1) * CANVAS_TILE),
                );
                let slot = &mut self.rects[row * self.cols + col];
                *slot = Some(match *slot {
                    Some(previous) => (
                        previous.0.min(next.0),
                        previous.1.min(next.1),
                        previous.2.max(next.2),
                        previous.3.max(next.3),
                    ),
                    None => next,
                });
            }
        }
    }

    pub(crate) fn take(&mut self) -> Vec<DirtyRect> {
        self.rects.iter_mut().filter_map(Option::take).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distant_changes_do_not_include_clean_tiles() {
        let mut dirty = DirtyTiles::new(1024, 1024);
        dirty.mark((8, 8, 24, 24));
        dirty.mark((12, 12, 32, 32));
        dirty.mark((980, 980, 1000, 1000));
        assert_eq!(dirty.take(), vec![(8, 8, 32, 32), (980, 980, 1000, 1000)]);
        assert!(dirty.take().is_empty());
    }

    #[test]
    fn boundary_rects_split_and_clip_to_partial_tiles() {
        let mut dirty = DirtyTiles::new(300, 300);
        dirty.mark((255, 255, 400, 400));
        dirty.mark((500, 500, 600, 600));
        dirty.mark((9, 9, 8, 8));
        assert_eq!(
            dirty.take(),
            vec![
                (255, 255, 256, 256),
                (256, 255, 300, 256),
                (255, 256, 256, 300),
                (256, 256, 300, 300),
            ]
        );
        DirtyTiles::new(0, 0).mark((0, 0, 1, 1));
    }
}
