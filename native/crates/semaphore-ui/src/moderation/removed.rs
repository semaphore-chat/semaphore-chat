//! The one-time notice when this user loses a community (`CoreEvent::CommunityRemoved`): "You were
//! removed from X", "You were banned from X" (with the reason and, for a temporary ban, until
//! when) or "X was deleted". The owner calls `show` on the event, then goes home on `Acknowledged`.

use super::format::{reason_preview, removed_body, removed_title};
use crate::kit::{Button, Dialog, Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::RemovalCause;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemovedNoticeEvent {
    /// "OK", Escape or the backdrop: the notice has closed itself.
    Acknowledged { community_id: String },
}

struct Shown {
    community_id: String,
    name: String,
    cause: RemovalCause,
}

pub struct RemovedNotice {
    shown: Option<Shown>,
    time: TimeFormat,
}

impl EventEmitter<RemovedNoticeEvent> for RemovedNotice {}

impl RemovedNotice {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            shown: None,
            time: TimeFormat::default(),
        }
    }

    /// The event's fields. A second removal replaces the first.
    pub fn show(
        &mut self,
        community_id: impl Into<String>,
        name: impl Into<String>,
        cause: RemovalCause,
        cx: &mut Context<Self>,
    ) {
        self.shown = Some(Shown {
            community_id: community_id.into(),
            name: name.into(),
            cause,
        });
        cx.notify();
    }

    pub fn is_shown(&self) -> bool {
        self.shown.is_some()
    }

    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    pub fn acknowledge(&mut self, cx: &mut Context<Self>) {
        if let Some(shown) = self.shown.take() {
            cx.emit(RemovedNoticeEvent::Acknowledged {
                community_id: shown.community_id,
            });
            cx.notify();
        }
    }
}

impl Render for RemovedNotice {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(shown) = &self.shown else {
            return div().into_any_element();
        };
        let sem = cx.sem().clone();
        let reason = match &shown.cause {
            RemovalCause::Kicked { reason } | RemovalCause::Banned { reason, .. } => reason
                .as_deref()
                .map(str::trim)
                .filter(|reason| !reason.is_empty())
                .map(|reason| reason_preview(reason, 512)),
            RemovalCause::Deleted => None,
        };
        let ok = cx.listener(|notice, _, _, cx| notice.acknowledge(cx));
        let close = cx.entity().downgrade();
        let dialog = Dialog::new(removed_title(&shown.name, &shown.cause))
            .width(440.)
            .body(
                div()
                    .pt(spacing(1.))
                    .flex()
                    .flex_col()
                    .gap(spacing(1.5))
                    .child(
                        text(Variant::Body1, removed_body(&self.time, &shown.cause))
                            .text_color(sem.text_primary),
                    )
                    .children(reason.map(|reason| {
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .p(spacing(1.5))
                            .rounded(px(4.))
                            .bg(sem.action_hover)
                            .child(text(Variant::Caption, "Reason").text_color(sem.text_secondary))
                            .child(text(Variant::Body2, reason).text_color(sem.text_primary))
                    })),
            )
            .action(Button::new("removed-ok", "OK").contained().on_click(ok))
            .on_close(move |_, cx| {
                close.update(cx, |notice, cx| notice.acknowledge(cx)).ok();
            });
        div().absolute().inset_0().child(dialog).into_any_element()
    }
}
