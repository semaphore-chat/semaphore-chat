//! Faces for DM and friend rows: `UserAvatar` with its presence dot, and the group icon.

use super::names::user_name;
use crate::panel::common::design_icon;
use crate::shell::user_avatar;
use crate::theme::{SemTheme, color::hsla_of};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::UserView;
use semaphore_design::Icon as DesignIcon;

/// The web's online green, as the members list draws it, and a solid grey for offline.
const ONLINE: u32 = 0x43b581;
const OFFLINE: u32 = 0x747f8d;

/// A user's avatar; with `online` set, the presence dot at its bottom right on `surface`.
pub(crate) fn user_face(user: &UserView, size: f32, online: Option<bool>, cx: &App) -> Div {
    let surface = cx.sem().paper;
    let dot = (size * 0.3).clamp(10., 14.);
    div()
        .relative()
        .flex_shrink_0()
        .child(user_avatar(
            &user_name(user),
            user.avatar_file_id.as_deref(),
            size,
        ))
        .when_some(online, |face, online| {
            face.child(
                div()
                    .absolute()
                    .bottom(px(-1.))
                    .right(px(-1.))
                    .size(px(dot))
                    .rounded_full()
                    .border_2()
                    .border_color(surface)
                    .bg(rgb(if online { ONLINE } else { OFFLINE })),
            )
        })
}

/// A group's avatar: MUI's `Avatar` on the secondary colour with `GroupIcon`.
pub(crate) fn group_face(size: f32, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .size(px(size))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .bg(hsla_of(sem.palette.secondary_main))
        .child(design_icon(
            DesignIcon::Group,
            size * 0.6,
            hsla_of(sem.palette.secondary_contrast_text),
        ))
}
