//! The home stories: each section's states, all caught up, the next step for a user in no
//! communities, the phone's gate, and the create community dialog.

use super::{
    CreateCommunityForm, HomeData, HomeMention, HomeScreen, HomeVoiceChannel, Section,
    ZeroCommunityGate,
};
use crate::dms::stories::{ava, ben, cleo, dev, dialog_framed, emma, finn, long_user};
use crate::stories::Story;
use gpui_kit::*;
use semaphore_core::model::{DmPreview, DmRow, ErrorView, UserView};

fn error() -> ErrorView {
    ErrorView {
        code: "NETWORK".into(),
        message: "network unreachable".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn mention(community: &str, channel: &str, count: u32) -> HomeMention {
    HomeMention {
        community_id: format!("c-{community}"),
        community_name: community.into(),
        channel_id: format!("ch-{channel}"),
        channel_name: channel.into(),
        mention_count: count,
    }
}

fn dm(id: &str, members: Vec<UserView>, text: Option<&str>, unread: u32) -> DmRow {
    DmRow {
        id: id.into(),
        name: None,
        is_group: members.len() > 1,
        last_message: text.map(|text| DmPreview {
            author_id: members.first().map(|u| u.id.clone()).unwrap_or_default(),
            text: text.into(),
            sent_at_ms: 0,
        }),
        members,
        unread,
        mentions: 0,
        online: false,
    }
}

fn voice(community: &str, channel: &str, users: Vec<UserView>) -> HomeVoiceChannel {
    HomeVoiceChannel {
        community_id: format!("c-{community}"),
        community_name: community.into(),
        channel_id: format!("vc-{channel}"),
        channel_name: channel.into(),
        users,
    }
}

pub(crate) fn full() -> HomeData {
    HomeData {
        communities: Section::Ready(vec!["c-1".into(), "c-2".into()]),
        mentions: Section::Ready(vec![
            mention("Ladle Lab", "help-desk", 2),
            mention("Synth Club", "patches", 1),
        ]),
        unread_dms: Section::Ready(vec![
            dm("dm-ava", vec![ava()], Some("Are you joining tonight?"), 3),
            dm(
                "dm-group",
                vec![ben(), cleo(), dev()],
                Some("Ben: pushed the fix"),
                12,
            ),
        ]),
        voice: Section::Ready(vec![voice(
            "Ladle Lab",
            "Squad Up",
            vec![ava(), ben(), cleo(), dev(), emma(), finn()],
        )]),
    }
}

fn long() -> HomeData {
    let communities = [
        "A Community With An Extremely Long Name That Goes On",
        "Ladle Lab",
        "Synth Club",
    ];
    HomeData {
        communities: Section::Ready(vec!["c-1".into()]),
        mentions: Section::Ready(
            (0..9)
                .map(|index| {
                    mention(
                        communities[index % 3],
                        &format!("a-channel-name-that-is-rather-long-{index}"),
                        if index == 0 { 120 } else { index as u32 + 1 },
                    )
                })
                .collect(),
        ),
        unread_dms: Section::Ready(
            (0..8)
                .map(|index| {
                    dm(
                        &format!("dm-{index}"),
                        if index % 2 == 0 {
                            vec![long_user()]
                        } else {
                            vec![ava(), long_user(), ben()]
                        },
                        Some(
                            "A message preview that is long enough to need cutting off at the edge of the row",
                        ),
                        index as u32 * 7 + 1,
                    )
                })
                .collect(),
        ),
        voice: Section::Ready(vec![
            voice(communities[0], "A Voice Channel With A Long Name", vec![long_user()]),
            voice("Synth Club", "Jam", vec![ava(), ben()]),
        ]),
    }
}

fn home(data: HomeData, can_create: bool, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut home = HomeScreen::new(cx);
        home.set_data(data, cx);
        home.set_can_create_community(can_create, cx);
        home
    })
    .into()
}

fn gate(can_create: bool, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut gate = ZeroCommunityGate::new(cx);
        gate.set_can_create_community(can_create, cx);
        gate
    })
    .into()
}

fn create(
    window: &mut Window,
    cx: &mut App,
    setup: impl FnOnce(&mut CreateCommunityForm, &mut Window, &mut Context<CreateCommunityForm>),
) -> AnyView {
    let form = cx.new(|cx| {
        let mut form = CreateCommunityForm::new(window, cx);
        setup(&mut form, window, cx);
        form
    });
    dialog_framed(form.into(), cx)
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("home-loading", |_, _, cx| {
            home(HomeData::default(), true, cx)
        }),
        Story::new("home-communities-failed", |_, _, cx| {
            home(
                HomeData {
                    communities: Section::Failed(error()),
                    ..HomeData::default()
                },
                true,
                cx,
            )
        }),
        Story::new("home-sections", |_, _, cx| home(full(), true, cx)),
        Story::new("home-sections-loading", |_, _, cx| {
            home(
                HomeData {
                    communities: Section::Ready(vec!["c-1".into()]),
                    ..HomeData::default()
                },
                true,
                cx,
            )
        }),
        Story::new("home-sections-failed", |_, _, cx| {
            home(
                HomeData {
                    mentions: Section::Failed(error()),
                    unread_dms: Section::Failed(error()),
                    voice: Section::Failed(error()),
                    ..full()
                },
                true,
                cx,
            )
        }),
        Story::new("home-mentions-only", |_, _, cx| {
            home(
                HomeData {
                    unread_dms: Section::Ready(Vec::new()),
                    voice: Section::Ready(Vec::new()),
                    ..full()
                },
                true,
                cx,
            )
        }),
        Story::new("home-caught-up", |_, _, cx| {
            home(
                HomeData {
                    communities: Section::Ready(vec!["c-1".into()]),
                    mentions: Section::Ready(Vec::new()),
                    unread_dms: Section::Ready(Vec::new()),
                    voice: Section::Ready(Vec::new()),
                },
                true,
                cx,
            )
        }),
        Story::new("home-long", |_, _, cx| home(long(), true, cx)),
        Story::new("home-zero-can-create", |_, _, cx| {
            home(
                HomeData {
                    communities: Section::Ready(Vec::new()),
                    unread_dms: Section::Ready(Vec::new()),
                    ..HomeData::default()
                },
                true,
                cx,
            )
        }),
        Story::new("home-zero-cannot-create", |_, _, cx| {
            home(
                HomeData {
                    communities: Section::Ready(Vec::new()),
                    ..full()
                },
                false,
                cx,
            )
        }),
        Story::new("home-gate-can-create", |_, _, cx| gate(true, cx)),
        Story::new("home-gate-cannot-create", |_, _, cx| gate(false, cx)),
        Story::new("home-create-community", |_, window, cx| {
            create(window, cx, |_, _, _| {})
        }),
        Story::new("home-create-community-filled", |_, window, cx| {
            create(window, cx, |form, window, cx| {
                form.preset("Synth Club", "Patches, gear and Friday jams", window, cx)
            })
        }),
        Story::new("home-create-community-errors", |_, window, cx| {
            create(window, cx, |form, window, cx| {
                form.preset("S", &"Far too long. ".repeat(40), window, cx);
                form.tried = true;
            })
        }),
        Story::new("home-create-community-busy", |_, window, cx| {
            create(window, cx, |form, window, cx| {
                form.preset("Synth Club", "", window, cx);
                form.set_busy(true, cx);
            })
        }),
        Story::new("home-create-community-failed", |_, window, cx| {
            create(window, cx, |form, window, cx| {
                form.preset("Synth Club", "", window, cx);
                form.set_error(Some("A community with this name already exists".into()), cx);
            })
        }),
    ]
}
