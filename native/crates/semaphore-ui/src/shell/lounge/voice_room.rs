//! A voice room in the community's left island (design §3.3, the web's `VoiceRoomCard`): a plain
//! Card with the room's name, who is in it and Join or Leave. The room you are in wears the accent
//! outline ("You're here") and says who is talking. Join joins from here (design PA-2).
//!
//! Native (B10 decision): the room's name opens the room's route (its pre-join or call view)
//! until the call bar (B11) and the voice room (B15) bring the web's way there. It keeps the old
//! row's id, `channel-<id>`.

use super::lines::{people_line, talking_line};
use super::{Act, RoomPerson, column, text_line};
use crate::kit::{
    AvatarSize, AvatarStack, Button, ButtonSize, Card, Icon, Pill, PillSize, PillTone, StackPerson,
    WidthRange,
};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_SM, SPACE_XS};
use semaphore_design::{LoungeIcon, person_colour};
use std::collections::HashSet;
use std::rc::Rc;

#[derive(IntoElement)]
pub struct VoiceRoomCard {
    id: String,
    name: SharedString,
    people: Vec<RoomPerson>,
    you: Option<String>,
    speaking: HashSet<String>,
    you_are_here: bool,
    can_join: bool,
    joining: bool,
    on_join: Option<Act>,
    on_leave: Option<Act>,
    on_open: Option<Act>,
}

impl VoiceRoomCard {
    /// `id` is the room's channel id.
    pub fn new(
        id: impl Into<String>,
        name: impl Into<SharedString>,
        people: Vec<RoomPerson>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            people,
            you: None,
            speaking: HashSet::new(),
            you_are_here: false,
            can_join: true,
            joining: false,
            on_join: None,
            on_leave: None,
            on_open: None,
        }
    }

    /// Your user id, to say "You".
    pub fn you(mut self, you: Option<String>) -> Self {
        self.you = you;
        self
    }

    /// Who is talking: known only in your own room.
    pub fn speaking(mut self, speaking: HashSet<String>) -> Self {
        self.speaking = speaking;
        self
    }

    /// This device is in the room's call.
    pub fn you_are_here(mut self, here: bool) -> Self {
        self.you_are_here = here;
        self
    }

    /// Join is allowed here (the CONNECT permission).
    pub fn can_join(mut self, can: bool) -> Self {
        self.can_join = can;
        self
    }

    /// Your join to this room is running.
    pub fn joining(mut self, joining: bool) -> Self {
        self.joining = joining;
        self
    }

    pub fn on_join(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_join = Some(Rc::new(handler));
        self
    }

    pub fn on_leave(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_leave = Some(Rc::new(handler));
        self
    }

    /// The name opens the room's route.
    pub fn on_open(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_open = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for VoiceRoomCard {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = WidthRange::current(window).is_phone();
        let size = if phone {
            ButtonSize::Md
        } else {
            ButtonSize::Sm
        };
        let you = self.you.as_deref();
        let here = self.you_are_here;
        let talking = here
            .then(|| talking_line(&self.people, &self.speaking, you))
            .flatten();
        let action = if here {
            let leave = self.on_leave.clone();
            Some(
                Button::new(
                    SharedString::from(format!("room-leave-{}", self.id)),
                    "Leave",
                )
                .soft()
                .size(size)
                .on_click(move |_, window, cx| {
                    if let Some(leave) = &leave {
                        leave(window, cx);
                    }
                }),
            )
        } else if self.can_join {
            let join = self.on_join.clone();
            Some(
                Button::new(SharedString::from(format!("room-join-{}", self.id)), "Join")
                    .soft()
                    .size(size)
                    .loading(self.joining)
                    .on_click(move |_, window, cx| {
                        if let Some(join) = &join {
                            join(window, cx);
                        }
                    }),
            )
        } else {
            None
        };
        let open = self.on_open.clone();
        let hover = sem.role.accent;
        let name = base::Button::new(SharedString::from(format!("channel-{}", self.id)))
            .accessibility_label(format!("{}, open the room", self.name))
            .flex()
            .w_full()
            .min_w_0()
            .justify_start()
            .overflow_hidden()
            .cursor_pointer()
            .text_color(sem.role.text)
            .hover(move |style| style.text_color(hover))
            .child(
                text_line(t::TEXT_NAME, self.name.clone())
                    .min_w_0()
                    .truncate(),
            )
            .on_click(move |_, window, cx| {
                if let Some(open) = &open {
                    open(window, cx);
                }
            });
        let header = div()
            .flex()
            .items_center()
            .gap(px(SPACE_SM))
            .child(Icon::lounge(LoungeIcon::Volume2).color(sem.role.text_secondary))
            .child(
                column()
                    .flex_1()
                    .items_start()
                    .gap(px(SPACE_XS))
                    .child(name)
                    .when(here, |column| {
                        column.child(
                            Pill::new("You're here")
                                .tone(PillTone::Accent)
                                .size(PillSize::Sm),
                        )
                    }),
            )
            .children(action);
        let people = if self.people.is_empty() {
            text_line(t::TEXT_META, "Nobody here")
                .text_color(sem.role.text_secondary)
                .into_any_element()
        } else {
            let stack: Vec<StackPerson> = self
                .people
                .iter()
                .map(|person| {
                    StackPerson::new(person.name.clone())
                        .colour(person_colour(Some(&person.id)))
                        .speaking(here && self.speaking.contains(&person.id))
                        .file(person.file.as_deref())
                })
                .collect();
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_SM))
                .child(
                    AvatarStack::new(
                        SharedString::from(format!("room-people-{}", self.id)),
                        stack,
                    )
                    .size(AvatarSize::Sm),
                )
                .child(
                    column()
                        .flex_1()
                        .gap(px(SPACE_XS))
                        .child(
                            text_line(t::TEXT_META, people_line(&self.people, you, here))
                                .text_color(sem.role.text_secondary)
                                .truncate(),
                        )
                        .when_some(talking, |column, talking| {
                            column.child(
                                text_line(t::TEXT_META, talking)
                                    .text_color(sem.role.accent)
                                    .truncate(),
                            )
                        }),
                )
                .into_any_element()
        };
        Card::new(SharedString::from(format!("room-{}", self.id)))
            .selected(here)
            .child(column().gap(px(SPACE_SM)).child(header).child(people).when(
                !here && !self.can_join,
                |column| {
                    column.child(
                        text_line(t::TEXT_META, "You can't join this room")
                            .text_color(sem.role.text_dim),
                    )
                },
            ))
    }
}
