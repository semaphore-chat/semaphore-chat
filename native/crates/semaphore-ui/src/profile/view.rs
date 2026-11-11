//! `ProfileModal` and `ProfilePage` drawn.

use super::header::{HeaderSize, banner, profile_skeleton, profile_text, ringed_avatar};
use super::{FriendAction, ProfileActions, ProfileEvent, ProfileModal, ProfilePage};
use crate::dms::names::user_name;
use crate::kit::{Button, ButtonSize, Chip, Paper, Variant, spacing, text};
use crate::panel::common::{design_icon, error_block, icon_button, is_phone};
use crate::theme::{FONT_FAMILY, SemTheme};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, Profile, ProfileView};
use semaphore_design::Icon as DesignIcon;

/// What a profile view shows, from its `ProfileView`.
pub(crate) enum Shown<'a> {
    Loading,
    NotFound,
    Failed,
    Ready(&'a Profile),
}

pub(crate) fn shown(view: &ProfileView) -> Shown<'_> {
    match (&view.state, &view.profile) {
        (_, Some(profile)) => Shown::Ready(profile),
        (LoadState::Loading, None) => Shown::Loading,
        (LoadState::Failed { error }, None) if error.code == "NOT_FOUND" => Shown::NotFound,
        (LoadState::Failed { .. }, None) => Shown::Failed,
        (LoadState::Ready, None) => Shown::NotFound,
    }
}

/// "Message", "Add Friend" and the like, for someone else's profile.
fn other_actions<V: EventEmitter<ProfileEvent>>(
    user_id: &str,
    actions: ProfileActions,
    small: bool,
    cx: &mut Context<V>,
) -> Vec<AnyElement> {
    let size = if small {
        ButtonSize::Small
    } else {
        ButtonSize::Medium
    };
    let mut out = Vec::new();
    if actions.can_message {
        let user_id = user_id.to_owned();
        out.push(
            Button::new("profile-message", "Message")
                .contained()
                .size(size)
                .start_icon(DesignIcon::Chat)
                .full_width()
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(ProfileEvent::Message {
                        user_id: user_id.clone(),
                    })
                }))
                .into_any_element(),
        );
    }
    match actions.friend {
        FriendAction::None => {}
        FriendAction::Add => {
            let user_id = user_id.to_owned();
            out.push(
                Button::new("profile-add-friend", "Add Friend")
                    .outlined()
                    .size(size)
                    .start_icon(DesignIcon::PersonAdd)
                    .full_width()
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.emit(ProfileEvent::AddFriend {
                            user_id: user_id.clone(),
                        })
                    }))
                    .into_any_element(),
            );
        }
        FriendAction::Pending => out.push(
            Button::new("profile-friend-pending", "Request pending")
                .outlined()
                .size(size)
                .full_width()
                .disabled(true)
                .into_any_element(),
        ),
        FriendAction::Friends => out.push(
            div()
                .id("profile-friends")
                .test_support()
                .flex()
                .items_center()
                .child(Chip::new("Friends"))
                .into_any_element(),
        ),
    }
    out
}

impl Render for ProfileModal {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let size = HeaderSize::Modal;
        let width = if is_phone(window) {
            (f32::from(window.viewport_size().width) - 32.).max(0.)
        } else {
            444.
        };
        let close = icon_button(
            "profile-close",
            DesignIcon::Close,
            "Close",
            false,
            hsla(0., 0., 1., 1.),
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(ProfileEvent::Close)));
        let close = div()
            .absolute()
            .top(spacing(1.))
            .right(spacing(1.))
            .rounded_full()
            .bg(hsla(0., 0., 0., 0.5))
            .child(close);
        let body: AnyElement = match shown(&self.view) {
            Shown::Loading => profile_skeleton(size, cx).into_any_element(),
            Shown::Failed => div()
                .pt(px(size.banner_height()))
                .child(error_block(
                    "profile-retry",
                    "Couldn't load this profile",
                    "Check your connection and try again.",
                    cx.listener(|_, _, _, cx| cx.emit(ProfileEvent::Retry)),
                    cx,
                ))
                .into_any_element(),
            Shown::NotFound => div()
                .id("profile-not-found")
                .test_support()
                .w_full()
                .flex()
                .flex_col()
                .child(banner(
                    "profile-banner",
                    None,
                    None,
                    size.banner_height(),
                    cx,
                ))
                .child(
                    div()
                        .p(spacing(3.))
                        .text_color(sem.error)
                        .child(text(Variant::Body1, "User not found")),
                )
                .into_any_element(),
            Shown::Ready(profile) => {
                let avatar = size.avatar();
                let name = user_name(&profile.user);
                let user_id = profile.user.id.clone();
                let mut buttons = if profile.is_me {
                    Vec::new()
                } else {
                    other_actions(&user_id, self.actions, true, cx)
                };
                buttons.push(
                    Button::new("profile-view-page", "View Profile")
                        .outlined()
                        .size(ButtonSize::Small)
                        .start_icon(DesignIcon::Person)
                        .full_width()
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(ProfileEvent::OpenPage {
                                user_id: user_id.clone(),
                            })
                        }))
                        .into_any_element(),
                );
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .child(banner(
                        "profile-banner",
                        profile.banner_file_id.as_deref(),
                        self.images.1.clone(),
                        size.banner_height(),
                        cx,
                    ))
                    .child(
                        div()
                            .relative()
                            .px(spacing(3.))
                            .pb(spacing(3.))
                            .pt(px(avatar * 0.5 + 12.))
                            .child(
                                div()
                                    .absolute()
                                    .top(px(-avatar * 0.5 - 4.))
                                    .left(spacing(3.))
                                    .child(ringed_avatar(
                                        &name,
                                        profile.user.avatar_file_id.as_deref(),
                                        self.images.0.clone(),
                                        avatar,
                                        cx,
                                    )),
                            )
                            .child(profile_text(profile, size, cx))
                            .child(
                                div()
                                    .mt(spacing(2.))
                                    .flex()
                                    .flex_wrap()
                                    .gap(spacing(1.))
                                    .children(buttons.into_iter().map(|button| {
                                        div().flex_1().min_w(px(120.)).flex().child(button)
                                    })),
                            ),
                    )
                    .into_any_element()
            }
        };
        let card = Paper::new()
            .elevated()
            .radius(8.)
            .w(px(width))
            .max_w_full()
            .max_h_full()
            .overflow_hidden()
            .relative()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("profile-modal-body")
                    .w_full()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(body),
            )
            .child(close);
        let popup = div()
            .id("profile-modal")
            .test_support()
            .role(Role::Dialog)
            .aria_label("Profile")
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .p(px(16.))
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .child(card);
        let view = cx.weak_entity();
        base::Dialog::new(cx)
            .open(true)
            .on_open_change(move |open, _, _, cx| {
                if !open {
                    view.update(cx, |_, cx| cx.emit(ProfileEvent::Close)).ok();
                }
            })
            .backdrop(
                div()
                    .absolute()
                    .inset_0()
                    .occlude()
                    .bg(hsla(0., 0., 0., 0.5)),
            )
            .popup(popup)
    }
}

impl Render for ProfilePage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = is_phone(window);
        // The phone's header is the modal's size: 120 px beside a name doesn't fit 390 px.
        let size = if phone {
            HeaderSize::Modal
        } else {
            HeaderSize::Page
        };
        let is_me = matches!(shown(&self.view), Shown::Ready(profile) if profile.is_me);
        let top = div()
            .w_full()
            .mb(spacing(3.))
            .flex()
            .items_center()
            .justify_between()
            .child(
                Button::new("profile-back", "Back")
                    .start_icon(DesignIcon::ArrowBack)
                    .color(sem.text_primary)
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(ProfileEvent::Back))),
            )
            .when(is_me, |top| {
                top.child(
                    Button::new("profile-edit", "Edit Profile")
                        .contained()
                        .start_icon(DesignIcon::Edit)
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(ProfileEvent::Edit))),
                )
            });
        let body: AnyElement = match shown(&self.view) {
            Shown::Loading => profile_skeleton(size, cx).into_any_element(),
            Shown::Failed => error_block(
                "profile-retry",
                "Couldn't load this profile",
                "Check your connection and try again.",
                cx.listener(|_, _, _, cx| cx.emit(ProfileEvent::Retry)),
                cx,
            ),
            Shown::NotFound => div()
                .id("profile-not-found")
                .test_support()
                .flex()
                .flex_col()
                .items_center()
                .py(spacing(4.))
                .gap(spacing(1.))
                .child(design_icon(DesignIcon::Person, 48., sem.text_disabled))
                .child(text(Variant::H6, "User not found").text_color(sem.text_primary))
                .child(
                    text(
                        Variant::Body2,
                        "This account doesn't exist, or was removed.",
                    )
                    .text_color(sem.text_secondary),
                )
                .into_any_element(),
            Shown::Ready(profile) => {
                let avatar = size.avatar();
                let name = user_name(&profile.user);
                let actions = if profile.is_me {
                    Vec::new()
                } else {
                    other_actions(&profile.user.id, self.actions, false, cx)
                };
                let text_block = profile_text(profile, size, cx);
                let content = if phone {
                    div()
                        .relative()
                        .px(spacing(2.))
                        .pb(spacing(3.))
                        .pt(px(avatar * 0.5 + 12.))
                        .child(
                            div()
                                .absolute()
                                .top(px(-avatar * 0.5 - 4.))
                                .left(spacing(2.))
                                .child(ringed_avatar(
                                    &name,
                                    profile.user.avatar_file_id.as_deref(),
                                    self.images.0.clone(),
                                    avatar,
                                    cx,
                                )),
                        )
                        .child(text_block)
                } else {
                    // `ProfileContent`: the avatar overlaps the banner by 60 px, the text beside it.
                    div()
                        .relative()
                        .p(spacing(3.))
                        .pt(spacing(2.))
                        .child(div().absolute().top(px(-60.)).left(spacing(3.)).child(
                            ringed_avatar(
                                &name,
                                profile.user.avatar_file_id.as_deref(),
                                self.images.0.clone(),
                                avatar,
                                cx,
                            ),
                        ))
                        .child(div().ml(px(136.)).min_h(px(72.)).child(text_block))
                };
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .child(banner(
                        "profile-banner",
                        profile.banner_file_id.as_deref(),
                        self.images.1.clone(),
                        size.banner_height(),
                        cx,
                    ))
                    .child(content.when(!actions.is_empty(), |content| {
                        content.child(
                            div()
                                .mt(spacing(2.))
                                .flex()
                                .flex_wrap()
                                .gap(spacing(1.))
                                .when(!phone, |row| row.ml(px(136.)))
                                .max_w(px(420.))
                                .children(actions.into_iter().map(|button| {
                                    div().flex_1().min_w(px(140.)).flex().child(button)
                                })),
                        )
                    }))
                    .into_any_element()
            }
        };
        div()
            .id("profile-page")
            .test_support()
            .role(Role::Region)
            .aria_label("Profile")
            .size_full()
            .font_family(FONT_FAMILY)
            .text_color(sem.text_primary)
            .bg(sem.background_default)
            .overflow_y_scroll()
            .child(
                div()
                    .w_full()
                    .max_w(px(900.))
                    .mx_auto()
                    .p(spacing(if phone { 2. } else { 3. }))
                    .child(top)
                    .child(
                        Paper::new()
                            .radius(8.)
                            .overflow_hidden()
                            .w_full()
                            .child(body),
                    ),
            )
    }
}
