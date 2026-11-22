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
        row = row.on_click(move |window, cx| open(&id, window, cx));
    }
    let row = focused(row, rows, &member.id, cx);
    let id = member.id.clone();
    div()
        .id(SharedString::from(format!("member-{}", member.id)))
        .test_support()
        .when_some(on_menu, |wrapper, menu| {
            wrapper.on_mouse_down(MouseButton::Right, move |event, window, cx| {
                cx.stop_propagation();
                menu(&id, event.position, window, cx);
            })
        })
        .child(row)
        .into_any_element()
}

impl RenderOnce for MembersIsland {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let secondary = cx.sem().role.text_secondary;
        let groups = [
            ("Hosts", &self.groups.hosts),
            ("Around", &self.groups.around),
            ("Away", &self.groups.away),
        ];
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
