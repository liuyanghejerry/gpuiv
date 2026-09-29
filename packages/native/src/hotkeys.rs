//! System-wide hotkeys — again GPUIV-owned platform code (GPUI has no
//! global-shortcut API; issue #50). macOS uses Carbon `RegisterEventHotKey`
//! (still the supported route, and the AppKit run loop pumps Carbon events,
//! so no extra loop is needed); Windows uses `RegisterHotKey` on the same
//! kind of message-only window the tray owns. Linux reports unsupported —
//! X11 `XGrabKey` does not survive Wayland, and per-desktop portals have no
//! stable global-shortcut story yet.
//!
//! Registrations key by accelerator string: registering an accelerator
//! again replaces it, and unregister removes it. The trigger callback is a
//! `ThreadsafeFunction` fired on the platform's hotkey event.

use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct HotkeyRequest {
    /// `'+'`-separated modifiers and key, e.g. `"cmd+shift+j"`,
    /// `"ctrl+alt+t"`. Modifiers: `ctrl`, `alt`/`option`, `shift`,
    /// `cmd`/`win`/`super`. Keys: `a`–`z`, `0`–`9`, `f1`–`f12`.
    pub accelerator: String,
}

pub(crate) struct HotkeySlot {
    pub request: HotkeyRequest,
    pub on_trigger: Option<ThreadsafeFunction<()>>,
}

/// Parsed accelerator with per-platform values filled in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Accelerator {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

/// Parse an accelerator string; `None` for anything the registrations do
/// not accept (unknown modifier, unknown key, empty parts).
pub fn parse_accelerator(accelerator: &str) -> Option<Accelerator> {
    let lowered = accelerator.trim().to_ascii_lowercase();
    let mut parsed = Accelerator {
        key: String::new(),
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
    };
    let mut key: Option<String> = None;
    for part in lowered.split('+') {
        if part.is_empty() {
            return None;
        }
        match part {
            "ctrl" | "control" => parsed.ctrl = true,
            "alt" | "option" => parsed.alt = true,
            "shift" => parsed.shift = true,
            "cmd" | "win" | "super" | "meta" => parsed.meta = true,
            _ => {
                if key.is_some() {
                    return None; // two non-modifier parts
                }
                key = Some(part.to_string());
            }
        }
    }
    let key = key?;
    let valid_key = (key.len() == 1
        && (key.as_bytes()[0].is_ascii_digit() || key.as_bytes()[0].is_ascii_lowercase()))
        || matches!(
            key.as_str(),
            "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12"
        );
    if !valid_key {
        return None;
    }
    parsed.key = key;
    Some(parsed)
}

/// macOS Carbon virtual key codes for the accepted key set.
pub fn mac_key_code(key: &str) -> Option<u32> {
    if key.len() == 1 {
        let byte = key.as_bytes()[0];
        if byte.is_ascii_lowercase() {
            // kVK_ANSI_A … kVK_ANSI_Z are contiguous from 0x00.
            return Some(u32::from(byte - b'a'));
        }
        if byte.is_ascii_digit() {
            // kVK_ANSI_0 is 0x1D, then 1…9 follow from 0x1F.
            return match byte {
                b'0' => Some(0x1d),
                digit => Some(0x1f + u32::from(digit - b'1')),
            };
        }
        return None;
    }
    Some(match key {
        "f1" => 0x7a,
        "f2" => 0x78,
        "f3" => 0x63,
        "f4" => 0x76,
        "f5" => 0x60,
        "f6" => 0x61,
        "f7" => 0x62,
        "f8" => 0x64,
        "f9" => 0x65,
        "f10" => 0x6d,
        "f11" => 0x67,
        "f12" => 0x6f,
        _ => return None,
    })
}

/// Windows virtual-key codes for the accepted key set.
pub fn win_virtual_key(key: &str) -> Option<u32> {
    if key.len() == 1 {
        let byte = key.as_bytes()[0];
        if byte.is_ascii_lowercase() {
            return Some(u32::from(byte)); // 'A'..'Z' == 'a'..'z' numerically
        }
        if byte.is_ascii_digit() {
            return Some(u32::from(byte));
        }
        return None;
    }
    Some(match key {
        "f1" => 0x70,
        "f2" => 0x71,
        "f3" => 0x72,
        "f4" => 0x73,
        "f5" => 0x74,
        "f6" => 0x75,
        "f7" => 0x76,
        "f8" => 0x77,
        "f9" => 0x78,
        "f10" => 0x79,
        "f11" => 0x7a,
        "f12" => 0x7b,
        _ => return None,
    })
}

// ── macOS (Carbon RegisterEventHotKey) ────────────────────────────────

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;
    use std::ffi::c_void;

    use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

    use super::{mac_key_code, parse_accelerator, HotkeySlot, HotkeyRequest};

    #[repr(C)]
    #[allow(non_snake_case)]
    struct EventHotKeyID {
        signature: u32,
        id: u32,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct EventTypeSpec {
        eventClass: u32,
        eventKind: u32,
    }

    type OSStatus = i32;
    type EventHotKeyRef = *mut c_void;
    type EventHandlerRef = *mut c_void;
    type EventRef = *mut c_void;
    type EventHandlerUPP = Option<unsafe extern "C" fn(*mut c_void, EventRef, *mut c_void) -> OSStatus>;

    const K_EVENT_CLASS_KEYBOARD: u32 = u32::from_be_bytes(*b"keyb");
    const K_EVENT_HOT_KEY_PRESSED: u32 = 5;
    const K_EVENT_PARAM_DIRECT_OBJECT: u32 = u32::from_be_bytes(*b"----");
    const TYPE_EVENT_HOT_KEY_ID: u32 = u32::from_be_bytes(*b"hkid");
    // Carbon modifier masks.
    const CMD_KEY: u32 = 0x0100;
    const OPTION_KEY: u32 = 0x0800;
    const CONTROL_KEY: u32 = 0x1000;
    const SHIFT_KEY: u32 = 0x2000;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn RegisterEventHotKey(
            keyCode: u32,
            mods: u32,
            hotKeyID: EventHotKeyID,
            target: *mut c_void,
            options: u32,
            outHotKey: *mut EventHotKeyRef,
        ) -> OSStatus;
        fn UnregisterEventHotKey(inHotKey: EventHotKeyRef) -> OSStatus;
        fn GetApplicationEventTarget() -> *mut c_void;
        fn InstallEventHandler(
            inTarget: *mut c_void,
            inHandler: EventHandlerUPP,
            inNumTypes: u32,
            inTypes: *const EventTypeSpec,
            inUserData: *mut c_void,
            outRef: *mut EventHandlerRef,
        ) -> OSStatus;
        fn GetEventParameter(
            inEvent: EventRef,
            inName: u32,
            inDesiredType: u32,
            outActualType: *mut c_void,
            inBufferSize: usize,
            outActualSize: *mut c_void,
            outData: *mut c_void,
        ) -> OSStatus;
    }

    /// Slot table: Carbon reports the hotkey by the id we minted, which
    /// indexes this vector. Main-thread only (Carbon events arrive on the
    /// app loop).
    struct MacHotkey {
        accelerator: String,
        reference: EventHotKeyRef,
        slot: HotkeySlot,
    }

    thread_local! {
        static HOTKEYS: RefCell<Vec<MacHotkey>> = const { RefCell::new(Vec::new()) };
        static HANDLER_INSTALLED: RefCell<bool> = const { RefCell::new(false) };
    }

    unsafe extern "C" fn hot_key_handler(
        _next: *mut c_void,
        event: EventRef,
        _user: *mut c_void,
    ) -> OSStatus {
        let mut hot_key_id = EventHotKeyID {
            signature: 0,
            id: 0,
        };
        let status = GetEventParameter(
            event,
            K_EVENT_PARAM_DIRECT_OBJECT,
            TYPE_EVENT_HOT_KEY_ID,
            std::ptr::null_mut(),
            std::mem::size_of::<EventHotKeyID>(),
            std::ptr::null_mut(),
            &mut hot_key_id as *mut EventHotKeyID as *mut c_void,
        );
        if status != 0 {
            return status;
        }
        HOTKEYS.with(|hotkeys| {
            if let Some(entry) = hotkeys.borrow().get(hot_key_id.id as usize) {
                if let Some(callback) = entry.slot.on_trigger.as_ref() {
                    callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        });
        0
    }

    fn ensure_handler() {
        HANDLER_INSTALLED.with(|installed| {
            if *installed.borrow() {
                return;
            }
            unsafe {
                let spec = EventTypeSpec {
                    eventClass: K_EVENT_CLASS_KEYBOARD,
                    eventKind: K_EVENT_HOT_KEY_PRESSED,
                };
                InstallEventHandler(
                    GetApplicationEventTarget(),
                    Some(hot_key_handler),
                    1,
                    &spec,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                );
            }
            *installed.borrow_mut() = true;
        });
    }

    pub(super) fn set(request: HotkeyRequest, on_trigger: Option<ThreadsafeFunction<()>>) -> Result<(), String> {
        let parsed = parse_accelerator(&request.accelerator)
            .ok_or_else(|| format!("unsupported accelerator: {:?}", request.accelerator))?;
        let key_code = mac_key_code(&parsed.key)
            .ok_or_else(|| format!("unsupported key: {:?}", parsed.key))?;
        let mut mods = 0u32;
        if parsed.ctrl {
            mods |= CONTROL_KEY;
        }
        if parsed.alt {
            mods |= OPTION_KEY;
        }
        if parsed.shift {
            mods |= SHIFT_KEY;
        }
        if parsed.meta {
            mods |= CMD_KEY;
        }

        clear(&request.accelerator);
        ensure_handler();

        let status = HOTKEYS.with(|hotkeys| {
            let id = hotkeys.borrow().len() as u32;
            let mut reference: EventHotKeyRef = std::ptr::null_mut();
            let status = unsafe {
                RegisterEventHotKey(
                    key_code,
                    mods,
                    EventHotKeyID {
                        signature: u32::from_be_bytes(*b"gphk"),
                        id,
                    },
                    GetApplicationEventTarget(),
                    0,
                    &mut reference,
                )
            };
            if status == 0 {
                hotkeys.borrow_mut().push(MacHotkey {
                    accelerator: request.accelerator.clone(),
                    reference,
                    slot: HotkeySlot { request, on_trigger },
                });
            }
            status
        });
        if status != 0 {
            return Err(format!(
                "RegisterEventHotKey failed for {:?} (OSStatus {status})",
                parsed.key
            ));
        }
        Ok(())
    }

    pub(super) fn clear(accelerator: &str) {
        HOTKEYS.with(|hotkeys| {
            let mut hotkeys = hotkeys.borrow_mut();
            if let Some(index) = hotkeys.iter().position(|entry| entry.accelerator == accelerator) {
                let entry = hotkeys.remove(index);
                unsafe {
                    UnregisterEventHotKey(entry.reference);
                }
            }
        });
    }

}

// ── Windows (RegisterHotKey on a message-only window) ─────────────────

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::Mutex;

    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_SHIFT,
        MOD_WIN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, HWND_MESSAGE, RegisterClassW, WINDOW_EX_STYLE,
        WM_HOTKEY, WNDCLASSW, WS_OVERLAPPED,
    };

    use napi::threadsafe_function::ThreadsafeFunction;
    use napi::threadsafe_function::ThreadsafeFunctionCallMode;

    use super::{parse_accelerator, win_virtual_key, HotkeyRequest};


    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    static REGISTERED: Mutex<Option<Vec<WinRegistration>>> = Mutex::new(None);
    static NEXT_ID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

    pub(super) struct WinRegistration {
        pub accelerator: String,
        pub id: u32,
        pub on_trigger: Option<ThreadsafeFunction<()>>,
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_HOTKEY {
            let id = wparam.0 as u32;
            if let Ok(guard) = REGISTERED.lock() {
                if let Some(registrations) = guard.as_ref() {
                    for entry in registrations.iter() {
                        if entry.id == id {
                            if let Some(callback) = entry.on_trigger.as_ref() {
                                // NonBlocking posts to the JS loop; the lock
                                // is released long before that runs.
                                callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
                            }
                            break;
                        }
                    }
                }
            }
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    fn ensure_window() -> windows::core::Result<HWND> {
        let existing = WINDOW.load(Ordering::SeqCst);
        if existing != 0 {
            return Ok(HWND(existing as *mut _));
        }
        unsafe {
            let class = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                lpszClassName: w!("GpuivHotkeyWnd"),
                ..Default::default()
            };
            RegisterClassW(&class);
            // A message-only window: parent HWND_MESSAGE, any window style.
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("GpuivHotkeyWnd"),
                w!("GpuivHotkey"),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )?;
            WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
            Ok(hwnd)
        }
    }

    pub(super) fn set(request: HotkeyRequest, on_trigger: Option<ThreadsafeFunction<()>>) -> Result<(), String> {
        let parsed = parse_accelerator(&request.accelerator)
            .ok_or_else(|| format!("unsupported accelerator: {:?}", request.accelerator))?;
        let virtual_key = win_virtual_key(&parsed.key)
            .ok_or_else(|| format!("unsupported key: {:?}", parsed.key))?;
        let mut mask = 0u32;
        if parsed.ctrl {
            mask |= MOD_CONTROL.0;
        }
        if parsed.alt {
            mask |= MOD_ALT.0;
        }
        if parsed.shift {
            mask |= MOD_SHIFT.0;
        }
        if parsed.meta {
            mask |= MOD_WIN.0;
        }

        let hwnd = ensure_window().map_err(|error| format!("hotkey window: {error}"))?;
        clear(&request.accelerator);
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        unsafe { RegisterHotKey(Some(hwnd), id as i32, HOT_KEY_MODIFIERS(mask), virtual_key) }
            .map_err(|_| {
                format!(
                    "RegisterHotKey failed for {:?} (already registered by another app?)",
                    request.accelerator
                )
            })?;
        if let Ok(mut guard) = REGISTERED.lock() {
            guard.get_or_insert_with(Vec::new).push(WinRegistration {
                accelerator: request.accelerator.clone(),
                id,
                on_trigger,
            });
        }
        Ok(())
    }

    pub(super) fn clear(accelerator: &str) {
        if let Ok(mut guard) = REGISTERED.lock() {
            if let Some(registrations) = guard.as_mut() {
                if let Some(index) = registrations.iter().position(|e| e.accelerator == accelerator) {
                    let entry = registrations.remove(index);
                    unsafe {
                        let _ = UnregisterHotKey(
                            Some(HWND(WINDOW.load(Ordering::SeqCst) as *mut _)),
                            entry.id as i32,
                        );
                    }
                }
            }
        }
    }

}

// ── Other platforms ───────────────────────────────────────────────────

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use super::HotkeyRequest;
    use napi::threadsafe_function::ThreadsafeFunction;

    pub(super) fn set(_request: HotkeyRequest, _on_trigger: Option<ThreadsafeFunction<()>>) -> Result<(), String> {
        Err("global shortcuts are implemented on macOS and Windows only".to_string())
    }

    pub(super) fn clear(_accelerator: &str) {}
}

/// Same validation the platforms run, without registering anything — the
/// test bridge answers through it.
pub(crate) fn validate_for_tests(accelerator: &str) -> Result<(), String> {
    parse_accelerator(accelerator)
        .map(|_| ())
        .ok_or_else(|| format!("unsupported accelerator: {accelerator:?}"))
}

pub(crate) fn set(request: HotkeyRequest, on_trigger: Option<ThreadsafeFunction<()>>) -> Result<(), String> {
    imp::set(request, on_trigger)
}

pub(crate) fn clear(accelerator: &str) {
    imp::clear(accelerator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modifiers_and_keys() {
        let parsed = parse_accelerator("cmd+shift+j").unwrap();
        assert_eq!(parsed.key, "j");
        assert!(parsed.meta && parsed.shift && !parsed.ctrl && !parsed.alt);
        let electron_style = parse_accelerator("Control+Alt+T").unwrap();
        assert!(electron_style.ctrl && electron_style.alt);
        assert_eq!(electron_style.key, "t");
        let f_key = parse_accelerator("ctrl+f9").unwrap();
        assert_eq!(f_key.key, "f9");
    }

    #[test]
    fn rejects_unknown_accelerators() {
        assert!(parse_accelerator("").is_none());
        assert!(parse_accelerator("cmd+").is_none());
        assert!(parse_accelerator("hyper+x").is_none());
        assert!(parse_accelerator("cmd+a+b").is_none());
        assert!(parse_accelerator("cmd+ß").is_none());
        assert!(parse_accelerator("cmd+f13").is_none());
        assert!(parse_accelerator("cmd+space").is_none());
    }

    #[test]
    fn key_tables_agree_with_the_parser() {
        for key in ["a", "z", "0", "9", "f1", "f12"] {
            assert!(parse_accelerator(&format!("ctrl+{key}")).is_some(), "{key}");
            assert!(mac_key_code(key).is_some(), "mac {key}");
            assert!(win_virtual_key(key).is_some(), "win {key}");
        }
        assert_eq!(mac_key_code("a"), Some(0x00));
        assert_eq!(mac_key_code("0"), Some(0x1d));
        assert_eq!(win_virtual_key("a"), Some(b'a' as u32));
        assert_eq!(win_virtual_key("f12"), Some(0x7b));
    }
}
