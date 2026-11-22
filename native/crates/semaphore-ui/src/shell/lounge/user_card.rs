//! Your own card at the foot of the left island (design §3.3, the web's `UserCard`; compact and
//! wide only, a phone has none): avatar with presence, name, a line ("In Squad Up" in a call, else
//! your status), and in a call the mic and deafen state as status, not buttons (the call controls
//! live on the call bar).
//!
//! Native (B10): its one button opens the app's account menu (Settings, the admin area, Sign out),
//! where the web's opens a Menu of Settings, Your profile and Sign out…. On every place, the inbox
//! too, as Discord shows its user panel everywhere.

use super::lines::{CallStatus, Mic, call_state};
use super::{Act, column, text_line};
use crate::kit::{
    Avatar, AvatarSize, Card, ControlSize, Icon, IconButton, Padding, Presence, Skeleton,
};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, ICON_XS, SPACE_SM, SPACE_XS};
use semaphore_design::{Icon as I, LoungeIcon, person_colour};
use std::rc::Rc;

/// The account button's name.
pub const ACCOUNT_MENU_LABEL: &str = "Account menu";

#[derive(IntoElement)]
pub struct UserCard {
    /// None while your profile loads.
    name: Option<SharedString>,
    id: Option<String>,
    file: Option<String>,
    online: bool,
    line: Option<SharedString>,
    call: Option<CallStatus>,
    on_account: Option<Act>,
}

impl UserCard {
    pub fn new(name: Option<impl Into<SharedString>>) -> Self {
        Self {
            name: name.map(Into::into),
            id: None,
            file: None,
            online: true,
            line: None,
            call: None,
            on_account: None,
        }
    }

    /// Your user id (your avatar's colour) and picture.
    pub fn person(mut self, id: impl Into<String>, file: Option<String>) -> Self {
        self.id = Some(id.into());
        self.file = file;
        self
    }

    pub fn online(mut self, online: bool) -> Self {
        self.online = online;
        self
    }

    /// "In Squad Up", or your status text; none says Online or Offline.
    pub fn line(mut self, line: Option<impl Into<SharedString>>) -> Self {
        self.line = line.map(Into::into);
        self
    }

    /// In a call: how your mic and sound are.
    pub fn call(mut self, call: Option<CallStatus>) -> Self {
        self.call = call;
        self
    }

    pub fn on_account(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_account = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for UserCard {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let account = self.on_account.clone();
        let menu = IconButton::new("user-card-menu", I::MoreHoriz, ACCOUNT_MENU_LABEL)
            .lounge_icon(LoungeIcon::Ellipsis)
            .size(ControlSize::Sm)
            .on_click(move |_, window, cx| {
                if let Some(open) = &account {
                    open(window, cx);
                }
            });
        let Some(name) = self.name else {
            return Card::new("user-card").padding(Padding::Md).child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_SM))
                    .child(Skeleton::circle("user-card-avatar", AvatarSize::Md))
                    .child(div().flex_1().child(Skeleton::text("user-card-lines", 2)))
                    .child(menu),
            );
        };
        let state = self.call.as_ref().map(call_state);
        let live = self
            .call
            .as_ref()
            .is_some_and(|call| call.mic == Mic::On && !call.deafened);
        let line = self
            .line
            .unwrap_or_else(|| if self.online { "Online" } else { "Offline" }.into());
        Card::new("user-card").padding(Padding::Md).child(
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_SM))
                .child(
                    Avatar::new(name.clone())
                        .colour(person_colour(self.id.as_deref()))
                        .file(self.file.as_deref())
                        .presence(if self.online {
                            Presence::Online
                        } else {
                            Presence::Offline
                        }),
                )
                .child(
                    column()
                        .flex_1()
                        .gap(px(SPACE_XS))
                        .child(text_line(t::TEXT_NAME, name).truncate())
                        .child(
                            text_line(t::TEXT_META, line)
                                .text_color(sem.role.text_secondary)
                                .truncate(),
                        )
                        .when_some(state, |column, (icon, words)| {
                            column.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(SPACE_XS))
                                    .child(Icon::lounge(icon).size(ICON_XS).color(if live {
                                        sem.role.positive
                                    } else {
                                        sem.role.text_secondary
                                    }))
                                    .child(
                                        text_line(t::TEXT_META, words)
                                            .text_color(sem.role.text_secondary)
                                            .truncate(),
                                    ),
                            )
                        }),
                )
                .child(menu),
        )
    }
}
