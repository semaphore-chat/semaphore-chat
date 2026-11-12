//! The moderation menu on a member (`UserModerationMenu.tsx`): View Profile, then Change Roles,
//! Kick, Timeout (or Remove Timeout while they're timed out) and Ban. An action this user may not
//! take shows disabled with core's reason under it (rank, self, missing permission), not hidden as
//! the web does.
//!
//! The owner places it (`set_position`, the pointer in window coordinates; a phone gets a sheet at
//! the bottom), feeds `Core::moderation_target` through `set_target`, and on an event opens the
//! matching `ModerationDialog`. Every event but `Close` is followed by `Close`.

use super::format::{MemberAction, admin_action, blocked, blocked_reason, now_ms, timeout_left};
use crate::community_settings::rules::{failure, running};
use crate::dms::face::user_face;
use crate::dms::names::user_name;
use crate::kit::{MenuItem, SecondaryTone, Spinner, Variant, spacing, text};
use crate::messages::TimeFormat;
use crate::panel::common::is_phone;
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{AdminActionKind, LoadState, ModerationTargetView, UserView};
use semaphore_design::Icon as IconName;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModerationMenuEvent {
    ViewProfile {
        user_id: String,
    },
    /// The roles lane's assignment dialog.
    ChangeRoles {
        user_id: String,
    },
    /// Open `ModerationDialog::open_kick(user)`.
    Kick {
        user: UserView,
    },
    Timeout {
        user: UserView,
    },
    RemoveTimeout {
        user: UserView,
    },
    Ban {
        user: UserView,
    },
    /// Done with: a press outside, Escape, or after any action.
    Close,
}

pub struct ModerationMenu {
    user: UserView,
    target: ModerationTargetView,
    position: Point<Pixels>,
    can_view_profile: bool,
    time: TimeFormat,
    /// The last render was a phone's: items take touch height.
    phone_cache: bool,
}

impl EventEmitter<ModerationMenuEvent> for ModerationMenu {}

impl ModerationMenu {
    pub fn new(user: UserView, position: Point<Pixels>, _: &mut Context<Self>) -> Self {
        Self {
            target: ModerationTargetView {
                user_id: user.id.clone(),
                ..ModerationTargetView::default()
            },
            user,
            position,
            can_view_profile: true,
            time: TimeFormat::default(),
            phone_cache: false,
        }
    }

    /// `Core::moderation_target(community, user)`, as it changes.
    pub fn set_target(&mut self, target: ModerationTargetView, cx: &mut Context<Self>) {
        self.target = target;
        cx.notify();
    }

    pub fn set_user(&mut self, user: UserView, cx: &mut Context<Self>) {
        self.user = user;
        cx.notify();
    }

    pub fn set_position(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        self.position = position;
        cx.notify();
    }

    /// Whether "View Profile" is offered (the web shows it when a handler is given).
    pub fn set_can_view_profile(&mut self, can: bool, cx: &mut Context<Self>) {
        self.can_view_profile = can;
        cx.notify();
    }

    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    pub fn target(&self) -> &ModerationTargetView {
        &self.target
    }

    /// What an action does when picked: the event, unless it is off.
    pub fn choose(&mut self, action: MemberAction, cx: &mut Context<Self>) {
        if self.target.state != LoadState::Ready || blocked(&self.target, action).is_some() {
            return;
        }
        let kind = match action {
            MemberAction::Ban => Some(AdminActionKind::Ban),
            MemberAction::Kick => Some(AdminActionKind::Kick),
            MemberAction::Timeout => Some(AdminActionKind::Timeout),
            MemberAction::RemoveTimeout => Some(AdminActionKind::RemoveTimeout),
            MemberAction::ChangeRoles => None,
        };
        if kind
            .is_some_and(|kind| running(&self.target.op, &admin_action(kind, &self.target.user_id)))
        {
            return;
        }
        let user = self.user.clone();
        cx.emit(match action {
            MemberAction::Kick => ModerationMenuEvent::Kick { user },
            MemberAction::Timeout => ModerationMenuEvent::Timeout { user },
            MemberAction::RemoveTimeout => ModerationMenuEvent::RemoveTimeout { user },
            MemberAction::Ban => ModerationMenuEvent::Ban { user },
            MemberAction::ChangeRoles => ModerationMenuEvent::ChangeRoles { user_id: user.id },
        });
        cx.emit(ModerationMenuEvent::Close);
    }

    /// The actions in order: Remove Timeout stands in for Timeout while they're timed out.
    pub fn actions(&self) -> Vec<MemberAction> {
        let timeout = if self.target.timed_out_until_ms.is_some() {
            MemberAction::RemoveTimeout
        } else {
            MemberAction::Timeout
        };
        vec![
            MemberAction::ChangeRoles,
            MemberAction::Kick,
            timeout,
            MemberAction::Ban,
        ]
    }

    fn item(&self, action: MemberAction, cx: &mut Context<Self>) -> AnyElement {
        let (id, glyph, label, danger) = match action {
            MemberAction::ChangeRoles => (
                "moderate-roles",
                IconName::AdminPanelSettings,
                "Change Roles",
                false,
            ),
            MemberAction::Kick => ("moderate-kick", IconName::PersonRemove, "Kick", false),
            MemberAction::Timeout => ("moderate-timeout", IconName::Timer, "Timeout", false),
            MemberAction::RemoveTimeout => (
                "moderate-remove-timeout",
                IconName::TimerOff,
                "Remove Timeout",
                false,
            ),
            MemberAction::Ban => ("moderate-ban", IconName::Block, "Ban", true),
        };
        let ready = self.target.state == LoadState::Ready;
        let reason = if ready {
            blocked(&self.target, action).map(blocked_reason)
        } else {
            None
        };
        let entry = match action {
            MemberAction::Ban => Some(AdminActionKind::Ban),
            MemberAction::Kick => Some(AdminActionKind::Kick),
            MemberAction::Timeout => Some(AdminActionKind::Timeout),
            MemberAction::RemoveTimeout => Some(AdminActionKind::RemoveTimeout),
            MemberAction::ChangeRoles => None,
        }
        .map(|kind| admin_action(kind, &self.target.user_id));
        let in_flight = entry
            .as_ref()
            .is_some_and(|entry| running(&self.target.op, entry));
        let failed = entry
            .as_ref()
            .and_then(|entry| failure(&self.target.op, entry))
            .map(|error| format!("Last try failed: {}", error.message));
        let enabled = ready && reason.is_none() && !in_flight;
        let secondary = match (reason, in_flight, failed) {
            (Some(reason), _, _) => Some((reason.to_owned(), SecondaryTone::Muted)),
            (None, true, _) => Some(("In progress\u{2026}".to_owned(), SecondaryTone::Muted)),
            (None, false, Some(failed)) => Some((failed, SecondaryTone::Error)),
            (None, false, None) => None,
        };
        let touch = self.phone_cache;
        let menu = cx.weak_entity();
        let mut item = MenuItem::new(id, label, move |_, cx| {
            menu.update(cx, |menu, cx| menu.choose(action, cx)).ok();
        })
        .icon(glyph)
        .disabled(!enabled)
        .min_height(if touch { 48. } else { 36. });
        if danger {
            item = item.destructive();
        }
        if let Some((secondary, tone)) = secondary {
            item = item.secondary(secondary).secondary_tone(tone);
        }
        item.into_any_element()
    }

    fn header(&self, cx: &App) -> Div {
        let sem = cx.sem();
        let status = self.target.timed_out_until_ms.map(|until| {
            format!(
                "Timed out \u{b7} {}",
                timeout_left(now_ms(&self.time), until)
            )
        });
        div()
            .px(px(16.))
            .py(px(8.))
            .flex()
            .items_center()
            .gap(spacing(1.5))
            .child(user_face(&self.user, 32., None, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        text(Variant::Subtitle2, user_name(&self.user))
                            .truncate()
                            .text_color(sem.text_primary),
                    )
                    .children(status.map(|status| {
                        text(Variant::Caption, status)
                            .truncate()
                            .text_color(sem.warning)
                    })),
            )
    }

    fn divider(cx: &App) -> Div {
        div().my(px(8.)).h(px(1.)).bg(cx.sem().divider)
    }

    fn body(&mut self, phone: bool, cx: &mut Context<Self>) -> super::common::Observed {
        self.phone_cache = phone;
        let sem = cx.sem().clone();
        let name = user_name(&self.user);
        let mut list = div()
            .id("moderation-menu")
            .test_support()
            .role(Role::Menu)
            .aria_label(format!("Moderate {name}"))
            .py(px(8.))
            .bg(sem.paper)
            .text_color(sem.text_primary)
            .border_1()
            .border_color(sem.divider)
            .shadow_lg()
            .occlude()
            .on_mouse_down_out(cx.listener(|_, _, _, cx| cx.emit(ModerationMenuEvent::Close)))
            .child(self.header(cx));
        list = if phone {
            list.w_full().rounded_t(px(12.))
        } else {
            list.w(px(280.)).rounded(px(4.))
        };
        if self.can_view_profile {
            let user_id = self.user.id.clone();
            let menu = cx.weak_entity();
            list = list.child(Self::divider(cx)).child(
                MenuItem::new("moderate-profile", "View Profile", move |_, cx| {
                    menu.update(cx, |_, cx| {
                        cx.emit(ModerationMenuEvent::ViewProfile {
                            user_id: user_id.clone(),
                        });
                        cx.emit(ModerationMenuEvent::Close);
                    })
                    .ok();
                })
                .icon(IconName::Person)
                .min_height(if phone { 48. } else { 36. }),
            );
        }
        list = list.child(Self::divider(cx));
        match &self.target.state {
            LoadState::Loading => list.child(
                div()
                    .id("moderation-menu-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Loading what you can do")
                    .px(px(16.))
                    .py(px(10.))
                    .flex()
                    .items_center()
                    .gap(spacing(1.5))
                    .child(Spinner::new("moderation-menu-spinner").size(18.))
                    .child(
                        text(Variant::Body2, "Checking permissions\u{2026}")
                            .text_color(sem.text_secondary),
                    ),
            ),
            LoadState::Failed { error } => list.child(
                div()
                    .id("moderation-menu-failed")
                    .test_support()
                    .role(Role::Alert)
                    .px(px(16.))
                    .py(px(10.))
                    .flex()
                    .flex_col()
                    .child(
                        text(Variant::Body2, "Couldn't check what you can do")
                            .text_color(sem.error),
                    )
                    .child(
                        text(Variant::Caption, error.message.clone())
                            .text_color(sem.text_secondary),
                    ),
            ),
            LoadState::Ready => {
                let items: Vec<_> = self
                    .actions()
                    .into_iter()
                    .map(|action| self.item(action, cx))
                    .collect();
                list.children(items)
            }
        }
    }
}

impl Render for ModerationMenu {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let phone = is_phone(window);
        let body = self.body(phone, cx);
        if phone {
            let scrim = hsla(0., 0., 0., 0.5);
            return deferred(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .flex_col()
                    .justify_end()
                    .bg(scrim)
                    .child(body),
            )
            .with_priority(1)
            .into_any_element();
        }
        deferred(
            anchored()
                .position(self.position)
                .snap_to_window_with_margin(px(8.))
                .child(body),
        )
        .with_priority(1)
        .into_any_element()
    }
}
