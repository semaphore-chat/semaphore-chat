//! The app's OS notifier: on Linux our freedesktop client
//! ([`FreedesktopNotifier`](semaphore_platform_desktop::notify::FreedesktopNotifier)), elsewhere
//! GPUI's system notifications (toasts on Windows) through [`ToastNotifier`].
//!
//! GPUI's notifications live on the UI thread, while a [`Notifier`] is called from any thread, so
//! [`ToastNotifier`] only queues and a task on the UI thread shows and dismisses. A click (on the
//! toast's body: we offer no buttons) becomes `DesktopEvent::NotificationClicked` with its tag, as
//! on Linux, with no activation token: Windows brings the app forward itself.

use gpui_kit::{App, SharedString, SystemNotification};
use semaphore_core::model::OsNotification;
use semaphore_core::platform::{CoreError, Notifier};
use semaphore_platform_desktop::notify::plain_tag;
use semaphore_platform_desktop::{DesktopEvent, DesktopEventSink};
use std::sync::Arc;

/// The platform's notifier, sending clicks to `sink`. Call once, on the UI thread.
pub fn start(sink: DesktopEventSink, cx: &mut App) -> Arc<dyn Notifier> {
    #[cfg(target_os = "linux")]
    {
        let _ = cx;
        Arc::new(semaphore_platform_desktop::notify::FreedesktopNotifier::start(sink))
    }
    #[cfg(not(target_os = "linux"))]
    {
        Arc::new(ToastNotifier::start(sink, cx))
    }
}

enum Toast {
    Show {
        tag: String,
        title: String,
        body: String,
    },
    Dismiss(String),
}

/// GPUI's system notifications, callable from any thread.
pub struct ToastNotifier {
    toasts: async_channel::Sender<Toast>,
}

impl ToastNotifier {
    /// Registers for clicks and starts the task that shows. Replaces any earlier click handler.
    pub fn start(sink: DesktopEventSink, cx: &mut App) -> Self {
        cx.on_system_notification_response(move |response, _| {
            sink(DesktopEvent::NotificationClicked {
                tag: response.tag.to_string(),
                activation_token: None,
            });
        });
        let (toasts, queued) = async_channel::unbounded::<Toast>();
        cx.spawn(async move |cx| {
            while let Ok(toast) = queued.recv().await {
                cx.update(|cx| match toast {
                    Toast::Show { tag, title, body } => {
                        cx.show_system_notification(SystemNotification {
                            tag: SharedString::from(tag),
                            title: title.into(),
                            body: body.into(),
                            actions: Vec::new(),
                        })
                    }
                    Toast::Dismiss(tag) => cx.dismiss_system_notification(&tag),
                });
            }
        })
        .detach();
        Self { toasts }
    }

    fn send(&self, toast: Toast) -> Result<(), CoreError> {
        self.toasts
            .try_send(toast)
            .map_err(|_| CoreError::Unavailable {
                what: "notifications (the app is closing)".into(),
            })
    }
}

impl Notifier for ToastNotifier {
    fn notify(&self, title: String, body: String) -> Result<(), CoreError> {
        self.send(Toast::Show {
            tag: plain_tag(),
            title,
            body,
        })
    }

    fn show(&self, notification: OsNotification) -> Result<(), CoreError> {
        self.send(Toast::Show {
            tag: notification.tag,
            title: notification.title,
            body: notification.body,
        })
    }

    fn withdraw(&self, tag: &str) {
        let _ = self.send(Toast::Dismiss(tag.to_owned()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui_kit::{SystemNotificationResponse, TestAppContext};
    use semaphore_core::model::{Conversation, MessageLink};
    use std::sync::Mutex;

    fn notification(tag: &str, body: &str) -> OsNotification {
        OsNotification {
            id: "n".into(),
            tag: tag.into(),
            title: "Ava".into(),
            body: body.into(),
            link: MessageLink {
                community_id: None,
                conversation: Conversation::DirectMessage { id: "d".into() },
                message_id: None,
            },
            parent_message_id: None,
            sound: None,
        }
    }

    #[gpui_kit::test]
    fn toasts_show_by_tag_from_any_thread_and_clicks_route_by_tag(cx: &mut TestAppContext) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let recorded = events.clone();
        let sink: DesktopEventSink = Arc::new(move |event| recorded.lock().unwrap().push(event));
        let notifier = Arc::new(cx.update(|cx| {
            // As `main` does: without an identity Windows shows no toasts (nor does the fake).
            cx.set_app_identity(semaphore_platform_desktop::links::APP_ID, "Semaphore");
            ToastNotifier::start(sink, cx)
        }));

        let other = notifier.clone();
        std::thread::spawn(move || {
            other.show(notification("dm:a", "one")).unwrap();
            other.show(notification("dm:a", "two")).unwrap();
            other.show(notification("channel:b", "three")).unwrap();
            other.withdraw("channel:b");
        })
        .join()
        .unwrap();
        cx.run_until_parked();

        let shown: Vec<(String, String)> = cx
            .shown_system_notifications()
            .into_iter()
            .map(|toast| (toast.tag.to_string(), toast.body.to_string()))
            .collect();
        assert_eq!(
            shown,
            vec![
                ("dm:a".into(), "one".into()),
                ("dm:a".into(), "two".into()),
                ("channel:b".into(), "three".into()),
            ]
        );
        let delivered: Vec<String> = cx
            .delivered_system_notifications()
            .into_iter()
            .map(|toast| toast.body.to_string())
            .collect();
        assert_eq!(
            delivered,
            vec!["two".to_owned()],
            "replaced by tag, withdrawn"
        );
        assert_eq!(cx.dismissed_system_notifications(), vec!["channel:b"]);

        cx.simulate_system_notification_response(SystemNotificationResponse {
            tag: "dm:a".into(),
            action_id: None,
        });
        cx.run_until_parked();
        assert_eq!(
            *events.lock().unwrap(),
            vec![DesktopEvent::NotificationClicked {
                tag: "dm:a".into(),
                activation_token: None,
            }]
        );
    }
}
