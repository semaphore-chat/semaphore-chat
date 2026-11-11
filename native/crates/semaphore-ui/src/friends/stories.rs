//! The friends stories: the panel in the DM sidebar's column (or filling a phone), and the add
//! friend dialog.

use super::{AddFriendDialog, AddOutcome, FriendsPanel, FriendsTab, RequestsTab};
use crate::dms::picker::Found;
use crate::dms::stories::{
    DAY, ava, dev, dialog_framed, emma, failed, finn, long_user, person, sample_friends,
    sidebar_framed,
};
use crate::messages::fixture::NOW_MS;
use crate::panel::PanelClock;
use crate::stories::Story;
use gpui_kit::*;
use semaphore_core::model::{
    ErrorView, FriendRequestRow, FriendRow, FriendsView, LoadState, UserView,
};

fn panel_story(view: FriendsView, tab: FriendsTab, requests: RequestsTab, cx: &mut App) -> AnyView {
    let panel = cx.new(|cx| {
        let mut panel = FriendsPanel::new(cx);
        panel.set_clock(PanelClock::fixed(NOW_MS), cx);
        panel.set_view(view, cx);
        panel.set_tab(tab, cx);
        panel.set_requests_tab(requests, cx);
        panel
    });
    sidebar_framed(panel.into(), cx)
}

fn long_view() -> FriendsView {
    let many: Vec<FriendRow> = (0..14)
        .map(|index| FriendRow {
            friendship_id: format!("f-many-{index}"),
            user: person(
                &format!("many{index}"),
                &format!("someone_with_a_long_username_{index}"),
                Some(&format!(
                    "A Friend With An Unreasonably Long Display Name {index}"
                )),
            ),
            online: index % 3 == 0,
            busy: index == 4,
        })
        .collect();
    let mut view = sample_friends();
    view.friends.splice(0..0, many);
    view.incoming.push(FriendRequestRow {
        friendship_id: "r-long".into(),
        user: long_user(),
        sent_at_ms: NOW_MS - 30 * DAY,
        busy: true,
    });
    view
}

fn add_story(
    query: &str,
    found: Found,
    picked: Vec<UserView>,
    outcome: AddOutcome,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let dialog = cx.new(|cx| AddFriendDialog::new(window, cx));
    let form = dialog.read(cx).form().clone();
    let query = query.to_owned();
    form.update(cx, |form, cx| {
        form.set_friends(&sample_friends(), cx);
        let picker = form.picker.clone();
        picker.update(cx, |picker, cx| {
            picker.preset(&query, found, picked, window, cx)
        });
        form.set_outcome(outcome, window, cx);
    });
    dialog_framed(dialog.into(), cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("friends-loading", |_, _, cx| {
            let view = FriendsView::default();
            panel_story(view, FriendsTab::All, RequestsTab::Received, cx)
        }),
        Story::new("friends-empty", |_, _, cx| {
            let view = FriendsView {
                state: LoadState::Ready,
                ..FriendsView::default()
            };
            panel_story(view, FriendsTab::All, RequestsTab::Received, cx)
        }),
        Story::new("friends-failed", |_, _, cx| {
            let view = FriendsView {
                state: failed(),
                ..FriendsView::default()
            };
            panel_story(view, FriendsTab::All, RequestsTab::Received, cx)
        }),
        Story::new("friends-all", |_, _, cx| {
            panel_story(sample_friends(), FriendsTab::All, RequestsTab::Received, cx)
        }),
        Story::new("friends-pending-received", |_, _, cx| {
            panel_story(
                sample_friends(),
                FriendsTab::Pending,
                RequestsTab::Received,
                cx,
            )
        }),
        Story::new("friends-pending-sent", |_, _, cx| {
            panel_story(sample_friends(), FriendsTab::Pending, RequestsTab::Sent, cx)
        }),
        Story::new("friends-pending-empty", |_, _, cx| {
            let view = FriendsView {
                incoming: Vec::new(),
                outgoing: Vec::new(),
                ..sample_friends()
            };
            panel_story(view, FriendsTab::Pending, RequestsTab::Received, cx)
        }),
        Story::new("friends-long", |_, _, cx| {
            panel_story(long_view(), FriendsTab::All, RequestsTab::Received, cx)
        }),
        Story::new("friends-long-pending", |_, _, cx| {
            panel_story(long_view(), FriendsTab::Pending, RequestsTab::Received, cx)
        }),
        Story::new("friends-add-empty", |_, window, cx| {
            add_story("", Found::Idle, Vec::new(), AddOutcome::Idle, window, cx)
        }),
        Story::new("friends-add-results", |_, window, cx| {
            let found = Found::Ready(vec![
                ava(),
                dev(),
                finn(),
                emma(),
                person("gus", "gus", None),
            ]);
            add_story(
                "a",
                found,
                vec![person("gus", "gus", None)],
                AddOutcome::Idle,
                window,
                cx,
            )
        }),
        Story::new("friends-add-sending", |_, window, cx| {
            let gus = person("gus", "gus", None);
            add_story(
                "gus",
                Found::Ready(vec![gus.clone()]),
                vec![gus],
                AddOutcome::Sending,
                window,
                cx,
            )
        }),
        Story::new("friends-add-sent", |_, window, cx| {
            add_story("", Found::Idle, Vec::new(), AddOutcome::Sent, window, cx)
        }),
        Story::new("friends-add-failed", |_, window, cx| {
            let error = ErrorView {
                code: "CONFLICT".into(),
                message: "Friend request already sent".into(),
                retryable: false,
                retry_after_ms: None,
            };
            let hana = person("hana", "hana", Some("Hana Sato"));
            add_story(
                "hana",
                Found::Ready(vec![hana.clone()]),
                vec![hana],
                AddOutcome::Failed(error),
                window,
                cx,
            )
        }),
        Story::new("friends-add-long", |_, window, cx| {
            let stranger = person(
                "longer",
                "a_stranger_with_an_extremely_long_username_indeed",
                Some("Bartholomew Maximilian Featherstonehaugh-Wolfeschlegelsteinhausen III"),
            );
            add_story(
                "bart",
                Found::Ready(vec![stranger.clone(), long_user()]),
                vec![stranger],
                AddOutcome::Idle,
                window,
                cx,
            )
        }),
    ]
}
