//! The OS notification center bridge.
//!
//! GPUI already posts notifications through `App::show_system_notification`,
//! with platform implementations in the vendored fork (UNUserNotificationCenter
//! on macOS, WinRT toasts on Windows). This module holds the JS description
//! types and the conversion into gpui's `SystemNotification`, shared by the
//! production renderer and the test bridge.
//!
//! A missing `tag` gets a generated one, mirroring the web `Notification`
//! API: untagged notifications are independent, while two notifications
//! sharing a tag replace each other where the platform supports it.

use std::sync::atomic::{AtomicU64, Ordering};

use napi_derive::napi;

/// A button offered on a system notification.
#[derive(Clone)]
#[napi(object)]
pub struct SystemNotificationActionDesc {
    /// Identifies the action in the response's `actionId` when the button is
    /// pressed.
    pub id: String,
    /// The button's user-visible label.
    pub label: String,
}

/// A notification as described from JS.
#[derive(Clone)]
#[napi(object)]
pub struct SystemNotificationDesc {
    /// Stable identity: posting again with the same tag replaces the earlier
    /// notification where the platform supports it, and responses carry the
    /// tag back. Omit it for an independent notification — a tag is generated
    /// and returned by the show call.
    pub tag: Option<String>,
    /// The notification's headline.
    pub title: String,
    /// Additional text displayed below the title.
    pub body: Option<String>,
    /// Buttons offered on the notification. Platforms that cannot display
    /// action buttons show the notification without them.
    pub actions: Option<Vec<SystemNotificationActionDesc>>,
}

impl SystemNotificationDesc {
    /// Convert into gpui's notification, using `default_tag` when the
    /// description omitted one.
    pub fn to_gpui(&self, default_tag: &str) -> gpui::SystemNotification {
        gpui::SystemNotification {
            tag: self
                .tag
                .clone()
                .unwrap_or_else(|| default_tag.to_string())
                .into(),
            title: self.title.clone().into(),
            body: self.body.clone().unwrap_or_default().into(),
            actions: self
                .actions
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|action| gpui::SystemNotificationAction {
                    id: action.id.into(),
                    label: action.label.into(),
                })
                .collect(),
        }
    }
}

/// A notification as recorded by the test bridge, with every optional field
/// resolved to its effective value.
#[derive(Clone)]
#[napi(object)]
pub struct RecordedSystemNotification {
    pub tag: String,
    pub title: String,
    pub body: String,
    pub actions: Vec<RecordedSystemNotificationAction>,
}

#[derive(Clone)]
#[napi(object)]
pub struct RecordedSystemNotificationAction {
    pub id: String,
    pub label: String,
}

impl From<&gpui::SystemNotification> for RecordedSystemNotification {
    fn from(notification: &gpui::SystemNotification) -> Self {
        Self {
            tag: notification.tag.to_string(),
            title: notification.title.to_string(),
            body: notification.body.to_string(),
            actions: notification
                .actions
                .iter()
                .map(|action| RecordedSystemNotificationAction {
                    id: action.id.to_string(),
                    label: action.label.to_string(),
                })
                .collect(),
        }
    }
}

/// The payload delivered when the user activates a notification.
#[napi(object)]
pub struct SystemNotificationResponseJs {
    /// The tag of the activated notification.
    pub tag: String,
    /// The pressed action button's id, or null when the notification body
    /// itself was activated.
    pub action_id: Option<String>,
}

impl From<gpui::SystemNotificationResponse> for SystemNotificationResponseJs {
    fn from(response: gpui::SystemNotificationResponse) -> Self {
        Self {
            tag: response.tag.to_string(),
            action_id: response.action_id.map(|id| id.to_string()),
        }
    }
}

/// The app identity recorded by the test bridge, if any.
#[napi(object)]
pub struct AppIdentity {
    pub identifier: String,
    pub name: String,
}

/// Generate a tag for a notification described without one.
pub fn next_notification_tag() -> String {
    static NEXT_TAG: AtomicU64 = AtomicU64::new(0);
    let index = NEXT_TAG.fetch_add(1, Ordering::Relaxed);
    format!("gpuix-{index}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omitted_fields_default() {
        let desc = SystemNotificationDesc {
            tag: None,
            title: "Done".into(),
            body: None,
            actions: None,
        };
        let notification = desc.to_gpui("gpuix-7");
        assert_eq!(notification.tag.as_ref(), "gpuix-7");
        assert_eq!(notification.title.as_ref(), "Done");
        assert_eq!(notification.body.as_ref(), "");
        assert!(notification.actions.is_empty());
    }

    #[test]
    fn explicit_fields_pass_through() {
        let desc = SystemNotificationDesc {
            tag: Some("job-1".into()),
            title: "Finished".into(),
            body: Some("All rows written".into()),
            actions: Some(vec![SystemNotificationActionDesc {
                id: "open".into(),
                label: "Open".into(),
            }]),
        };
        let notification = desc.to_gpui("unused");
        assert_eq!(notification.tag.as_ref(), "job-1");
        assert_eq!(notification.body.as_ref(), "All rows written");
        assert_eq!(notification.actions.len(), 1);
        assert_eq!(notification.actions[0].id.as_ref(), "open");
        assert_eq!(notification.actions[0].label.as_ref(), "Open");
    }

    #[test]
    fn generated_tags_are_unique() {
        assert_ne!(next_notification_tag(), next_notification_tag());
    }

    #[test]
    fn response_conversion_maps_action_id() {
        let from_body = gpui::SystemNotificationResponse {
            tag: "a".into(),
            action_id: None,
        };
        assert_eq!(SystemNotificationResponseJs::from(from_body).action_id, None);
        let from_button = gpui::SystemNotificationResponse {
            tag: "a".into(),
            action_id: Some("open".into()),
        };
        assert_eq!(
            SystemNotificationResponseJs::from(from_button).action_id,
            Some("open".to_string())
        );
    }
}
