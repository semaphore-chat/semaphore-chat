//! The members panel: `MemberList`.

use super::rail::status_dot;
use super::{Load, MEMBER_LIST_WIDTH, MemberRow, Shell, error_state, user_avatar};
use crate::kit::{Skeleton, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

struct Sections {
    roles: Vec<(String, Vec<MemberRow>)>,
    online: Vec<MemberRow>,
    offline: Vec<MemberRow>,
}

/// `MemberList`'s grouping: hoisted roles by position, then online, then offline, each by name.
fn group(members: Vec<MemberRow>) -> Sections {
    fn name(member: &MemberRow) -> String {
        member
            .user
            .display_name
            .clone()
            .unwrap_or_else(|| member.user.username.clone())
            .to_lowercase()
    }
    let mut roles: Vec<(String, i32, Vec<MemberRow>)> = Vec::new();
    let (mut online, mut offline) = (Vec::new(), Vec::new());
    for member in members {
        if let Some((role, position)) = member.display_role.clone() {
            match roles.iter_mut().find(|(existing, _, _)| *existing == role) {
                Some((_, _, rows)) => rows.push(member),
                None => roles.push((role, position, vec![member])),
            }
        } else if member.online {
            online.push(member);
        } else {
            offline.push(member);
        }
    }
    roles.sort_by_key(|(_, position, _)| *position);
    let mut roles: Vec<(String, Vec<MemberRow>)> = roles
        .into_iter()
        .map(|(role, _, rows)| (role, rows))
        .collect();
    for (_, rows) in &mut roles {
        rows.sort_by_key(name);
    }
    online.sort_by_key(name);
    offline.sort_by_key(name);
    Sections {
        roles,
        online,
        offline,
    }
}

impl Shell {
    pub(super) fn members_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem().clone();
        let community_id = self
            .nav
            .current()
            .community_id()
            .unwrap_or_default()
            .to_owned();
        let members = self.source.members(&community_id);
        let title = match &members {
            Load::Loading => "Members — ...".to_owned(),
            Load::Failed(_) => "Members".to_owned(),
            Load::Ready(rows) => format!("Members — {}", rows.len()),
        };
        let body = match members {
            Load::Loading => div()
                .id("members-loading")
                .test_support()
                .role(Role::ProgressIndicator)
                .aria_label("Loading members")
                .children((0..6usize).map(member_skeleton))
                .into_any_element(),
            Load::Failed(_) => error_state(
                "members-retry",
                "Couldn't load members",
                "Check your connection and try again.",
                true,
                cx,
            )
            .into_any_element(),
            Load::Ready(rows) if rows.is_empty() => div()
                .py(spacing(4.))
                .flex()
                .justify_center()
                .text_color(sem.text_secondary)
                .child(text(Variant::Body2, "No members found"))
                .into_any_element(),
            Load::Ready(rows) => {
                let sections = group(rows);
                let mut list = div().flex().flex_col();
                for (role, rows) in sections.roles {
                    list = list.child(section_header(&role, rows.len(), cx));
                    list = list.children(rows.iter().map(|row| member_row(row, cx)));
                }
                if !sections.online.is_empty() {
                    list = list.child(section_header("Online", sections.online.len(), cx));
                    list = list.children(sections.online.iter().map(|row| member_row(row, cx)));
                }
                if !sections.offline.is_empty() {
                    list = list.child(section_header("Offline", sections.offline.len(), cx));
                    list = list.children(sections.offline.iter().map(|row| member_row(row, cx)));
                }
                list.into_any_element()
            }
        };
        div()
            .id("members-panel")
            .test_support()
            .role(Role::Complementary)
            .aria_label("Members")
            .w(px(MEMBER_LIST_WIDTH))
            .h_full()
            .flex()
            .flex_shrink_0()
            .flex_col()
            .border_l_1()
            .border_color(sem.divider)
            .bg(sem.paper)
            .child(
                div()
                    .p(spacing(2.))
                    .pb(spacing(1.))
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(sem.divider)
                    .child(
                        text(Variant::H6, title)
                            .text_size(px(14.))
                            .line_height(px(22.))
                            .font_weight(FontWeight(600.)),
                    ),
            )
            .child(
                div()
                    .id("members-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(body),
            )
    }
}

fn member_skeleton(index: usize) -> impl IntoElement {
    div()
        .px(spacing(1.))
        .py(spacing(0.5))
        .flex()
        .items_center()
        .child(
            div()
                .w(px(40.))
                .flex_shrink_0()
                .child(Skeleton::circle(("member-loading-face", index), 32.)),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(4.))
                .py(spacing(0.5))
                .child(Skeleton::rect(
                    ("member-loading-name", index),
                    relative(0.6),
                    14.,
                ))
                .child(Skeleton::rect(
                    ("member-loading-status", index),
                    relative(0.4),
                    12.,
                )),
        )
}

fn section_header(label: &str, count: usize, cx: &mut Context<Shell>) -> impl IntoElement {
    let secondary = cx.sem().text_secondary;
    div()
        .px(spacing(2.))
        .pt(spacing(2.))
        .pb(spacing(0.5))
        .text_color(secondary)
        .child(text(Variant::SectionLabel, format!("{label} — {count}")))
}

fn member_row(member: &MemberRow, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let sem = cx.sem();
    let name = member
        .user
        .display_name
        .clone()
        .unwrap_or_else(|| member.user.username.clone());
    let hover = sem.overlay_light;
    let (paper, secondary, primary) = (sem.paper, sem.text_secondary, sem.text_primary);
    let mut accessible = name.clone();
    accessible.push_str(if member.online {
        ", online"
    } else {
        ", offline"
    });
    if let Some(status) = &member.status {
        accessible.push_str(", ");
        accessible.push_str(status);
    }
    base::Button::new(ElementId::Name(format!("member-{}", member.user.id).into()))
        .accessibility_label(accessible)
        .px(spacing(2.))
        .py(spacing(0.5))
        .mb(px(2.))
        .min_h(px(if member.status.is_some() { 51. } else { 47. }))
        .flex()
        .items_center()
        .justify_start()
        .rounded(px(8.))
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .focus_visible(move |style| style.bg(hover))
        .child(
            div().w(px(40.)).flex_shrink_0().child(
                div()
                    .relative()
                    .size(px(32.))
                    .child(user_avatar(
                        &name,
                        member.user.avatar_file_id.as_deref(),
                        32.,
                    ))
                    .when(member.online, |face| face.child(status_dot(paper))),
            ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .text_color(primary)
                .child(
                    text(Variant::ListItem, name)
                        .line_height(px(17.))
                        .truncate(),
                )
                .children(member.status.clone().map(|status| {
                    text(Variant::Meta, status)
                        .line_height(px(15.))
                        .text_color(secondary)
                        .truncate()
                })),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
    use core::prelude::v1::test;
    use semaphore_core::model::UserView;

    fn member(name: &str, online: bool, role: Option<(&str, i32)>) -> MemberRow {
        MemberRow {
            user: UserView {
                id: name.into(),
                username: name.into(),
                display_name: None,
                avatar_file_id: None,
            },
            status: None,
            online,
            display_role: role.map(|(role, position)| (role.into(), position)),
        }
    }

    #[test]
    fn groups_like_the_web() {
        let sections = group(vec![
            member("zoe", true, None),
            member("amy", true, None),
            member("bob", false, None),
            member("own", true, Some(("Owner", 0))),
            member("mod", false, Some(("Mods", 3))),
        ]);
        let roles: Vec<&str> = sections
            .roles
            .iter()
            .map(|(role, _)| role.as_str())
            .collect();
        assert_eq!(roles, ["Owner", "Mods"]);
        let names = |rows: &[MemberRow]| {
            rows.iter()
                .map(|row| row.user.username.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&sections.online), ["amy", "zoe"]);
        assert_eq!(names(&sections.offline), ["bob"]);
    }
}
