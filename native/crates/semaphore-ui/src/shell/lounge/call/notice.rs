//! The voice notice (design F2, §3.5), the native side of `VoiceNoticeBar.tsx` and
//! `voiceNoticeModel.ts`: in the call slot when there is no call, a join that failed or why the
//! last call ended, with Retry when trying again can help, and Dismiss.

use super::super::Act;
use crate::kit::{Alert, Severity};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::VoiceEnded;

/// How the notice reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoticeSeverity {
    Error,
    Warning,
    Info,
}

/// What the voice notice shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceNoticeModel {
    pub severity: NoticeSeverity,
    pub title: String,
    pub message: String,
    /// Retry is offered: trying again can help.
    pub retry: bool,
}

/// A join that failed (the web's generic failure: native core doesn't sort them yet).
pub fn join_failed_notice() -> VoiceNoticeModel {
    VoiceNoticeModel {
        severity: NoticeSeverity::Error,
        title: "Couldn't join voice".into(),
        message: "Something went wrong while connecting.".into(),
        retry: true,
    }
}

/// A call that ended on its own. Lost while rejoining: the connection, with Retry. Otherwise a
/// plain ending, with nothing to retry (removed, the room closed: the reasons aren't sorted yet).
pub fn ended_notice(ended: &VoiceEnded) -> VoiceNoticeModel {
    if ended.while_reconnecting {
        VoiceNoticeModel {
            severity: NoticeSeverity::Error,
            title: "Lost connection to voice and could not reconnect".into(),
            message: "Check your connection, then try again.".into(),
            retry: true,
        }
    } else {
        VoiceNoticeModel {
            severity: NoticeSeverity::Info,
            title: "The call ended".into(),
            message: "You're no longer in the voice call.".into(),
            retry: false,
        }
    }
}

#[derive(IntoElement)]
pub struct VoiceNoticeBar {
    model: VoiceNoticeModel,
    on_retry: Option<Act>,
    on_dismiss: Act,
}

impl VoiceNoticeBar {
    /// `on_retry` is used only when the model offers Retry.
    pub fn new(model: VoiceNoticeModel, on_retry: Option<Act>, on_dismiss: Act) -> Self {
        Self {
            model,
            on_retry,
            on_dismiss,
        }
    }
}

impl RenderOnce for VoiceNoticeBar {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let severity = match self.model.severity {
            NoticeSeverity::Error => Severity::Danger,
            NoticeSeverity::Warning => Severity::Warning,
            NoticeSeverity::Info => Severity::Info,
        };
        let dismiss = self.on_dismiss.clone();
        let mut alert = Alert::new("voice-notice", severity, self.model.message.clone())
            .title(self.model.title.clone())
            .on_close(move |window, cx| dismiss(window, cx));
        if let Some(retry) = self.on_retry.filter(|_| self.model.retry) {
            alert = alert.action("Retry", move |window, cx| retry(window, cx));
        }
        div().w_full().child(alert)
    }
}
