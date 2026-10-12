//! Regression for embedded macOS screenshot capture retaining display drawables.
//! Run with `cargo run --release --example capture_present` on macOS.

#[cfg(target_os = "macos")]
fn main() -> anyhow::Result<()> {
    use gpui::{div, prelude::*, px, rgb, size, Application, Bounds, WindowBounds, WindowOptions};
    use std::{
        cell::RefCell,
        rc::Rc,
        time::{Duration, Instant},
    };

    struct Surface;
    impl Render for Surface {
        fn render(
            &mut self,
            _: &mut gpui::Window,
            _: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            div().size_full().bg(rgb(0x336699))
        }
    }

    let platform = Rc::new(gpui_macos::MacPlatform::new_embedded());
    let opened = Rc::new(RefCell::new(None));
    let opened_for_app = opened.clone();
    let app = Application::with_platform(platform.clone()).run_embedded(move |cx| {
        *opened_for_app.borrow_mut() = Some(cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(128.), px(128.)),
                    cx,
                ))),
                focus: false,
                ..Default::default()
            },
            |_, cx| cx.new(|_| Surface),
        ));
    });
    let window = opened.borrow_mut().take().expect("window callback ran")?;
    platform.pump_events();

    for round in 0..2 {
        for capture in 0..8 {
            let start = Instant::now();
            // Deliberately outside an autorelease pool, like a JS host calling
            // captureScreenshot between AppKit pump turns. Three retained
            // drawables exhaust the layer's pool and stall later presentation.
            let image =
                app.update(|cx| window.update(cx, |_, window, _| window.render_to_image()))??;
            let elapsed = start.elapsed();
            assert_eq!(
                image.get_pixel(image.width() / 2, image.height() / 2).0,
                [0x33, 0x66, 0x99, 255]
            );
            assert!(
                elapsed < Duration::from_millis(250),
                "capture {round}/{capture} blocked for {elapsed:?}"
            );
        }
        let mut worst = Duration::ZERO;
        for _ in 0..20 {
            let start = Instant::now();
            objc2::rc::autoreleasepool(|_| {
                app.update(|cx| window.update(cx, |_, window, _| window.present_cached_frame()))
            })?;
            worst = worst.max(start.elapsed());
            platform.pump_events();
            std::thread::sleep(Duration::from_millis(16));
        }
        println!(
            "round {round}: eight captures, twenty presentations; slowest presentation {worst:?}"
        );
        assert!(
            worst < Duration::from_millis(250),
            "presentation after capture blocked for {worst:?}"
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("capture_present requires macOS and the test-support feature");
}
