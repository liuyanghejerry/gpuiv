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

#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct TrayMenuItemDesc {
    /// Displayed title of a normal item.
    pub label: Option<String>,
    /// Stable id delivered to the menu action callback.
    pub id: Option<String>,
    /// Gray the item out and suppress its action.
    pub disabled: Option<bool>,
    /// A horizontal rule instead of an actionable item.
    pub separator: Option<bool>,
}

pub(crate) struct TrayMenuRequest {
    pub items: Option<Vec<TrayMenuItemDesc>>,
    pub on_action: Option<ThreadsafeFunction<String>>,
}

pub(crate) fn validate_menu(items: &[TrayMenuItemDesc], has_action: bool) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    if !has_action {
        return Err("a non-empty tray menu needs an action handler".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    for item in items {
        if item.separator.unwrap_or(false) {
            if item.label.is_some() || item.id.is_some() || item.disabled.is_some() {
                return Err("a tray separator cannot have a label, id, or disabled state".to_string());
            }
            continue;
        }
        let id = item
            .id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "a tray menu item needs a non-empty id or separator: true".to_string())?;
        if item.label.is_none() {
            return Err(format!("tray menu item {id:?} needs a label"));
        }
        if !ids.insert(id) {
            return Err(format!("duplicate tray menu item id: {id}"));
        }
    }
    Ok(())
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
        pub(super) static MENU_ACTION: RefCell<Option<ThreadsafeFunction<String>>> = const { RefCell::new(None) };
        pub(super) static MENU_IDS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) fn emit_click() {
        CLICK.with(|slot| {
            if let Some(callback) = slot.borrow().as_ref() {
                callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        });
    }

    pub(crate) fn emit_menu_action(tag: isize) {
        if tag < 0 {
            return;
        }
        let id = MENU_IDS.with(|slot| slot.borrow().get(tag as usize).cloned());
        let Some(id) = id else {
            return;
        };
        MENU_ACTION.with(|slot| {
            if let Some(callback) = slot.borrow().as_ref() {
                callback.call(Ok(id), ThreadsafeFunctionCallMode::NonBlocking);
            }
        });
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, sel, AnyThread, MainThreadOnly};
    use objc2_app_kit::{NSImage, NSMenu, NSMenuItem, NSStatusBar, NSStatusItem};
    use objc2_foundation::{MainThreadMarker, NSObject, NSString};

    use super::{click_slot, TrayDesc, TrayMenuRequest, TrayRequest};

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

            #[unsafe(method(trayMenuAction:))]
            fn tray_menu_action(&self, sender: Option<&NSMenuItem>) {
                click_slot::emit_menu_action(sender.map(|item| item.tag()).unwrap_or(-1));
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
        let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(icon_path))
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

    pub(super) fn set_menu(request: TrayMenuRequest) -> Result<(), String> {
        let marker = MainThreadMarker::new()
            .ok_or_else(|| "the tray menu must be managed on the main thread".to_string())?;
        let items = request.items.unwrap_or_default();
        TRAY.with(|slot| {
            let borrow = slot.borrow();
            let Some((item, target)) = borrow.as_ref() else {
                return Err("install the tray before setting its menu".to_string());
            };
            if items.is_empty() {
                item.setMenu(None);
                click_slot::MENU_IDS.with(|slot| slot.borrow_mut().clear());
                click_slot::MENU_ACTION.with(|slot| *slot.borrow_mut() = None);
                return Ok(());
            }

            let menu = NSMenu::initWithTitle(NSMenu::alloc(marker), &NSString::from_str(""));
            let mut ids = Vec::new();
            for desc in &items {
                if desc.separator.unwrap_or(false) {
                    menu.addItem(&NSMenuItem::separatorItem(marker));
                    continue;
                }
                let tag = ids.len();
                ids.push(desc.id.clone().unwrap_or_default());
                let menu_item = unsafe {
                    NSMenuItem::initWithTitle_action_keyEquivalent(
                        NSMenuItem::alloc(marker),
                        &NSString::from_str(desc.label.as_deref().unwrap_or_default()),
                        Some(sel!(trayMenuAction:)),
                        &NSString::from_str(""),
                    )
                };
                unsafe { menu_item.setTarget(Some(target)) };
                menu_item.setEnabled(!desc.disabled.unwrap_or(false));
                menu_item.setTag(tag as isize);
                menu.addItem(&menu_item);
            }
            item.setMenu(Some(&menu));
            click_slot::MENU_IDS.with(|slot| *slot.borrow_mut() = ids);
            click_slot::MENU_ACTION.with(|slot| *slot.borrow_mut() = request.on_action);
            Ok(())
        })
    }

    pub(super) fn clear() {
        TRAY.with(|slot| {
            if let Some((item, _target)) = slot.borrow_mut().take() {
                item.setMenu(None);
                NSStatusBar::systemStatusBar().removeStatusItem(&item);
            }
        });
        click_slot::CLICK.with(|slot| *slot.borrow_mut() = None);
        click_slot::MENU_IDS.with(|slot| slot.borrow_mut().clear());
        click_slot::MENU_ACTION.with(|slot| *slot.borrow_mut() = None);
    }
}

// ── Windows ───────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::{Arc, Mutex, Once};

    use windows::core::{w, HSTRING};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NOTIFYICONDATAW, NIM_ADD, NIM_DELETE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
        GetCursorPos, LoadImageW, PostMessageW, RegisterClassW, SetForegroundWindow,
        TrackPopupMenu, HMENU, HWND_MESSAGE, MF_GRAYED, MF_SEPARATOR, MF_STRING, TPM_RETURNCMD,
        TPM_RIGHTBUTTON, WINDOW_EX_STYLE, WM_APP, WM_CONTEXTMENU, WM_LBUTTONUP, WM_NULL,
        WM_RBUTTONUP, WNDCLASSW, WS_OVERLAPPED,
    };

    use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

    use super::{TrayMenuItemDesc, TrayMenuRequest, TrayRequest};

    /// The notify icon's callback message; `lParam` carries the mouse msg.
    const TRAY_CALLBACK: u32 = WM_APP + 1;

    type MenuAction = Arc<ThreadsafeFunction<String>>;

    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    static REGISTER: Once = Once::new();
    static CLICK_SLOT: Mutex<Option<ThreadsafeFunction<()>>> = Mutex::new(None);
    static MENU_STATE: Mutex<Option<(Vec<TrayMenuItemDesc>, Option<MenuAction>)>> = Mutex::new(None);

    pub(super) fn emit_click() {
        if let Ok(slot) = CLICK_SLOT.lock() {
            if let Some(callback) = slot.as_ref() {
                callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }

    fn show_menu(hwnd: HWND) -> Result<(), String> {
        let state = {
            let guard = MENU_STATE
                .lock()
                .map_err(|_| "tray menu state is poisoned".to_string())?;
            guard
                .as_ref()
                .map(|(items, callback)| (items.clone(), callback.clone()))
        };
        let Some((items, on_action)) = state else {
            return Ok(());
        };

        let menu = unsafe { CreatePopupMenu() }.map_err(|error| format!("CreatePopupMenu: {error}"))?;
        struct MenuGuard(HMENU);
        impl Drop for MenuGuard {
            fn drop(&mut self) {
                let _ = unsafe { DestroyMenu(self.0) };
            }
        }
        let _menu = MenuGuard(menu);
        let mut commands = Vec::new();
        for item in items {
            if item.separator.unwrap_or(false) {
                unsafe { AppendMenuW(menu, MF_SEPARATOR, 0, w!("")) }
                    .map_err(|error| format!("AppendMenuW separator: {error}"))?;
                continue;
            }
            let flags = if item.disabled.unwrap_or(false) {
                MF_STRING | MF_GRAYED
            } else {
                MF_STRING
            };
            let label = HSTRING::from(item.label.unwrap_or_default());
            commands.push(item.id.unwrap_or_default());
            unsafe { AppendMenuW(menu, flags, commands.len(), &label) }
                .map_err(|error| format!("AppendMenuW item: {error}"))?;
        }

        let mut point = POINT::default();
        unsafe { GetCursorPos(&mut point) }.map_err(|error| format!("GetCursorPos: {error}"))?;
        let _ = unsafe { SetForegroundWindow(hwnd) };
        let command = unsafe {
            TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                point.x,
                point.y,
                None,
                hwnd,
                None,
            )
        }
        .0 as usize;
        let _ = unsafe { PostMessageW(Some(hwnd), WM_NULL, WPARAM(0), LPARAM(0)) };
        if command > 0 {
            if let Some(id) = commands.get(command - 1).cloned() {
                if let Some(callback) = on_action {
                    callback.call(Ok(id), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        Ok(())
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == TRAY_CALLBACK {
            match (lparam.0 & 0xFFFF) as u32 {
                WM_LBUTTONUP => {
                    emit_click();
                    return LRESULT(0);
                }
                WM_RBUTTONUP | WM_CONTEXTMENU => {
                    if let Err(error) = show_menu(hwnd) {
                        log::error!("failed to show tray menu: {error}");
                    }
                    return LRESULT(0);
                }
                _ => {}
            }
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
                &HSTRING::from(request.desc.icon_path.as_str()),
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

    pub(super) fn set_menu(request: TrayMenuRequest) -> Result<(), String> {
        if WINDOW.load(Ordering::SeqCst) == 0 {
            return Err("install the tray before setting its menu".to_string());
        }
        let items = request.items.unwrap_or_default();
        let next = if items.is_empty() {
            None
        } else {
            Some((items, request.on_action.map(Arc::new)))
        };
        let mut state = MENU_STATE
            .lock()
            .map_err(|_| "tray menu state is poisoned".to_string())?;
        *state = next;
        Ok(())
    }

    pub(super) fn clear() {
        if let Ok(mut slot) = MENU_STATE.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = CLICK_SLOT.lock() {
            *slot = None;
        }
        let handle = WINDOW.swap(0, Ordering::SeqCst);
        if handle == 0 {
            return;
        }
        let hwnd = HWND(handle as *mut _);
        unsafe {
            let data = NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: hwnd,
                uID: 1,
                ..Default::default()
            };
            let _ = Shell_NotifyIconW(NIM_DELETE, &data);
            let _ = DestroyWindow(hwnd);
        }
    }
}

// ── Shared entry points (renderer.rs / UiCommand call these) ──────────

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::{TrayMenuRequest, TrayRequest};

    pub(super) fn set(_request: TrayRequest) -> Result<(), String> {
        Err("the tray is implemented on macOS and Windows only".to_string())
    }

    pub(super) fn set_menu(_request: TrayMenuRequest) -> Result<(), String> {
        Err("the tray menu is implemented on macOS and Windows only".to_string())
    }

    pub(super) fn clear() {}
}

pub(crate) fn set(request: TrayRequest) -> Result<(), String> {
    imp::set(request)
}

pub(crate) fn set_menu(request: TrayMenuRequest) -> Result<(), String> {
    validate_menu(
        request.items.as_deref().unwrap_or(&[]),
        request.on_action.is_some(),
    )?;
    imp::set_menu(request)
}

pub(crate) fn clear() {
    imp::clear()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: Option<&str>, label: Option<&str>) -> TrayMenuItemDesc {
        TrayMenuItemDesc {
            id: id.map(str::to_string),
            label: label.map(str::to_string),
            disabled: None,
            separator: None,
        }
    }

    fn separator() -> TrayMenuItemDesc {
        TrayMenuItemDesc {
            id: None,
            label: None,
            disabled: None,
            separator: Some(true),
        }
    }

    #[test]
    fn menu_validation_accepts_items_and_empty_clears() {
        assert!(validate_menu(&[], false).is_ok());
        assert!(validate_menu(&[item(Some("open"), Some("Open")), separator()], true).is_ok());
    }

    #[test]
    fn menu_validation_requires_a_handler_for_non_empty_menus() {
        let error = validate_menu(&[item(Some("open"), Some("Open"))], false).unwrap_err();
        assert!(error.contains("action handler"));
    }

    #[test]
    fn menu_validation_rejects_missing_empty_and_duplicate_ids() {
        for desc in [item(None, Some("Open")), item(Some("  "), Some("Open"))] {
            assert!(validate_menu(&[desc], true).is_err());
        }
        let items = [item(Some("open"), Some("Open")), item(Some("open"), Some("Again"))];
        assert!(validate_menu(&items, true).unwrap_err().contains("duplicate"));
    }

    #[test]
    fn menu_validation_rejects_missing_labels_and_separator_fields() {
        assert!(validate_menu(&[item(Some("open"), None)], true).is_err());
        for desc in [
            TrayMenuItemDesc { label: Some("rule".into()), ..separator() },
            TrayMenuItemDesc { id: Some("rule".into()), ..separator() },
            TrayMenuItemDesc { disabled: Some(false), ..separator() },
        ] {
            assert!(validate_menu(&[desc], true).is_err());
        }
    }
}
