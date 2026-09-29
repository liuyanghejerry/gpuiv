//! Tray / status-item — GPUI has no tray API (issue #50), so this is
//! GPUIV-owned platform code: `NSStatusItem` on macOS, `Shell_NotifyIconW`
//! on a message-only window on Windows. Linux stays unimplemented
//! (StatusNotifierItem over DBus is its own project) and says so.
//!
//! One tray per process: `set` replaces, `clear` removes. The click
//! callback is a `ThreadsafeFunction` owned by the main-thread tray state.

use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TrayDesc {
    /// Filesystem path of the icon (macOS: any image AppKit reads, 16-18px
    /// logical; Windows: `.ico` preferred, other formats best-effort).
    pub icon_path: String,
    pub tooltip: Option<String>,
    /// macOS: render the icon as a monochrome template that follows the
    /// menu-bar appearance. Default false.
    pub template: Option<bool>,
}

pub(crate) struct TrayRequest {
    pub desc: TrayDesc,
    pub on_click: Option<ThreadsafeFunction<()>>,
}

// ── macOS ─────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod click_slot {
    use std::cell::RefCell;

    use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

    thread_local! {
        pub(super) static CLICK: RefCell<Option<ThreadsafeFunction<()>>> = const { RefCell::new(None) };
    }

    pub(crate) fn emit_click() {
        CLICK.with(|slot| {
            if let Some(callback) = slot.borrow().as_ref() {
                callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        });
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, sel, AnyThread, ClassType, DeclaredClass, MainThreadOnly};
    use objc2_app_kit::{NSControl, NSImage, NSStatusBar, NSStatusItem};
    use objc2_foundation::{MainThreadMarker, NSObject, NSString};

    use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

    use super::{click_slot, TrayDesc, TrayRequest};

    /// `NSVariableThickness`: the item sizes itself to its icon.
    const VARIABLE_THICKNESS: f64 = -1.0;

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; the class does
        // not implement Drop and only holds state in process-level slots.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = ()]
        #[name = "GpuivTrayTarget"]
        struct TrayTarget;

        impl TrayTarget {
            #[unsafe(method(trayClick:))]
            fn tray_click(&self, _sender: Option<&AnyObject>) {
                click_slot::emit_click();
            }
        }

        unsafe impl NSObjectProtocol for TrayTarget {}
    );

    impl TrayTarget {
        fn new(marker: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(marker).set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        static TRAY: RefCell<Option<(Retained<NSStatusItem>, Retained<AnyObject>)>> =
            const { RefCell::new(None) };
    }

    pub(super) fn set(request: TrayRequest) -> Result<(), String> {
        let marker = MainThreadMarker::new()
            .ok_or_else(|| "the tray must be managed on the main thread".to_string())?;
        clear();

        let TrayDesc { icon_path, tooltip, template } = &request.desc;
        let image = unsafe {
            NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(icon_path))
        }
        .ok_or_else(|| format!("tray icon could not be loaded: {icon_path}"))?;
        if template.unwrap_or(false) {
            image.setTemplate(true);
        }

        let bar = NSStatusBar::systemStatusBar();
        let item = bar.statusItemWithLength(VARIABLE_THICKNESS);
        // AppKit does not retain targets; the TRAY slot keeps it alive.
        let target_any: Retained<AnyObject> = unsafe { Retained::cast_unchecked(TrayTarget::new(marker)) };
        if let Some(button) = item.button(marker) {
            unsafe {
                button.setImage(Some(&image));
                if let Some(tooltip) = tooltip {
                    button.setToolTip(Some(&NSString::from_str(tooltip)));
                }
                button.setTarget(Some(&target_any));
                button.setAction(Some(sel!(trayClick:)));
            }
        }

        TRAY.with(|slot| *slot.borrow_mut() = Some((item, target_any)));
        click_slot::CLICK.with(|slot| *slot.borrow_mut() = request.on_click);
        Ok(())
    }

    pub(super) fn clear() {
        TRAY.with(|slot| {
            if let Some((item, _target)) = slot.borrow_mut().take() {
                NSStatusBar::systemStatusBar().removeStatusItem(&item);
            }
        });
        click_slot::CLICK.with(|slot| *slot.borrow_mut() = None);
    }
}

// ── Windows ───────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::Once;

    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NOTIFYICONDATAW, NIM_ADD, NIM_DELETE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, LoadImageW, RegisterClassW,
        HWND_MESSAGE, WINDOW_EX_STYLE, WM_APP, WM_LBUTTONUP, WNDCLASSW, WS_OVERLAPPED,
    };

    use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;
    use napi::threadsafe_function::ThreadsafeFunctionCallMode;

    use super::TrayRequest;

    /// The notify icon's callback message; `lParam` carries the mouse msg.
    const TRAY_CALLBACK: u32 = WM_APP + 1;

    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    static REGISTER: Once = Once::new();
    static CLICK_SLOT: std::sync::Mutex<Option<ThreadsafeFunction<()>>> = std::sync::Mutex::new(None);

    pub(super) fn emit_click() {
        if let Ok(slot) = CLICK_SLOT.lock() {
            if let Some(callback) = slot.as_ref() {
                callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == TRAY_CALLBACK && (lparam.0 & 0xFFFF) as u32 == WM_LBUTTONUP {
            emit_click();
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    fn ensure_window() -> windows::core::Result<HWND> {
        REGISTER.call_once(|| unsafe {
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                lpszClassName: w!("GpuivTrayWnd"),
                ..Default::default()
            };
            RegisterClassW(&class);
        });
        // A message-only window: parent HWND_MESSAGE, any window style.
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("GpuivTrayWnd"),
                w!("GpuivTray"),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }?;
        Ok(hwnd)
    }

    pub(super) fn set(request: TrayRequest) -> Result<(), String> {
        clear();
        let hwnd = ensure_window().map_err(|error| format!("tray window: {error}"))?;
        let icon = unsafe {
            LoadImageW(
                None,
                &windows::core::HSTRING::from(request.desc.icon_path.as_str()),
                windows::Win32::UI::WindowsAndMessaging::IMAGE_ICON,
                0,
                0,
                windows::Win32::UI::WindowsAndMessaging::LR_LOADFROMFILE,
            )
        }
        .map_err(|error| format!("tray icon could not be loaded: {error}"))?;

        let mut data = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 1,
            uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP,
            uCallbackMessage: TRAY_CALLBACK,
            hIcon: windows::Win32::UI::WindowsAndMessaging::HICON(icon.0),
            ..Default::default()
        };
        if let Some(tooltip) = request.desc.tooltip {
            let units: Vec<u16> = tooltip.encode_utf16().take(127).collect();
            for (index, unit) in units.iter().enumerate() {
                data.szTip[index] = *unit;
            }
        }
        let added = unsafe { Shell_NotifyIconW(NIM_ADD, &data) };
        if !added.as_bool() {
            let _ = unsafe { DestroyWindow(hwnd) };
            return Err("Shell_NotifyIconW NIM_ADD failed".to_string());
        }
        if let Ok(mut slot) = CLICK_SLOT.lock() {
            *slot = request.on_click;
        }
        WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
        Ok(())
    }

    pub(super) fn clear() {
        let handle = WINDOW.swap(0, Ordering::SeqCst);
        if handle == 0 {
            return;
        }
        let hwnd = HWND(handle as *mut _);
        unsafe {
            let mut data = NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: hwnd,
                uID: 1,
                ..Default::default()
            };
            let _ = Shell_NotifyIconW(NIM_DELETE, &data);
            let _ = DestroyWindow(hwnd);
            if let Ok(mut slot) = CLICK_SLOT.lock() {
                *slot = None;
            }
        }
    }
}

// ── Shared entry points (renderer.rs / UiCommand call these) ──────────

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::TrayRequest;

    pub(super) fn set(_request: TrayRequest) -> Result<(), String> {
        Err("the tray is implemented on macOS and Windows only".to_string())
    }

    pub(super) fn clear() {}
}

pub(crate) fn set(request: TrayRequest) -> Result<(), String> {
    imp::set(request)
}

pub(crate) fn clear() {
    imp::clear()
}
