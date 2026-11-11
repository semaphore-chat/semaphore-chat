//! The community settings stories: the shell for each kind of member (owner, admin, moderator,
//! member) and while its permissions load or fail, then every tab in the states it can be in:
//! loading, empty, failed, long lists and names, busy, a server error, its dialogs, and with fewer
//! permissions. `rigs/shot/scripts/w5-community.steps` renders them all, on a desktop and a phone.

use super::rules::{CommunityTab, ExpiryPreset, OpAction};
use super::{
    ChannelsTab, CommunityImage, CommunitySettingsScreen, EmojiTab, InvitesTab, MembersTab,
    MentionGroupsTab, OverviewTab, PrivateChannelsTab, SoundboardTab,
};
use crate::dms::picker::Found;
use crate::dms::stories::failed;
use crate::messages::fixture::NOW_MS;
use crate::panel::PanelClock;
use crate::profile::stories::picture;
use crate::stories::{Story, StoryEnv};
use gpui_kit::*;
use semaphore_core::model::{
    AdminOp, AliasGroupRow, AliasGroupView, AliasGroupsView, ChannelKind, ChannelPreset,
    ChannelRow, CommunityCaps, CommunityPermissionsView, CommunitySettingsView, CreatedWebhook,
    CustomEmojiRow, CustomEmojiView, DisplayRole, DraftFile, ErrorView, InviteRow, InvitesView,
    LoadState, MemberList, MemberView, PrivateMemberRow, PrivateMembersView, SoundboardSound,
    SoundboardView, UploadView, UserView, WebhookRow, WebhooksView,
};
use std::collections::HashMap;

const DAY: i64 = 24 * 60 * 60 * 1000;
const COMMUNITY: &str = "community-1";
const LONG_NAME: &str = "an_extraordinarily_long_username_x";
const LONG_TITLE: &str =
    "The Extremely Long Community Name That Keeps Going Past Any Sensible Width At All";

// ---- Fixtures. ----

fn user(id: &str, username: &str, display: Option<&str>) -> UserView {
    UserView {
        id: id.into(),
        username: username.into(),
        display_name: display.map(str::to_owned),
        avatar_file_id: None,
    }
}

fn me() -> UserView {
    user("u-me", "river_owner", Some("River"))
}

fn people() -> Vec<UserView> {
    vec![
        me(),
        user("u-2", "maple_admin", Some("Maple")),
        user("u-3", "juniper", Some("Juniper Park")),
        user("u-4", "quill", None),
        user("u-5", "harbor_mod", Some("Harbor")),
        user("u-6", "sable", Some("Sable Ito")),
        user("u-7", "tamsin", None),
        user("u-8", "ozzie", Some("Oz")),
    ]
}

fn role(name: &str, position: i32) -> Option<DisplayRole> {
    Some(DisplayRole {
        name: name.into(),
        position,
    })
}

fn member_list(users: Vec<UserView>) -> MemberList {
    let roles = [
        role("Owner", 0),
        role("Community Admin", 1),
        None,
        None,
        role("Moderator", 2),
        None,
        role("Event Hosts", 3),
        None,
    ];
    MemberList {
        members: users
            .into_iter()
            .enumerate()
            .map(|(index, user)| MemberView {
                user,
                status: None,
                online: index % 3 == 0,
                display_role: roles[index % roles.len()].clone(),
            })
            .collect(),
        truncated: false,
    }
}

fn members() -> MemberList {
    member_list(people())
}

fn long_members() -> MemberList {
    let mut users = people();
    users.push(user(
        "u-long",
        LONG_NAME,
        Some("Somebody With A Display Name Far Too Long To Fit"),
    ));
    for index in 0..55 {
        users.push(user(
            &format!("u-x{index}"),
            &format!("member_{index:02}"),
            (index % 2 == 0).then_some("Fixture Member"),
        ));
    }
    let mut list = member_list(users);
    list.members[8].display_role = role("Very Long Role Name For Event Organisers", 4);
    list.truncated = true;
    list
}

fn joined() -> HashMap<String, i64> {
    people()
        .iter()
        .enumerate()
        .map(|(index, user)| (user.id.clone(), NOW_MS - (index as i64 + 1) * 37 * DAY))
        .collect()
}

fn channel(
    id: &str,
    name: &str,
    kind: ChannelKind,
    position: i32,
    private: bool,
    preset: ChannelPreset,
) -> ChannelRow {
    ChannelRow {
        id: id.into(),
        community_id: COMMUNITY.into(),
        name: name.into(),
        kind,
        is_private: private,
        position,
        unread_count: 0,
        mention_count: 0,
        voice_users: Vec::new(),
        slowmode_seconds: 0,
        permissions: None,
        preset,
    }
}

fn channels() -> Vec<ChannelRow> {
    use ChannelKind::{Text, Voice};
    use ChannelPreset::*;
    vec![
        channel("c-general", "general", Text, 0, false, Normal),
        channel("c-news", "announcements", Text, 1, false, Announcement),
        channel("c-rules", "rules", Text, 2, false, ReadOnly),
        channel("c-staff", "staff-room", Text, 3, true, ModsOnly),
        channel("c-random", "random", Text, 4, false, Normal),
        channel("c-lounge", "Lounge", Voice, 5, false, Normal),
        channel("c-studio", "Recording Studio", Voice, 6, true, Custom),
    ]
}

fn long_channels() -> Vec<ChannelRow> {
    let mut rows = channels();
    rows.push(channel(
        "c-long",
        "an-extremely-long-channel-name-for-the-weekly-community-meetup-planning-thread",
        ChannelKind::Text,
        7,
        true,
        ChannelPreset::Announcement,
    ));
    for index in 0..24 {
        rows.push(channel(
            &format!("c-x{index}"),
            &format!("project-{index:02}"),
            if index % 4 == 0 {
                ChannelKind::Voice
            } else {
                ChannelKind::Text
            },
            8 + index,
            index % 5 == 0,
            ChannelPreset::Normal,
        ));
    }
    rows
}

fn settings(op: AdminOp) -> CommunitySettingsView {
    CommunitySettingsView {
        state: LoadState::Ready,
        community_id: COMMUNITY.into(),
        name: "Northwind Makers".into(),
        description: Some("A workshop for people who build things: electronics, wood, code and everything between.".into()),
        avatar_file_id: None,
        banner_file_id: None,
        op,
    }
}

fn server_error(message: &str) -> ErrorView {
    ErrorView {
        code: "FORBIDDEN".into(),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

fn busy() -> AdminOp {
    AdminOp {
        busy: true,
        ..AdminOp::default()
    }
}

fn erred(message: &str) -> AdminOp {
    AdminOp {
        error: Some(server_error(message)),
        ..AdminOp::default()
    }
}

fn uploading(name: &str, sent: u64, size: u64) -> AdminOp {
    AdminOp {
        busy: true,
        upload: Some(UploadView {
            name: name.into(),
            size_bytes: size,
            sent_bytes: sent,
            failed: None,
        }),
        error: None,
    }
}

fn caps_owner() -> CommunityCaps {
    CommunityCaps {
        update_community: true,
        delete_community: true,
        create_channel: true,
        update_channel: true,
        delete_channel: true,
        manage_private_members: true,
        manage_channel_permissions: true,
        read_roles: true,
        create_role: true,
        update_role: true,
        delete_role: true,
        assign_roles: true,
        read_members: true,
        add_members: true,
        read_alias_groups: true,
        create_alias_group: true,
        update_alias_group: true,
        delete_alias_group: true,
        manage_alias_members: true,
        manage_emoji: true,
        read_sounds: true,
        create_sound: true,
        delete_sound: true,
        manage_webhooks: true,
        create_invite: true,
        delete_invite: true,
        ban: true,
        unban: true,
        kick: true,
        timeout: true,
        view_bans: true,
        view_moderation_log: true,
    }
}

/// The default Community Admin: everything but invites (which need an instance role too) and
/// deleting the community.
fn caps_admin() -> CommunityCaps {
    CommunityCaps {
        delete_community: false,
        create_invite: false,
        ..caps_owner()
    }
}

fn caps_moderator() -> CommunityCaps {
    CommunityCaps {
        read_members: true,
        kick: true,
        ban: true,
        unban: true,
        timeout: true,
        view_bans: true,
        view_moderation_log: true,
        read_alias_groups: true,
        read_sounds: true,
        update_channel: true,
        ..CommunityCaps::default()
    }
}

fn caps_member() -> CommunityCaps {
    CommunityCaps {
        read_alias_groups: true,
        read_sounds: true,
        ..CommunityCaps::default()
    }
}

fn permissions(caps: CommunityCaps, state: LoadState) -> CommunityPermissionsView {
    CommunityPermissionsView {
        state,
        community_id: COMMUNITY.into(),
        caps,
        is_instance_owner: false,
        best_position: Some(0),
        is_top: true,
    }
}

fn file(name: &str, mime: &str, bytes: usize) -> DraftFile {
    DraftFile {
        name: name.into(),
        mime_type: mime.into(),
        bytes: vec![0; bytes],
    }
}

fn groups(state: LoadState, rows: Vec<AliasGroupRow>, op: AdminOp) -> AliasGroupsView {
    AliasGroupsView {
        state,
        community_id: COMMUNITY.into(),
        groups: rows,
        op,
    }
}

fn group_rows() -> Vec<AliasGroupRow> {
    [
        ("designers", 4),
        ("event-hosts", 1),
        ("on_call", 0),
        ("everyone_in_the_long_running_book_club", 37),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (name, count))| AliasGroupRow {
        id: format!("g-{index}"),
        name: name.into(),
        member_count: count,
    })
    .collect()
}

fn emoji_rows(count: usize) -> Vec<CustomEmojiRow> {
    let names = [
        "party_blob",
        "shipit",
        "thinking_hard",
        "a_very_long_shortcode_for_emoji",
    ];
    (0..count)
        .map(|index| CustomEmojiRow {
            id: format!("e-{index}"),
            name: if index < names.len() {
                names[index].into()
            } else {
                format!("emoji_{index:02}")
            },
            file_id: format!("f-e-{index}"),
            created_by: (index % 2 == 0).then(me),
        })
        .collect()
}

fn emoji(state: LoadState, rows: Vec<CustomEmojiRow>, op: AdminOp) -> CustomEmojiView {
    CustomEmojiView {
        state,
        community_id: COMMUNITY.into(),
        emojis: rows,
        op,
    }
}

fn sound_rows(count: usize) -> Vec<SoundboardSound> {
    let names = [
        ("Air horn", Some("\u{1f4ef}")),
        ("Drum roll", Some("\u{1f941}")),
        ("Sad trombone", None),
        (
            "A rather long sound name for the end of meetings",
            Some("\u{1f44b}"),
        ),
    ];
    (0..count)
        .map(|index| SoundboardSound {
            id: format!("s-{index}"),
            name: if index < names.len() {
                names[index].0.into()
            } else {
                format!("Clip {index:02}")
            },
            emoji: names
                .get(index)
                .and_then(|(_, emoji)| emoji.map(str::to_owned)),
            file_id: format!("f-s-{index}"),
        })
        .collect()
}

fn sounds(state: LoadState, rows: Vec<SoundboardSound>) -> SoundboardView {
    SoundboardView {
        community_id: COMMUNITY.into(),
        state,
        sounds: rows,
        playing: None,
        error: None,
    }
}

fn webhooks(state: LoadState, count: usize, op: AdminOp) -> WebhooksView {
    WebhooksView {
        state,
        channel_id: "c-general".into(),
        webhooks: (0..count)
            .map(|index| WebhookRow {
                id: format!("w-{index}"),
                name: ["CI Bot", "Release Notes", "Calendar"][index % 3].into(),
                avatar_url: None,
                created_at_ms: NOW_MS - (index as i64 + 2) * DAY,
            })
            .collect(),
        op,
    }
}

fn invite(
    code: &str,
    uses: u32,
    max: Option<u32>,
    until: Option<i64>,
    disabled: bool,
) -> InviteRow {
    InviteRow {
        code: code.into(),
        uses,
        max_uses: max,
        valid_until_ms: until,
        disabled,
        created_at_ms: NOW_MS - 3 * DAY,
    }
}

fn invite_rows() -> Vec<InviteRow> {
    vec![
        invite("aB3x9Q", 2, Some(10), Some(NOW_MS + 5 * DAY), false),
        invite("fr33Pass", 14, None, None, false),
        invite("oldLink", 1, Some(5), Some(NOW_MS - DAY), false),
        invite("fullUp", 3, Some(3), None, false),
        invite("paused", 0, None, None, true),
    ]
}

fn invites(state: LoadState, rows: Vec<InviteRow>, op: AdminOp) -> InvitesView {
    InvitesView {
        state,
        community_id: COMMUNITY.into(),
        invites: rows,
        op,
    }
}

fn private_view(state: LoadState, users: Vec<UserView>, op: AdminOp) -> PrivateMembersView {
    PrivateMembersView {
        state,
        channel_id: "c-staff".into(),
        members: users
            .into_iter()
            .enumerate()
            .map(|(index, user)| PrivateMemberRow {
                user,
                joined_at_ms: NOW_MS - (index as i64 + 1) * 9 * DAY,
                added_by: None,
            })
            .collect(),
        op,
    }
}

// ---- Builders. ----

fn shell(
    caps: CommunityCaps,
    state: LoadState,
    tab: Option<CommunityTab>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut screen = CommunitySettingsScreen::new(COMMUNITY, window, cx);
        screen.set_settings(settings(AdminOp::default()), window, cx);
        screen.set_permissions(permissions(caps, state), cx);
        if let Some(tab) = tab {
            screen.set_tab(tab, cx);
        }
        let ids = people();
        screen.members().update(cx, |tab, cx| {
            tab.set_members(Some(members()), cx);
            tab.set_me(Some(ids[0].id.clone()), cx);
            tab.set_joined_dates(joined(), cx);
        });
        screen.channels().update(cx, |tab, cx| {
            tab.set_channels(LoadState::Ready, channels(), cx)
        });
        screen.private_channels().update(cx, |tab, cx| {
            tab.set_channels(LoadState::Ready, channels(), cx);
            tab.set_members(Some(members()), cx);
            tab.set_view(
                private_view(LoadState::Ready, people()[..3].to_vec(), AdminOp::default()),
                cx,
            );
        });
        screen.mention_groups().update(cx, |tab, cx| {
            tab.set_groups(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                cx,
            )
        });
        screen.emoji().update(cx, |tab, cx| {
            tab.set_view(
                emoji(LoadState::Ready, emoji_rows(3), AdminOp::default()),
                window,
                cx,
            )
        });
        screen.soundboard().update(cx, |tab, cx| {
            tab.set_view(sounds(LoadState::Ready, sound_rows(3)), cx)
        });
        screen.invites().update(cx, |tab, cx| {
            tab.set_clock(PanelClock::fixed(NOW_MS), cx);
            tab.set_link_base("https://chat.example.com", cx);
            tab.set_view(
                invites(LoadState::Ready, invite_rows(), AdminOp::default()),
                cx,
            );
        });
        screen
    })
    .into()
}

fn overview(
    view: CommunitySettingsView,
    caps: CommunityCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut OverviewTab, &mut Window, &mut Context<OverviewTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = OverviewTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_view(view, window, cx);
        tweak(&mut tab, window, cx);
        tab
    })
    .into()
}

fn members_tab(
    list: Option<MemberList>,
    caps: CommunityCaps,
    op: AdminOp,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut MembersTab, &mut Window, &mut Context<MembersTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = MembersTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_members(list, cx);
        tab.set_me(Some("u-me".into()), cx);
        tab.set_joined_dates(joined(), cx);
        tweak(&mut tab, window, cx);
        tab.set_op(op, cx);
        tab
    })
    .into()
}

fn channels_tab(
    state: LoadState,
    rows: Vec<ChannelRow>,
    caps: CommunityCaps,
    op: AdminOp,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut ChannelsTab, &mut Window, &mut Context<ChannelsTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = ChannelsTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_channels(state, rows, cx);
        tweak(&mut tab, window, cx);
        tab.set_op(op, cx);
        tab
    })
    .into()
}

#[allow(clippy::too_many_arguments)]
fn private_tab(
    state: LoadState,
    rows: Vec<ChannelRow>,
    view: PrivateMembersView,
    community: Option<MemberList>,
    caps: CommunityCaps,
    sent: Option<OpAction>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut tab = PrivateChannelsTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_channels(state, rows, cx);
        tab.set_members(community, cx);
        if let Some(action) = sent {
            tab.mark_sent(action);
        }
        tab.set_view(view, cx);
        tab
    })
    .into()
}

fn groups_tab(
    view: AliasGroupsView,
    caps: CommunityCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut MentionGroupsTab, &mut Window, &mut Context<MentionGroupsTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = MentionGroupsTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_members(Some(members()), cx);
        tab.set_groups(view, cx);
        tweak(&mut tab, window, cx);
        tab
    })
    .into()
}

fn emoji_tab(
    view: CustomEmojiView,
    caps: CommunityCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut EmojiTab, &mut Window, &mut Context<EmojiTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = EmojiTab::new(window, cx);
        tab.set_caps(caps, cx);
        tweak(&mut tab, window, cx);
        tab.set_view(view, window, cx);
        tab
    })
    .into()
}

fn sounds_tab(
    view: SoundboardView,
    caps: CommunityCaps,
    op: AdminOp,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut SoundboardTab, &mut Window, &mut Context<SoundboardTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = SoundboardTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_view(view, cx);
        tweak(&mut tab, window, cx);
        tab.set_op(op, cx);
        tab
    })
    .into()
}

fn invites_tab(
    view: InvitesView,
    caps: CommunityCaps,
    window: &mut Window,
    cx: &mut App,
    tweak: impl FnOnce(&mut InvitesTab, &mut Window, &mut Context<InvitesTab>),
) -> AnyView {
    cx.new(|cx| {
        let mut tab = InvitesTab::new(window, cx);
        tab.set_caps(caps, cx);
        tab.set_clock(PanelClock::fixed(NOW_MS), cx);
        tab.set_link_base("https://chat.example.com", cx);
        tweak(&mut tab, window, cx);
        tab.set_view(view, cx);
        tab
    })
    .into()
}

fn ready_settings() -> CommunitySettingsView {
    settings(AdminOp::default())
}

type Build = fn(&StoryEnv, &mut Window, &mut App) -> AnyView;

pub(crate) fn stories() -> Vec<Story> {
    let all: Vec<(&'static str, Build)> = vec![
        // ---- The shell. ----
        ("community-settings-owner", |_, w, cx| {
            shell(caps_owner(), LoadState::Ready, None, w, cx)
        }),
        ("community-settings-admin", |_, w, cx| {
            shell(
                caps_admin(),
                LoadState::Ready,
                Some(CommunityTab::Invites),
                w,
                cx,
            )
        }),
        ("community-settings-moderator", |_, w, cx| {
            shell(caps_moderator(), LoadState::Ready, None, w, cx)
        }),
        ("community-settings-member", |_, w, cx| {
            shell(caps_member(), LoadState::Ready, None, w, cx)
        }),
        ("community-settings-member-locked-tab", |_, w, cx| {
            shell(
                caps_member(),
                LoadState::Ready,
                Some(CommunityTab::Channels),
                w,
                cx,
            )
        }),
        ("community-settings-loading", |_, w, cx| {
            shell(caps_owner(), LoadState::Loading, None, w, cx)
        }),
        ("community-settings-failed", |_, w, cx| {
            shell(caps_owner(), failed(), None, w, cx)
        }),
        ("community-settings-roles-slot", |_, w, cx| {
            shell(
                caps_owner(),
                LoadState::Ready,
                Some(CommunityTab::Roles),
                w,
                cx,
            )
        }),
        ("community-settings-members-open", |_, w, cx| {
            shell(
                caps_owner(),
                LoadState::Ready,
                Some(CommunityTab::Members),
                w,
                cx,
            )
        }),
        // ---- Overview. ----
        ("community-settings-overview-loading", |_, w, cx| {
            overview(
                CommunitySettingsView::default(),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-overview-failed", |_, w, cx| {
            overview(
                CommunitySettingsView {
                    state: failed(),
                    ..CommunitySettingsView::default()
                },
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-overview", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |_, _, _| {})
        }),
        ("community-settings-overview-long", |_, w, cx| {
            let view = CommunitySettingsView {
                name: LONG_TITLE.into(),
                description: Some("word ".repeat(96)),
                ..ready_settings()
            };
            overview(view, caps_owner(), w, cx, |_, _, _| {})
        }),
        ("community-settings-overview-picked", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, _, _| {
                tab.set_preview(
                    CommunityImage::Banner,
                    file("banner.png", "image/png", 10),
                    picture(600, 200, [0x0e, 0xa5, 0xe9], [0x7c, 0x3a, 0xed]),
                );
                tab.set_preview(
                    CommunityImage::Avatar,
                    file("icon.png", "image/png", 10),
                    picture(96, 96, [0xf5, 0x9e, 0x0b], [0xdb, 0x27, 0x77]),
                );
            })
        }),
        ("community-settings-overview-uploading", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.set_preview(
                    CommunityImage::Banner,
                    file("banner.png", "image/png", 10),
                    picture(600, 200, [0x0e, 0xa5, 0xe9], [0x7c, 0x3a, 0xed]),
                );
                tab.mark_sent(OpAction::UpdateCommunity, false);
                tab.set_view(
                    settings(uploading("banner.png", 300_000, 900_000)),
                    window,
                    cx,
                );
            })
        }),
        ("community-settings-overview-error", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.preset("Northwind Makers Guild", "", window, cx);
                tab.mark_sent(OpAction::UpdateCommunity, true);
                tab.set_view(
                    settings(erred("A community with that name already exists.")),
                    window,
                    cx,
                );
            })
        }),
        ("community-settings-overview-invalid", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.preset("N", &"x".repeat(510), window, cx);
                tab.mark_sent(OpAction::UpdateCommunity, true);
                tab.set_view(ready_settings(), window, cx);
            })
        }),
        ("community-settings-overview-pick-error", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, _, cx| {
                tab.set_picked(
                    CommunityImage::Banner,
                    file("notes.pdf", "application/pdf", 10),
                    cx,
                );
                tab.set_max_file_bytes(Some(1024 * 1024), cx);
                tab.set_picked(
                    CommunityImage::Avatar,
                    file("huge.png", "image/png", 3 * 1024 * 1024),
                    cx,
                );
            })
        }),
        ("community-settings-overview-readonly", |_, w, cx| {
            overview(ready_settings(), caps_moderator(), w, cx, |_, _, _| {})
        }),
        ("community-settings-overview-delete", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.open_delete("Northwind", window, cx)
            })
        }),
        ("community-settings-overview-delete-matched", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.open_delete("Northwind Makers", window, cx)
            })
        }),
        ("community-settings-overview-delete-busy", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.open_delete("Northwind Makers", window, cx);
                tab.mark_sent(OpAction::DeleteCommunity, false);
                tab.set_view(settings(busy()), window, cx);
            })
        }),
        ("community-settings-overview-delete-error", |_, w, cx| {
            overview(ready_settings(), caps_owner(), w, cx, |tab, window, cx| {
                tab.open_delete("Northwind Makers", window, cx);
                tab.mark_sent(OpAction::DeleteCommunity, false);
                tab.set_view(
                    settings(erred("Only the community's owner can delete it.")),
                    window,
                    cx,
                );
            })
        }),
        // ---- Members. ----
        ("community-settings-members-loading", |_, w, cx| {
            members_tab(None, caps_owner(), AdminOp::default(), w, cx, |_, _, _| {})
        }),
        ("community-settings-members-empty", |_, w, cx| {
            members_tab(
                Some(member_list(vec![me()])),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-members", |_, w, cx| {
            members_tab(
                Some(members()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-members-long", |_, w, cx| {
            members_tab(
                Some(long_members()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-members-search", |_, w, cx| {
            members_tab(
                Some(member_list(people()[..3].to_vec())),
                caps_owner(),
                busy(),
                w,
                cx,
                |tab, window, cx| {
                    let found = vec![
                        user("u-9", "nova", Some("Nova Reyes")),
                        user("u-10", "nova_lights", None),
                        user("u-11", LONG_NAME, Some("Long Display Name Person")),
                    ];
                    tab.preset_search("nova", Found::Ready(found), Some("u-10"), window, cx);
                },
            )
        }),
        ("community-settings-members-search-empty", |_, w, cx| {
            members_tab(
                Some(members()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.preset_search("zzz", Found::Ready(Vec::new()), None, window, cx)
                },
            )
        }),
        ("community-settings-members-search-failed", |_, w, cx| {
            members_tab(
                Some(members()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.preset_search(
                        "nova",
                        Found::Failed("network unreachable".into()),
                        None,
                        window,
                        cx,
                    )
                },
            )
        }),
        ("community-settings-members-add-error", |_, w, cx| {
            members_tab(
                Some(members()),
                caps_owner(),
                erred("That user is banned from this community."),
                w,
                cx,
                |tab, window, cx| {
                    tab.preset_search(
                        "nova",
                        Found::Ready(vec![user("u-9", "nova", Some("Nova Reyes"))]),
                        Some("u-9"),
                        window,
                        cx,
                    )
                },
            )
        }),
        ("community-settings-members-moderator", |_, w, cx| {
            members_tab(
                Some(members()),
                caps_moderator(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        // ---- Channels. ----
        ("community-settings-channels-loading", |_, w, cx| {
            channels_tab(
                LoadState::Loading,
                Vec::new(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels-failed", |_, w, cx| {
            channels_tab(
                failed(),
                Vec::new(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels-empty", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                Vec::new(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels-long", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                long_channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels-moving", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                busy(),
                w,
                cx,
                |tab, _, _| {
                    tab.mark_sent(OpAction::MoveChannel {
                        channel_id: "c-news".into(),
                    })
                },
            )
        }),
        ("community-settings-channels-error", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                erred("You can't delete the last text channel."),
                w,
                cx,
                |tab, _, _| {
                    tab.mark_sent(OpAction::DeleteChannel {
                        channel_id: "c-general".into(),
                    })
                },
            )
        }),
        ("community-settings-channels-readonly", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_moderator(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-channels-create", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_create("design-crit", ChannelKind::Text, true, window, cx)
                },
            )
        }),
        ("community-settings-channels-create-busy", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                busy(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_create("Practice Room", ChannelKind::Voice, false, window, cx);
                    tab.mark_sent(OpAction::CreateChannel);
                },
            )
        }),
        ("community-settings-channels-create-error", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                erred("A channel with that name already exists."),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_create("general", ChannelKind::Text, false, window, cx);
                    tab.mark_sent(OpAction::CreateChannel);
                },
            )
        }),
        ("community-settings-channels-edit", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_edit("c-general", false, window, cx);
                    tab.set_webhooks(
                        webhooks(LoadState::Ready, 3, AdminOp::default()),
                        window,
                        cx,
                    );
                },
            )
        }),
        (
            "community-settings-channels-edit-webhooks-empty",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    caps_owner(),
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| {
                        tab.open_edit("c-general", false, window, cx);
                        tab.set_webhooks(
                            webhooks(LoadState::Ready, 0, AdminOp::default()),
                            window,
                            cx,
                        );
                    },
                )
            },
        ),
        (
            "community-settings-channels-edit-webhooks-loading",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    caps_owner(),
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| tab.open_edit("c-general", false, window, cx),
                )
            },
        ),
        (
            "community-settings-channels-edit-webhooks-failed",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    caps_owner(),
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| {
                        tab.open_edit("c-general", false, window, cx);
                        tab.set_webhooks(webhooks(failed(), 0, AdminOp::default()), window, cx);
                    },
                )
            },
        ),
        (
            "community-settings-channels-edit-webhook-error",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    caps_owner(),
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| {
                        tab.open_edit("c-general", false, window, cx);
                        tab.mark_sent(OpAction::CreateWebhook);
                        tab.set_webhooks(
                            webhooks(
                                LoadState::Ready,
                                1,
                                erred("This channel has too many webhooks."),
                            ),
                            window,
                            cx,
                        );
                    },
                )
            },
        ),
        (
            "community-settings-channels-edit-webhooks-locked",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    CommunityCaps {
                        manage_webhooks: false,
                        manage_channel_permissions: false,
                        ..caps_owner()
                    },
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| tab.open_edit("c-general", false, window, cx),
                )
            },
        ),
        ("community-settings-channels-edit-voice", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| tab.open_edit("c-lounge", false, window, cx),
            )
        }),
        (
            "community-settings-channels-edit-permissions",
            |_, w, cx| {
                channels_tab(
                    LoadState::Ready,
                    channels(),
                    caps_owner(),
                    AdminOp::default(),
                    w,
                    cx,
                    |tab, window, cx| tab.open_edit("c-staff", true, window, cx),
                )
            },
        ),
        ("community-settings-channels-webhook-created", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_edit("c-general", false, window, cx);
                    tab.set_webhooks(
                        webhooks(LoadState::Ready, 1, AdminOp::default()),
                        window,
                        cx,
                    );
                    tab.set_created_webhook(CreatedWebhook {
                id: "w-new".into(),
                url: "https://chat.example.com/api/webhooks/0d7c2f1e-5b8a-4c3e-9f21-7e0a9b6d4c13/3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e".into(),
            }, cx);
                },
            )
        }),
        ("community-settings-channels-delete", |_, w, cx| {
            channels_tab(
                LoadState::Ready,
                channels(),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, _, _| tab.open_delete("c-random"),
            )
        }),
        // ---- Private channels. ----
        ("community-settings-private-none", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels().into_iter().filter(|c| !c.is_private).collect(),
                PrivateMembersView::default(),
                Some(members()),
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private-loading", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                PrivateMembersView::default(),
                None,
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private-failed", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                private_view(failed(), Vec::new(), AdminOp::default()),
                Some(members()),
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                private_view(LoadState::Ready, people()[..3].to_vec(), AdminOp::default()),
                Some(members()),
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private-empty", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                private_view(LoadState::Ready, Vec::new(), AdminOp::default()),
                Some(members()),
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private-long", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                long_channels(),
                private_view(
                    LoadState::Ready,
                    long_members()
                        .members
                        .into_iter()
                        .take(30)
                        .map(|m| m.user)
                        .collect(),
                    AdminOp::default(),
                ),
                Some(long_members()),
                caps_owner(),
                None,
                w,
                cx,
            )
        }),
        ("community-settings-private-busy", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                private_view(LoadState::Ready, people()[..3].to_vec(), busy()),
                Some(members()),
                caps_owner(),
                Some(OpAction::AddPrivateMember {
                    user_id: "u-5".into(),
                }),
                w,
                cx,
            )
        }),
        ("community-settings-private-error", |_, w, cx| {
            private_tab(
                LoadState::Ready,
                channels(),
                private_view(
                    LoadState::Ready,
                    people()[..3].to_vec(),
                    erred("That user isn't a member of this community."),
                ),
                Some(members()),
                caps_owner(),
                Some(OpAction::AddPrivateMember {
                    user_id: "u-5".into(),
                }),
                w,
                cx,
            )
        }),
        // ---- Mention groups. ----
        ("community-settings-groups-loading", |_, w, cx| {
            groups_tab(
                groups(LoadState::Loading, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups-failed", |_, w, cx| {
            groups_tab(
                groups(failed(), Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups-empty", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups-long", |_, w, cx| {
            let mut rows = group_rows();
            rows.extend((0..30).map(|index| AliasGroupRow {
                id: format!("g-x{index}"),
                name: format!("team-{index:02}"),
                member_count: index,
            }));
            groups_tab(
                groups(LoadState::Ready, rows, AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups-readonly", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_member(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-groups-editor-new", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| tab.open_editor(None, "", "", window, cx),
            )
        }),
        ("community-settings-groups-editor-edit", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_editor(Some("g-0"), "", "", window, cx);
                    tab.set_group(
                        AliasGroupView {
                            state: LoadState::Ready,
                            group_id: "g-0".into(),
                            name: "designers".into(),
                            members: people()[1..5].to_vec(),
                            op: AdminOp::default(),
                        },
                        window,
                        cx,
                    );
                },
            )
        }),
        ("community-settings-groups-editor-loading", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| tab.open_editor(Some("g-0"), "", "", window, cx),
            )
        }),
        ("community-settings-groups-editor-no-match", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_editor(None, "night-owls", "nobody-by-this-name", window, cx)
                },
            )
        }),
        ("community-settings-groups-editor-invalid", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_editor(None, "night owls!", "", window, cx);
                    tab.mark_sent(OpAction::CreateGroup, true);
                    tab.set_groups(
                        groups(LoadState::Ready, group_rows(), AdminOp::default()),
                        cx,
                    );
                },
            )
        }),
        ("community-settings-groups-editor-error", |_, w, cx| {
            groups_tab(
                groups(LoadState::Ready, group_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_editor(None, "designers", "", window, cx);
                    tab.mark_sent(OpAction::CreateGroup, true);
                    tab.set_groups(
                        groups(
                            LoadState::Ready,
                            group_rows(),
                            erred("A mention group named designers already exists."),
                        ),
                        cx,
                    );
                },
            )
        }),
        // ---- Custom emoji. ----
        ("community-settings-emoji-loading", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Loading, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-emoji-failed", |_, w, cx| {
            emoji_tab(
                emoji(failed(), Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-emoji-empty", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Ready, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-emoji", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Ready, emoji_rows(4), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-emoji-long", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Ready, emoji_rows(40), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-emoji-uploading", |_, w, cx| {
            emoji_tab(
                emoji(
                    LoadState::Ready,
                    emoji_rows(3),
                    uploading("party.gif", 120_000, 200_000),
                ),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.preset(
                        "party",
                        Some(file("party.gif", "image/gif", 200_000)),
                        window,
                        cx,
                    );
                    tab.mark_sent(OpAction::AddEmoji);
                },
            )
        }),
        ("community-settings-emoji-error", |_, w, cx| {
            emoji_tab(
                emoji(
                    LoadState::Ready,
                    emoji_rows(3),
                    erred("An emoji named :shipit: already exists."),
                ),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.preset(
                        "shipit",
                        Some(file("shipit.png", "image/png", 9_000)),
                        window,
                        cx,
                    );
                    tab.mark_sent(OpAction::AddEmoji);
                },
            )
        }),
        ("community-settings-emoji-pick-error", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Ready, emoji_rows(3), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, _, cx| tab.set_picked(file("photo.jpg", "image/jpeg", 300_000), cx),
            )
        }),
        ("community-settings-emoji-locked", |_, w, cx| {
            emoji_tab(
                emoji(LoadState::Ready, emoji_rows(3), AdminOp::default()),
                caps_moderator(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        // ---- Soundboard. ----
        ("community-settings-sounds-loading", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Loading, Vec::new()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds-failed", |_, w, cx| {
            sounds_tab(
                sounds(failed(), Vec::new()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds-empty", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, Vec::new()),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds-long", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(40)),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds-readonly", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_member(),
                AdminOp::default(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-sounds-delete-error", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                erred("That sound is in use."),
                w,
                cx,
                |tab, _, _| {
                    tab.mark_sent(OpAction::DeleteSound {
                        sound_id: "s-1".into(),
                    })
                },
            )
        }),
        ("community-settings-sounds-add", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_add(
                        "Applause",
                        "\u{1f44f}",
                        Some(file("applause.mp3", "audio/mpeg", 400_000)),
                        false,
                        window,
                        cx,
                    )
                },
            )
        }),
        ("community-settings-sounds-add-invalid", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                AdminOp::default(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_add("Applause!!", &"\u{1f44f}".repeat(9), None, true, window, cx);
                    tab.set_picked(
                        file("concert.wav", "audio/wav", 4 * 1024 * 1024),
                        window,
                        cx,
                    );
                },
            )
        }),
        ("community-settings-sounds-add-busy", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                uploading("applause.mp3", 250_000, 400_000),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_add(
                        "Applause",
                        "",
                        Some(file("applause.mp3", "audio/mpeg", 400_000)),
                        false,
                        window,
                        cx,
                    );
                    tab.mark_sent(OpAction::AddSound);
                },
            )
        }),
        ("community-settings-sounds-add-error", |_, w, cx| {
            sounds_tab(
                sounds(LoadState::Ready, sound_rows(4)),
                caps_owner(),
                erred("This community already has the most sounds it can."),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_add(
                        "Applause",
                        "",
                        Some(file("applause.mp3", "audio/mpeg", 400_000)),
                        false,
                        window,
                        cx,
                    );
                    tab.mark_sent(OpAction::AddSound);
                },
            )
        }),
        // ---- Invites. ----
        ("community-settings-invites-loading", |_, w, cx| {
            invites_tab(
                invites(LoadState::Loading, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-invites-failed", |_, w, cx| {
            invites_tab(
                invites(failed(), Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-invites-empty", |_, w, cx| {
            invites_tab(
                invites(LoadState::Ready, Vec::new(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-invites", |_, w, cx| {
            invites_tab(
                invites(LoadState::Ready, invite_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, _, _| tab.mark_copied("fr33Pass"),
            )
        }),
        ("community-settings-invites-long", |_, w, cx| {
            let mut rows = invite_rows();
            rows.extend((0..30).map(|index| {
                invite(
                    &format!("code{index:02}xYz{}", "Q".repeat(index % 12)),
                    index as u32,
                    Some(50),
                    Some(NOW_MS + index as i64 * DAY),
                    false,
                )
            }));
            invites_tab(
                invites(LoadState::Ready, rows, AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-invites-admin", |_, w, cx| {
            invites_tab(
                invites(LoadState::Ready, invite_rows(), AdminOp::default()),
                caps_admin(),
                w,
                cx,
                |_, _, _| {},
            )
        }),
        ("community-settings-invites-create", |_, w, cx| {
            invites_tab(
                invites(LoadState::Ready, invite_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| tab.open_create("25", ExpiryPreset::Week, false, window, cx),
            )
        }),
        ("community-settings-invites-create-invalid", |_, w, cx| {
            invites_tab(
                invites(LoadState::Ready, invite_rows(), AdminOp::default()),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| tab.open_create("0", ExpiryPreset::Never, true, window, cx),
            )
        }),
        ("community-settings-invites-create-error", |_, w, cx| {
            invites_tab(
                invites(
                    LoadState::Ready,
                    invite_rows(),
                    erred("You need an instance role to create invites."),
                ),
                caps_owner(),
                w,
                cx,
                |tab, window, cx| {
                    tab.open_create("", ExpiryPreset::Day, true, window, cx);
                    tab.mark_sent(OpAction::CreateInvite);
                },
            )
        }),
        ("community-settings-invites-delete-error", |_, w, cx| {
            invites_tab(
                invites(
                    LoadState::Ready,
                    invite_rows(),
                    erred("Only the invite's creator can delete it."),
                ),
                caps_owner(),
                w,
                cx,
                |tab, _, _| {
                    tab.mark_sent(OpAction::DeleteInvite {
                        code: "aB3x9Q".into(),
                    })
                },
            )
        }),
    ];
    all.into_iter()
        .map(|(name, build)| Story::new(name, build))
        .collect()
}
