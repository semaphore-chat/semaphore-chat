//! Home's "Invite people" card: `components/Home/HomeInviteCard.tsx` and
//! `useHomeInviteCard`. Offered to users who may create instance invites and haven't dismissed
//! it; it names the communities they may invite to (CREATE_INVITE), makes a 7-day, 10-use invite,
//! copies its link, and offers the instance's invite page to anyone who may read it.
//!
//! The web sends one invite naming every invitable community (or a community called "default"
//! alone, when there is one). Core's `create_instance_invite` takes that same list and refuses an
//! empty one, so a user with no invitable community sees the empty state instead of the web's
//! instance-only invite.

use super::{HomeEvent, HomeScreen};
use crate::kit::{
    Button, ButtonSize, IconButton, LiveElement, Paper, Snackbar, Variant, spacing, text,
};
use crate::messages::palette::Fonts;
use crate::panel::common::design_icon;
use crate::theme::SemTheme;
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as DesignIcon;

/// The invite the card makes: 10 uses, seven days (the web's `handleQuickInvite`).
pub const INVITE_USES: u32 = 10;
pub const INVITE_DAYS: i64 = 7;

pub const NOTICE_COPIED: &str = "Invite link copied to clipboard!";
pub const NOTICE_COPY_FAILED_AFTER_CREATE: &str =
    "Invite created, but it couldn't be copied. Use the copy button.";
pub const NOTICE_COPY_FAILED: &str = "Couldn't copy the invite link.";
pub const NOTICE_CREATE_FAILED: &str = "Couldn't create an invite link. Try again.";

/// A community an invite may name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteCommunity {
    pub id: String,
    pub name: String,
}

/// What the card says under its buttons for a moment, as the web's Snackbar does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteNotice {
    pub text: String,
    pub failed: bool,
}

impl InviteNotice {
    pub fn copied() -> Self {
        Self {
            text: NOTICE_COPIED.into(),
            failed: false,
        }
    }

    pub fn failed(text: &str) -> Self {
        Self {
            text: text.into(),
            failed: true,
        }
    }
}

/// What the card draws, decided by the app.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InviteCardModel {
    /// May create instance invites and hasn't dismissed the card.
    pub visible: bool,
    /// May read the instance's invites: the "Manage" link to the admin invites page.
    pub can_manage: bool,
    /// Some community's roles are still arriving: the web disables Quick invite meanwhile.
    pub loading: bool,
    /// Communities this user may invite to.
    pub communities: Vec<InviteCommunity>,
    pub creating: bool,
    /// The newest invite's code, for the copy button.
    pub code: Option<String>,
    pub notice: Option<InviteNotice>,
}

/// The buttons the card offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteEvent {
    /// "Quick invite": make the invite and copy its link.
    QuickInvite,
    /// The copy button beside the code.
    Copy,
    /// "Manage": the instance's invites page.
    Manage,
    /// The close button: gone for this install.
    Dismiss,
}

/// Whether Quick invite can run: a visible card, roles read, and nothing in flight. With no
/// community to invite to, it's an invite to the instance alone, as on the web.
pub fn can_quick_invite(model: &InviteCardModel) -> bool {
    model.visible && !model.loading && !model.creating
}

/// The communities a quick invite names: the one called "default" alone when there is one, else
/// every invitable one (none: the instance alone), as the web does.
pub fn quick_invite_targets(communities: &[InviteCommunity]) -> Vec<String> {
    match communities
        .iter()
        .find(|community| community.name.eq_ignore_ascii_case("default"))
    {
        Some(default) => vec![default.id.clone()],
        None => communities
            .iter()
            .map(|community| community.id.clone())
            .collect(),
    }
}

/// What the card promises: the web's "Create a 7-day invite link" plus the limits it sends.
pub fn invite_terms() -> String {
    format!("Create a 7-day invite link and copy it to your clipboard. Up to {INVITE_USES} uses.")
}

impl HomeScreen {
    /// The card, when it applies.
    pub(crate) fn invite_card(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let model = &self.invite;
        if !model.visible {
            return None;
        }
        let sem = cx.sem().clone();
        let quick = can_quick_invite(model);
        let controls = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(spacing(1.))
            .when_some(model.code.clone(), |controls, code| {
                controls.child(
                    div()
                        .id("home-invite-code")
                        .test_support()
                        .flex()
                        .items_center()
                        .gap(spacing(0.5))
                        .child(
                            text(Variant::Body2, code)
                                .font_family(Fonts::pick(cx).code)
                                .text_color(sem.text_primary),
                        )
                        .child(
                            IconButton::new(
                                "home-invite-copy",
                                DesignIcon::ContentCopy,
                                "Copy invite link",
                            )
                            .tiny()
                            .on_click(cx.listener(|_, _, _, cx| {
                                cx.emit(HomeEvent::Invite(InviteEvent::Copy))
                            })),
                        ),
                )
            })
            .child(
                Button::new("home-invite-quick", "Quick invite")
                    .contained()
                    .size(ButtonSize::Small)
                    .disabled(!quick)
                    .loading(model.creating)
                    .on_click(cx.listener(|_, _, _, cx| {
                        cx.emit(HomeEvent::Invite(InviteEvent::QuickInvite))
                    })),
            )
            .when(model.can_manage, |controls| {
                controls.child(
                    Button::new("home-invite-manage", "Manage")
                        .outlined()
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::Settings)
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(HomeEvent::Invite(InviteEvent::Manage))
                        })),
                )
            })
            .child(
                IconButton::new(
                    "home-invite-dismiss",
                    DesignIcon::Close,
                    "Dismiss invite card",
                )
                .tiny()
                .on_click(
                    cx.listener(|_, _, _, cx| cx.emit(HomeEvent::Invite(InviteEvent::Dismiss))),
                ),
            );
        let empty = !model.loading && model.communities.is_empty();
        Some(
            div()
                .id("home-invite")
                .test_support()
                .role(Role::Region)
                .aria_label("Invite people")
                .w_full()
                .child(
                    Paper::new()
                        .radius(8.)
                        .w_full()
                        .p(spacing(2.))
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(spacing(2.))
                        .child(design_icon(DesignIcon::PersonAdd, 28., sem.primary))
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(200.))
                                .flex()
                                .flex_col()
                                .child(
                                    text(Variant::Subtitle2, "Invite people")
                                        .font_weight(FontWeight(600.)),
                                )
                                .child(
                                    text(Variant::Body2, invite_terms())
                                        .text_color(sem.text_secondary),
                                )
                                .when(empty, |body| {
                                    body.child(
                                        div()
                                            .id("home-invite-empty")
                                            .test_support()
                                            .role(Role::Note)
                                            .aria_label(
                                                "No community to invite people to yet: the link invites them to the instance alone.",
                                            )
                                            .child(
                                                text(
                                                    Variant::Caption,
                                                    "No community to invite people to yet: the link invites them to the instance alone.",
                                                )
                                                .text_color(sem.text_secondary),
                                            ),
                                    )
                                }),
                        )
                        .child(controls)
                        .children(model.notice.clone().map(|notice| {
                            // A toast on the web (`showNotification`): its `Alert` is
                            // `role="alert"`, assertive.
                            div()
                                .id("home-invite-notice")
                                .test_support()
                                .role(Role::Status)
                                .aria_label(notice.text.clone())
                                .aria_live(Live::Assertive)
                                .w_full()
                                .flex()
                                .justify_center()
                                .child(Snackbar::new(notice.text))
                        })),
                )
                .into_any_element(),
        )
    }
}
