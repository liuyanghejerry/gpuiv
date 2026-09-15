//! The macOS application menu bar.
//!
//! GPUI never installs a main menu on its own, so `NSApp.mainMenu` stays nil
//! and macOS paints an empty menu bar. Worse, the standard key equivalents that
//! AppKit only provides through menu items are missing too, so a GPUIX app
//! cannot be quit with cmd-q, hidden with cmd-h, or minimized with cmd-m.
//!
//! `gpui::App::set_menus` reads the key equivalent for each item out of the
//! keymap, so [`init`] must bind the keys before it sets the menus.
//!
//! There is deliberately no Edit menu. A menu key equivalent is consumed by
//! AppKit before the window sees the key event, so an Edit menu carrying cmd-c
//! would take the keystroke away from the window listener that
//! `crate::text::paint` installs for text selection, and from the per-focus
//! clipboard handling in `custom_elements::input`.

use gpui::{App, Menu, MenuItem, SystemMenuType};
use napi::bindgen_prelude::Error;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::{Mutex, OnceLock};

gpui::actions!(
    gpuix_app,
    [
        /// Quit the application.
        Quit,
        /// Hide the application.
        Hide,
        /// Hide every other application.
        HideOthers,
        /// Unhide every other application.
        ShowAll,
        /// Minimize the focused window to the Dock.
        MinimizeWindow,
        /// Toggle the focused window between its standard and zoomed size.
        ZoomWindow,
        /// Close the focused window.
        CloseWindow,
    ]
);

/// A JS-defined menu action. One Rust type carries every JS item; `partial_eq`
/// on `id` is what the keymap binding lookup and the dispatch tree use to tell
/// items apart.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct JsMenuAction {
    pub id: String,
}

impl gpui::Action for JsMenuAction {
    fn boxed_clone(&self) -> Box<dyn gpui::Action> {
        Box::new(self.clone())
    }

    fn partial_eq(&self, action: &dyn gpui::Action) -> bool {
        action.as_any().downcast_ref::<Self>() == Some(self)
    }

    fn name(&self) -> &'static str {
        "gpuix_js_menu"
    }

    fn name_for_type() -> &'static str {
        "gpuix_js_menu"
    }

    fn build(value: serde_json::Value) -> anyhow::Result<Box<dyn gpui::Action>> {
        match value {
            serde_json::Value::String(id) => Ok(Box::new(Self { id })),
            _ => anyhow::bail!("a js menu action builds from the item id string"),
        }
    }
}

/// The JS callback armed by the last `setMenus` call. One per process: the
/// menu bar is app-global.
static JS_MENU_HANDLER: OnceLock<Mutex<Option<ThreadsafeFunction<String>>>> = OnceLock::new();

fn js_menu_handler() -> &'static Mutex<Option<ThreadsafeFunction<String>>> {
    JS_MENU_HANDLER.get_or_init(|| Mutex::new(None))
}

/// A menu for the application menu bar, as described from JS.
#[napi(object)]
pub struct JsMenuDesc {
    /// Displayed menu title. The first menu is the macOS application menu.
    pub name: String,
    /// Item list; a menu without items renders empty.
    pub items: Option<Vec<JsMenuItemDesc>>,
    /// Gray the whole menu out.
    pub disabled: Option<bool>,
}

/// One item of a [`JsMenuDesc`]. Exactly one of `separator`, `submenu`, or
/// (`id` | `system`) applies; `label` is the displayed title.
#[napi(object)]
pub struct JsMenuItemDesc {
    pub label: Option<String>,
    /// Delivered to the `setMenus` callback when the item fires.
    pub id: Option<String>,
    /// A built-in behavior instead of a JS callback, so a replaced menu bar
    /// can keep Quit and friends.
    pub system: Option<String>,
    /// Key equivalent, e.g. `"cmd-,"`. Bound into the keymap so the menu can
    /// display it; re-binding the same id with a different keystroke keeps
    /// the FIRST binding visible (the macOS menu reads earlier bindings).
    pub keystroke: Option<String>,
    /// Show a checkmark beside the item.
    pub checked: Option<bool>,
    /// Gray the item out.
    pub disabled: Option<bool>,
    /// A horizontal rule instead of an entry.
    pub separator: Option<bool>,
    /// Nested menu; the item becomes a submenu root.
    pub submenu: Option<Vec<JsMenuItemDesc>>,
}

fn system_action(name: &str) -> Option<Box<dyn gpui::Action>> {
    match name {
        "quit" => Some(Box::new(Quit)),
        "hide" => Some(Box::new(Hide)),
        "hideOthers" => Some(Box::new(HideOthers)),
        "showAll" => Some(Box::new(ShowAll)),
        "minimizeWindow" => Some(Box::new(MinimizeWindow)),
        "zoomWindow" => Some(Box::new(ZoomWindow)),
        "closeWindow" => Some(Box::new(CloseWindow)),
        _ => None,
    }
}

fn to_gpui_item(desc: JsMenuItemDesc, bindings: &mut Vec<gpui::KeyBinding>) -> napi::Result<MenuItem> {
    if desc.separator.unwrap_or(false) {
        return Ok(MenuItem::separator());
    }
    if let Some(submenu) = desc.submenu {
        let mut menu = Menu::new(desc.label.unwrap_or_default());
        menu.items = submenu
            .into_iter()
            .map(|item| to_gpui_item(item, bindings))
            .collect::<napi::Result<Vec<_>>>()?;
        if desc.disabled.unwrap_or(false) {
            menu = menu.disabled(true);
        }
        return Ok(MenuItem::submenu(menu));
    }
    let label = desc
        .label
        .clone()
        .or_else(|| desc.id.clone())
        .unwrap_or_default();
    let mut item = match (desc.system.as_deref(), desc.id.clone()) {
        (Some(system), _) => {
            let action = system_action(system).ok_or_else(|| {
                Error::from_reason(format!(
                    "unknown system menu action {system:?}; expected one of \
                     quit, hide, hideOthers, showAll, minimizeWindow, zoomWindow, closeWindow"
                ))
            })?;
            MenuItem::Action {
                name: label.into(),
                action,
                os_action: None,
                checked: desc.checked.unwrap_or(false),
                disabled: desc.disabled.unwrap_or(false),
            }
        }
        (None, Some(id)) => {
            if let Some(keystroke) = desc.keystroke.clone() {
                bindings.push(gpui::KeyBinding::new(
                    keystroke.as_str(),
                    JsMenuAction { id: id.clone() },
                    None,
                ));
            }
            MenuItem::action(label, JsMenuAction { id })
        }
        (None, None) => {
            return Err(Error::from_reason(
                "a menu item needs an id, a system action, a submenu, or separator: true",
            ));
        }
    };
    if let MenuItem::Action {
        checked,
        disabled,
        ..
    } = &mut item
    {
        *checked = desc.checked.unwrap_or(false);
        *disabled = desc.disabled.unwrap_or(false);
    }
    Ok(item)
}

/// Install the JS menu bar: replace the current menus, arm the click
/// callback, and bind item keystrokes so their equivalents show. Callers must
/// run this on the app thread (`App::set_menus` is not thread-safe).
pub(crate) fn set_js_menus(
    menus: Vec<JsMenuDesc>,
    on_action: ThreadsafeFunction<String>,
    cx: &mut App,
) -> napi::Result<()> {
    let mut bindings = Vec::new();
    let gpui_menus: Vec<Menu> = menus
        .into_iter()
        .map(|desc| {
            let mut menu = Menu::new(desc.name);
            menu.items = desc
                .items
                .unwrap_or_default()
                .into_iter()
                .map(|item| to_gpui_item(item, &mut bindings))
                .collect::<napi::Result<Vec<_>>>()?;
            if desc.disabled.unwrap_or(false) {
                menu = menu.disabled(true);
            }
            Ok(menu)
        })
        .collect::<napi::Result<Vec<_>>>()?;
    if !bindings.is_empty() {
        cx.bind_keys(bindings);
    }
    *js_menu_handler().lock().unwrap() = Some(on_action);
    cx.set_menus(gpui_menus);
    Ok(())
}

/// The menus recorded by the test renderer's `setMenus` — labels and
/// keystrokes as JS sent them, so tests can assert the conversion without a
/// real menu bar.
#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedMenu {
    pub name: String,
    pub items: Vec<RecordedMenuItem>,
}

#[napi(object)]
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedMenuItem {
    pub label: String,
    /// `Some` for a JS-callback item, `None` for separators and system items.
    pub id: Option<String>,
    pub system: Option<String>,
    pub keystroke: Option<String>,
    pub checked: bool,
    pub disabled: bool,
    pub separator: bool,
    pub submenu: Vec<RecordedMenuItem>,
}

pub(crate) fn record_menus(menus: Vec<JsMenuDesc>) -> napi::Result<Vec<RecordedMenu>> {
    menus
        .into_iter()
        .map(|desc| {
            Ok(RecordedMenu {
                name: desc.name,
                items: desc
                    .items
                    .unwrap_or_default()
                    .into_iter()
                    .map(record_item)
                    .collect::<napi::Result<Vec<_>>>()?,
            })
        })
        .collect()
}

fn record_item(desc: JsMenuItemDesc) -> napi::Result<RecordedMenuItem> {
    // Validate through the production conversion first, so the recorded shape
    // cannot drift from what set_js_menus would have installed.
    let mut bindings = Vec::new();
    to_gpui_item(
        JsMenuItemDesc {
            label: desc.label.clone(),
            id: desc.id.clone(),
            system: desc.system.clone(),
            keystroke: desc.keystroke.clone(),
            checked: desc.checked,
            disabled: desc.disabled,
            separator: desc.separator,
            submenu: None,
        },
        &mut bindings,
    )?;
    Ok(RecordedMenuItem {
        label: desc
            .label
            .clone()
            .or_else(|| desc.id.clone())
            .unwrap_or_default(),
        id: desc.id,
        system: desc.system,
        keystroke: desc.keystroke,
        checked: desc.checked.unwrap_or(false),
        disabled: desc.disabled.unwrap_or(false),
        separator: desc.separator.unwrap_or(false),
        submenu: desc
            .submenu
            .map(|items| {
                items
                    .into_iter()
                    .map(record_item)
                    .collect::<napi::Result<Vec<_>>>()
            })
            .transpose()?
            .unwrap_or_default(),
    })
}

/// Binds the standard macOS shortcuts, registers the app-level handlers, and
/// installs the menu bar. The window-level actions (`MinimizeWindow`,
/// `ZoomWindow`, `CloseWindow`) are handled by the root element in
/// `GpuixView::render`, which is the only place a `Window` exists.
pub(crate) fn init(app_name: &str, cx: &mut App) {
    cx.bind_keys([
        gpui::KeyBinding::new("cmd-q", Quit, None),
        gpui::KeyBinding::new("cmd-h", Hide, None),
        gpui::KeyBinding::new("cmd-alt-h", HideOthers, None),
        gpui::KeyBinding::new("cmd-m", MinimizeWindow, None),
        gpui::KeyBinding::new("cmd-w", CloseWindow, None),
    ]);

    cx.on_action(|_: &Quit, cx: &mut App| cx.quit());
    cx.on_action(|_: &Hide, cx: &mut App| cx.hide());
    cx.on_action(|_: &HideOthers, cx: &mut App| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx: &mut App| cx.unhide_other_apps());
    cx.on_action(|action: &JsMenuAction, _: &mut App| {
        if let Some(handler) = js_menu_handler().lock().unwrap().as_ref() {
            handler
                .clone()
                .call(Ok(action.id.clone()), ThreadsafeFunctionCallMode::NonBlocking);
        }
    });

    cx.set_menus(default_menus(app_name));
}

/// The App menu plus the Window menu, the minimum a macOS app is expected to
/// have. `create_menu_bar` gives the menu named `Window` to
/// `NSApplication.setWindowsMenu:`, which is what appends the window list.
pub(crate) fn default_menus(app_name: &str) -> Vec<Menu> {
    vec![
        Menu {
            name: app_name.to_string().into(),
            disabled: false,
            items: vec![
                MenuItem::os_submenu("Services", SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(format!("Hide {app_name}"), Hide),
                MenuItem::action("Hide Others", HideOthers),
                MenuItem::action("Show All", ShowAll),
                MenuItem::separator(),
                MenuItem::action(format!("Quit {app_name}"), Quit),
            ],
        },
        // No "Enter Full Screen" item: AppKit prepends its own window-tiling
        // items, that one included, to whichever menu is given to
        // `setWindowsMenu:`. Adding ours produced two entries sharing a
        // shortcut.
        Menu {
            name: "Window".into(),
            disabled: false,
            items: vec![
                MenuItem::action("Minimize", MinimizeWindow),
                MenuItem::action("Zoom", ZoomWindow),
                MenuItem::separator(),
                MenuItem::action("Close Window", CloseWindow),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item_names(menu: &Menu) -> Vec<String> {
        menu.items
            .iter()
            .map(|item| match item {
                MenuItem::Separator => "-".to_string(),
                MenuItem::Submenu(submenu) => submenu.name.to_string(),
                MenuItem::SystemMenu(os_menu) => os_menu.name.to_string(),
                MenuItem::Action { name, .. } => name.to_string(),
            })
            .collect()
    }

    #[test]
    fn app_menu_is_named_after_the_app() {
        let menus = default_menus("Chat");
        assert_eq!(menus[0].name.as_ref(), "Chat");
        assert_eq!(
            item_names(&menus[0]),
            vec![
                "Services",
                "-",
                "Hide Chat",
                "Hide Others",
                "Show All",
                "-",
                "Quit Chat",
            ]
        );
    }

    // `create_menu_bar` only calls `setWindowsMenu:` for this exact name.
    #[test]
    fn window_menu_keeps_the_name_appkit_looks_for() {
        let menus = default_menus("Chat");
        assert_eq!(menus[1].name.as_ref(), "Window");
        assert_eq!(
            item_names(&menus[1]),
            vec!["Minimize", "Zoom", "-", "Close Window"]
        );
    }

    #[test]
    fn js_menu_items_convert_through_the_production_path() {
        let recorded = super::record_menus(vec![super::JsMenuDesc {
            name: "Chat".into(),
            disabled: None,
            items: Some(vec![
                super::JsMenuItemDesc {
                    label: Some("Settings…".into()),
                    id: Some("settings".into()),
                    system: None,
                    keystroke: Some("cmd-,".into()),
                    checked: Some(true),
                    disabled: None,
                    separator: None,
                    submenu: None,
                },
                super::JsMenuItemDesc {
                    label: None,
                    id: None,
                    system: None,
                    keystroke: None,
                    checked: None,
                    disabled: None,
                    separator: Some(true),
                    submenu: None,
                },
                super::JsMenuItemDesc {
                    label: Some("Quit Chat".into()),
                    id: None,
                    system: Some("quit".into()),
                    keystroke: None,
                    checked: None,
                    disabled: None,
                    separator: None,
                    submenu: None,
                },
            ]),
        }])
        .unwrap();
        assert_eq!(recorded[0].name, "Chat");
        let settings = &recorded[0].items[0];
        assert_eq!(settings.id.as_deref(), Some("settings"));
        assert_eq!(settings.keystroke.as_deref(), Some("cmd-,"));
        assert!(settings.checked);
        assert!(recorded[0].items[1].separator);
        assert_eq!(recorded[0].items[2].system.as_deref(), Some("quit"));
    }

    #[test]
    fn a_js_menu_item_without_a_behavior_is_rejected() {
        let error = super::record_menus(vec![super::JsMenuDesc {
            name: "Chat".into(),
            disabled: None,
            items: Some(vec![super::JsMenuItemDesc {
                label: Some("Dangling".into()),
                id: None,
                system: None,
                keystroke: None,
                checked: None,
                disabled: None,
                separator: None,
                submenu: None,
            }]),
        }])
        .unwrap_err();
        assert!(error.reason.contains("needs an id"));
    }
}
