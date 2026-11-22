//! "Who's around": the community's members in the right region (design §3.4, the web's
//! `MembersIsland`), an island at wide and a Sheet below (the template). Hosts (members with a
//! hoisted role), Around (online) and Away; each row shows the role, the status text or the voice
//! room they are in. A row opens the member's profile.
//!
//! Native: no "Show more" (core lists one page) and no "Seen 2h ago" (core has no last-seen); a
//! truncated list says so under the heading. A right-click on a row asks for the moderation menu,
//! as W5's members panel did. Row ids are `member-<id>`.

use super::lines::{MemberGroups, around_line, member_line};
use super::{Face, IdAct, MemberSummary, Rows, column, focused, text_line};
use crate::kit::{Avatar, ListRow, Pill, PillSize, Presence, RowSize};
use crate::shell::press::{LONG_PRESS, Press, moved_too_far};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_LG, SPACE_XS};
use semaphore_design::person_colour;
use std::rc::Rc;

type MenuAct = Rc<dyn Fn(&str, Point<Pixels>, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct MembersIsland {
    groups: MemberGroups,
    around: Option<u32>,
    truncated: bool,
    face: Face,
    on_profile: Option<IdAct>,
    on_menu: Option<MenuAct>,
    scroll: Option<ScrollHandle>,
}

impl MembersIsland {
    pub fn new(groups: MemberGroups, face: Face) -> Self {
        Self {
            groups,
            around: None,
            truncated: false,
            face,
            on_profile: None,
            on_menu: None,
            scroll: None,
        }
    }

    /// Online members in the whole community; none when no source knows it.
    pub fn around(mut self, count: Option<u32>) -> Self {
        self.around = count;
        self
    }

    /// The community has more members than these.
    pub fn truncated(mut self, truncated: bool) -> Self {
        self.truncated = truncated;
        self
    }

    pub fn on_profile(mut self, handler: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_profile = Some(Rc::new(handler));
        self
    }

    /// A right-click on a row, at a window position.
    pub fn on_menu(
        mut self,
        handler: impl Fn(&str, Point<Pixels>, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_menu = Some(Rc::new(handler));
        self
    }

    /// The handle of the island or sheet the list scrolls in: a row that takes focus is
    /// brought into view.
    pub fn scroll(mut self, handle: &ScrollHandle) -> Self {
        self.scroll = Some(handle.clone());
        self
    }
}

fn member_row(
    member: &MemberSummary,
    rows: &Rows,
    on_profile: Option<IdAct>,
    on_menu: Option<MenuAct>,
    press: Option<&Entity<Pressing>>,
    cx: &App,
) -> AnyElement {
    let away = !member.online;
    let mut row = ListRow::new(
        SharedString::from(format!("member-row-{}", member.id)),
        member.name.clone(),
    )
    .size(RowSize::Lg)
    .muted(away)
    .leading(
        Avatar::new(member.name.clone())
            .colour(person_colour(Some(&member.id)))
            .file(member.file.as_deref())
            .presence(if away {
                Presence::Offline
            } else {
                Presence::Online
            })
            .decorative(true),
    );
    if let Some(line) = member_line(member) {
        row = row.secondary(line);
    }
    let state = if away { "away" } else { "online" };
    row = row.trailing_label(match &member.role {
        Some(role) => format!("{role}, {state}"),
        None => state.to_owned(),
    });
    if let Some(role) = &member.role {
        row = row.trailing(Pill::new(role.clone()).size(PillSize::Sm));
    }
    if let Some(open) = on_profile {
        let id = member.id.clone();
        let press = press.cloned();
        row = row.on_click(move |window, cx| {
            // The release of a long press that opened the menu isn't a click.
            if let Some(press) = &press
                && press.update(cx, |state, _| state.take_fired(&id))
            {
                return;
            }
            open(&id, window, cx)
        });
    }
    let row = focused(row, rows, &member.id, cx);
    let id = member.id.clone();
    let long_press = press.cloned().zip(on_menu.clone());
    div()
        .id(SharedString::from(format!("member-{}", member.id)))
        .test_support()
        .when_some(on_menu, |wrapper, menu| {
            let id = id.clone();
            wrapper.on_mouse_down(MouseButton::Right, move |event, window, cx| {
                cx.stop_propagation();
                menu(&id, event.position, window, cx);
            })
        })
        // On a phone a long press opens the menu, as the web's `useLongPress` (W5).
        .when_some(long_press, |wrapper, (press, menu)| {
            let (down, moved, left) = (press.clone(), press.clone(), press);
            wrapper
                .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                    start_press(&down, &id, event.position, menu.clone(), window, cx);
                })
                .on_mouse_move(move |event: &MouseMoveEvent, _, cx| {
                    moved.update(cx, |state, _| state.drag_to(event.position));
                })
                .on_hover(move |hovered, _, cx| {
                    if !*hovered {
                        left.update(cx, |state, _| state.cancel());
                    }
                })
        })
        .child(row)
        .into_any_element()
}

/// A press on a member row, on a phone, until it is released, dragged or long enough.
#[derive(Default)]
pub(crate) struct Pressing {
    press: Option<Press>,
    timer: Option<Task<()>>,
}

impl Pressing {
    /// The menu opened from `id`'s press: its release is swallowed once.
    fn take_fired(&mut self, id: &str) -> bool {
        let fired = self
            .press
            .as_ref()
            .is_some_and(|press| press.fired && press.user_id == id);
        if fired {
            self.press = None;
        }
        fired
    }

    fn drag_to(&mut self, at: Point<Pixels>) {
        if self
            .press
            .as_ref()
            .is_some_and(|press| !press.fired && moved_too_far(press.at, at))
        {
            self.cancel();
        }
    }

    fn cancel(&mut self) {
        if self.press.as_ref().is_some_and(|press| !press.fired) {
            self.press = None;
            self.timer = None;
        }
    }
}

fn start_press(
    state: &Entity<Pressing>,
    id: &str,
    at: Point<Pixels>,
    menu: MenuAct,
    window: &mut Window,
    cx: &mut App,
) {
    let weak = state.downgrade();
    let user_id = id.to_owned();
    let timer = window.spawn(cx, async move |cx| {
        cx.background_executor().timer(LONG_PRESS).await;
        cx.update(|window, cx| {
            let Some(state) = weak.upgrade() else { return };
            let due = state.update(cx, |state, _| match &mut state.press {
                Some(press) if press.user_id == user_id && !press.fired => {
                    press.fired = true;
                    Some(press.at)
                }
                _ => None,
            });
            if let Some(at) = due {
                menu(&user_id, at, window, cx);
            }
        })
        .ok();
    });
    state.update(cx, |state, _| {
        state.press = Some(Press {
            user_id: id.to_owned(),
            at,
            fired: false,
        });
        state.timer = Some(timer);
    });
}

impl RenderOnce for MembersIsland {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let groups = [
            ("Hosts", &self.groups.hosts),
            ("Around", &self.groups.around),
            ("Away", &self.groups.away),
        ];
        // A phone's long press (W5), kept while the island is drawn.
        let phone = crate::kit::WidthRange::current(window).is_phone();
        let press = window.use_keyed_state("members-press", cx, |_, _| Pressing::default());
        let rows = Rows::new(
            "members-list",
            groups
                .iter()
                .flat_map(|(_, members)| members.iter())
                .map(|member| (member.id.clone(), member.name.clone()))
                .collect(),
            None,
            self.scroll.clone(),
            window,
            cx,
        );
        let sections: Vec<AnyElement> = groups
            .iter()
            .filter(|(_, members)| !members.is_empty())
            .map(|(title, members)| {
                column()
                    .gap(px(SPACE_XS))
                    .child(text_line(t::TEXT_SECTION, *title).text_color(secondary))
                    .children(members.iter().map(|member| {
                        member_row(
                            member,
                            &rows,
                            self.on_profile.clone(),
                            self.on_menu.clone(),
                            phone.then_some(&press),
                            cx,
                        )
                    }))
                    .into_any_element()
            })
            .collect();
        let shown = groups
            .iter()
            .map(|(_, members)| members.len())
            .sum::<usize>();
        let line = around_line(self.around);
        column()
            .gap(px(SPACE_LG))
            .child(
                column()
                    .gap(px(SPACE_XS))
                    .child(text_line(t::TEXT_TITLE, "Who's around"))
                    .when_some(line, |heading, line| {
                        heading.child(text_line(t::TEXT_META, line).text_color(secondary))
                    })
                    .when(self.truncated, |heading| {
                        heading.child(
                            text_line(t::TEXT_META, format!("Showing the first {shown}"))
                                .text_color(secondary),
                        )
                    }),
            )
            .child(
                self.face
                    .view("members-load")
                    .lines(8)
                    .empty("No members yet. People show here once they join.")
                    .error_title("Couldn't load members")
                    .content(rows.keys(column()).gap(px(SPACE_LG)).children(sections)),
            )
    }
}
