//! The create community rules, then Home, the gate and the create dialog in a window.

use super::*;
use crate::dms::rig::rig;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{DmRow, NewCommunity};

fn error() -> ErrorView {
    ErrorView {
        code: "NETWORK".into(),
        message: "down".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn data() -> HomeData {
    HomeData {
        communities: Section::Ready(vec!["c-1".into()]),
        mentions: Section::Ready(vec![HomeMention {
            community_id: "c-1".into(),
            community_name: "Lab".into(),
            channel_id: "ch-1".into(),
            channel_name: "general".into(),
            mention_count: 2,
        }]),
        unread_dms: Section::Ready(vec![DmRow {
            id: "dm-1".into(),
            unread: 3,
            ..DmRow::default()
        }]),
        voice: Section::Ready(vec![HomeVoiceChannel {
            community_id: "c-1".into(),
            community_name: "Lab".into(),
            channel_id: "vc-1".into(),
            channel_name: "Hangout".into(),
            users: Vec::new(),
        }]),
    }
}

fn home(
    cx: &mut TestAppContext,
    width: f32,
    data: HomeData,
    can_create: bool,
) -> crate::dms::rig::Rig<HomeScreen, HomeEvent> {
    home_with(cx, width, data, can_create, InviteCardModel::default())
}

fn home_with(
    cx: &mut TestAppContext,
    width: f32,
    data: HomeData,
    can_create: bool,
    invite: InviteCardModel,
) -> crate::dms::rig::Rig<HomeScreen, HomeEvent> {
    rig(cx, width, move |_, cx| {
        let mut home = HomeScreen::new(cx);
        home.set_data(data, cx);
        home.set_can_create_community(can_create, cx);
        home.set_invite(invite, cx);
        home
    })
}

fn invitable() -> InviteCardModel {
    InviteCardModel {
        visible: true,
        can_manage: true,
        loading: false,
        communities: vec![
            InviteCommunity {
                id: "c-1".into(),
                name: "Lab".into(),
            },
            InviteCommunity {
                id: "c-2".into(),
                name: "Synth Club".into(),
            },
        ],
        creating: false,
        code: None,
        notice: None,
    }
}

#[test]
fn community_names_and_descriptions_have_the_servers_limits() {
    assert!(validate_community("Synth Club", "").is_empty());
    assert_eq!(
        validate_community("  ", ""),
        [(
            CommunityField::Name,
            "Community name is required".to_owned()
        )]
    );
    assert_eq!(validate_community(" a ", "")[0].0, CommunityField::Name);
    assert!(validate_community(&"a".repeat(100), &"d".repeat(500)).is_empty());
    let errors = validate_community(&"a".repeat(101), &"d".repeat(501));
    let fields: Vec<_> = errors.iter().map(|(field, _)| *field).collect();
    assert_eq!(fields, [CommunityField::Name, CommunityField::Description]);
}

#[test]
fn the_gate_applies_only_to_no_communities_once_read() {
    assert!(ZeroCommunityGate::applies(&Section::Ready(Vec::new())));
    assert!(!ZeroCommunityGate::applies(&Section::Loading));
    assert!(!ZeroCommunityGate::applies(&Section::Failed(error())));
    assert!(!ZeroCommunityGate::applies(&Section::Ready(vec![
        "c".into()
    ])));
}

#[gpui_kit::test]
fn each_row_opens_what_it_shows(cx: &mut TestAppContext) {
    let rig = home(cx, 1280., data(), true);
    rig.click(cx, "home-mention-ch-1");
    rig.click(cx, "home-dm-dm-1");
    rig.click(cx, "home-voice-vc-1");
    rig.click(cx, "home-open-notifications");
    rig.click(cx, "home-open-dms");
    assert_eq!(
        rig.events(),
        [
            HomeEvent::OpenChannel {
                community_id: "c-1".into(),
                channel_id: "ch-1".into()
            },
            HomeEvent::OpenDm {
                group_id: "dm-1".into()
            },
            HomeEvent::OpenChannel {
                community_id: "c-1".into(),
                channel_id: "vc-1".into()
            },
            HomeEvent::OpenNotifications,
            HomeEvent::OpenDms,
        ]
    );
    assert!(!rig.has(cx, "home-caught-up"));
    assert!(!rig.has(cx, "new-user-next-step"));
}

#[gpui_kit::test]
fn failed_sections_retry_their_own_part(cx: &mut TestAppContext) {
    let rig = home(
        cx,
        1280.,
        HomeData {
            mentions: Section::Failed(error()),
            unread_dms: Section::Failed(error()),
            voice: Section::Failed(error()),
            ..data()
        },
        true,
    );
    rig.click(cx, "home-mentions-retry");
    rig.click(cx, "home-dms-retry");
    rig.click(cx, "home-voice-retry");
    assert_eq!(
        rig.events(),
        [
            HomeEvent::Retry(HomeSection::Mentions),
            HomeEvent::Retry(HomeSection::UnreadDms),
            HomeEvent::Retry(HomeSection::Voice),
        ]
    );
    let failed = home(
        cx,
        390.,
        HomeData {
            communities: Section::Failed(error()),
            ..HomeData::default()
        },
        true,
    );
    failed.click(cx, "home-communities-retry");
    assert_eq!(
        failed.events(),
        [HomeEvent::Retry(HomeSection::Communities)]
    );
}

#[gpui_kit::test]
fn nothing_new_is_caught_up_and_loading_is_not(cx: &mut TestAppContext) {
    let empty = HomeData {
        communities: Section::Ready(vec!["c-1".into()]),
        mentions: Section::Ready(Vec::new()),
        unread_dms: Section::Ready(Vec::new()),
        voice: Section::Ready(Vec::new()),
    };
    let rig = home(cx, 1280., empty.clone(), true);
    assert!(rig.has(cx, "home-caught-up"));
    let loading = home(
        cx,
        1280.,
        HomeData {
            mentions: Section::Loading,
            ..empty
        },
        true,
    );
    assert!(!loading.has(cx, "home-caught-up"));
    assert!(loading.has(cx, "home-mentions-loading"));
}

#[gpui_kit::test]
fn no_communities_shows_the_next_step_by_permission(cx: &mut TestAppContext) {
    let none = HomeData {
        communities: Section::Ready(Vec::new()),
        ..data()
    };
    let can = home(cx, 1280., none.clone(), true);
    assert!(can.has(cx, "new-user-next-step"));
    assert!(!can.has(cx, "home-mentions"));
    assert!(can.has(cx, "home-unread-dms"), "DMs still show");
    can.click(cx, "home-create-community");
    assert_eq!(can.events(), [HomeEvent::CreateCommunity]);

    let cannot = home(cx, 1280., none, false);
    assert!(!cannot.has(cx, "home-create-community"));
    cannot.click(cx, "home-message-someone");
    assert_eq!(cannot.events(), [HomeEvent::OpenDms]);

    let gate = rig(cx, 390., |_, cx| {
        let mut gate = ZeroCommunityGate::new(cx);
        gate.set_can_create_community(true, cx);
        gate
    });
    gate.click(cx, "home-create-community");
    assert_eq!(gate.events(), [HomeEvent::CreateCommunity]);
}

#[gpui_kit::test]
fn the_create_form_checks_then_sends_trimmed(cx: &mut TestAppContext) {
    let rig = rig(cx, 1280., CreateCommunityForm::new);
    let preset = |name: &'static str, description: &'static str, cx: &mut TestAppContext| {
        rig.with(cx, move |form, window, cx| {
            form.update(cx, |form, cx| form.preset(name, description, window, cx))
        })
    };
    preset("S", "", cx);
    rig.click(cx, "create-community-submit");
    assert!(rig.events().is_empty(), "too short");
    preset("  Synth Club ", "  ", cx);
    rig.click(cx, "create-community-submit");
    rig.click(cx, "create-community-cancel");
    assert_eq!(
        rig.events(),
        [
            CreateCommunityEvent::Submit(NewCommunity {
                name: "Synth Club".into(),
                description: None,
            }),
            CreateCommunityEvent::Cancel,
        ]
    );
    rig.clear();
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| form.set_busy(true, cx))
    });
    rig.click(cx, "create-community-submit");
    rig.click(cx, "create-community-cancel");
    assert!(rig.events().is_empty(), "busy waits");
    rig.with(cx, |form, _, cx| {
        form.update(cx, |form, cx| form.set_error(Some("taken".into()), cx))
    });
    assert!(rig.has(cx, "create-community-error"));
}

#[test]
fn the_quick_invite_prefers_a_community_called_default() {
    let communities = |names: &[(&str, &str)]| {
        names
            .iter()
            .map(|(id, name)| InviteCommunity {
                id: (*id).into(),
                name: (*name).into(),
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        quick_invite_targets(&communities(&[("c-1", "Lab"), ("c-2", "Default")])),
        ["c-2"]
    );
    assert_eq!(
        quick_invite_targets(&communities(&[("c-1", "Lab"), ("c-2", "Synth Club")])),
        ["c-1", "c-2"]
    );
    assert!(quick_invite_targets(&[]).is_empty());
}

#[test]
fn quick_invite_needs_a_community_and_a_quiet_card() {
    let base = invitable();
    assert!(can_quick_invite(&base));
    assert!(!can_quick_invite(&InviteCardModel {
        loading: true,
        ..base.clone()
    }));
    assert!(!can_quick_invite(&InviteCardModel {
        creating: true,
        ..base.clone()
    }));
    assert!(!can_quick_invite(&InviteCardModel {
        communities: Vec::new(),
        ..base.clone()
    }));
    assert!(!can_quick_invite(&InviteCardModel {
        visible: false,
        ..base
    }));
}

#[test]
fn the_card_promises_the_invite_it_makes() {
    assert_eq!(INVITE_USES, 10);
    assert_eq!(INVITE_DAYS, 7);
    assert!(invite_terms().contains("7-day"));
    assert!(invite_terms().contains("10 uses"));
}

#[gpui_kit::test]
fn the_invite_card_offers_its_buttons(cx: &mut TestAppContext) {
    let model = InviteCardModel {
        code: Some("aB3x9Q".into()),
        ..invitable()
    };
    let rig = home_with(cx, 1280., data(), true, model);
    assert!(rig.has(cx, "home-invite"));
    assert!(rig.has(cx, "home-invite-code"));
    rig.click(cx, "home-invite-quick");
    rig.click(cx, "home-invite-copy");
    rig.click(cx, "home-invite-manage");
    rig.click(cx, "home-invite-dismiss");
    assert_eq!(
        rig.events(),
        [
            HomeEvent::Invite(InviteEvent::QuickInvite),
            HomeEvent::Invite(InviteEvent::Copy),
            HomeEvent::Invite(InviteEvent::Manage),
            HomeEvent::Invite(InviteEvent::Dismiss),
        ]
    );

    // A phone-width card keeps every control.
    let phone = home_with(
        cx,
        390.,
        data(),
        true,
        InviteCardModel {
            code: Some("aB3x9Q".into()),
            ..invitable()
        },
    );
    for id in [
        "home-invite-quick",
        "home-invite-copy",
        "home-invite-manage",
        "home-invite-dismiss",
    ] {
        assert!(phone.has(cx, id), "{id}");
    }
}

#[gpui_kit::test]
fn a_dismissed_or_pointless_card_shows_what_it_can(cx: &mut TestAppContext) {
    let hidden = home_with(
        cx,
        1280.,
        data(),
        true,
        InviteCardModel {
            visible: false,
            ..invitable()
        },
    );
    assert!(!hidden.has(cx, "home-invite"));

    let empty = home_with(
        cx,
        1280.,
        data(),
        true,
        InviteCardModel {
            communities: Vec::new(),
            ..invitable()
        },
    );
    assert!(empty.has(cx, "home-invite-empty"));
    empty.click(cx, "home-invite-quick");
    assert!(empty.events().is_empty(), "nowhere to point the invite");

    let loading = home_with(
        cx,
        1280.,
        data(),
        true,
        InviteCardModel {
            loading: true,
            ..invitable()
        },
    );
    loading.click(cx, "home-invite-quick");
    assert!(loading.events().is_empty(), "roles are still arriving");

    let notice = home_with(
        cx,
        1280.,
        data(),
        true,
        InviteCardModel {
            code: Some("aB3x9Q".into()),
            notice: Some(InviteNotice::failed(
                "Couldn't create an invite link. Try again.",
            )),
            ..invitable()
        },
    );
    assert!(notice.has(cx, "home-invite-notice"));
}
