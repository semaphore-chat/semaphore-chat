//! The notification stories: the centre where the shell's side panel puts it, the level menu
//! open in a stand-in header and in the real shell's channel header, and the settings section.

use super::{ChannelNotifyMenu, NotificationCenter, NotificationSettingsSection};
use crate::dms::stories::{DAY, HOUR, MINUTE, ava, ben, cleo, dev, emma, failed, long_user};
use crate::kit::{Variant, text};
use crate::messages::fixture::NOW_MS;
use crate::panel::PanelClock;
use crate::panel::stories::framed;
use crate::shell::PHONE;
use crate::shell::stories_impl::{Options, shell_view};
use crate::stories::{Story, StoryEnv};
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ChannelNotifyLevelView, Conversation, LoadState, MessageLink, NotificationKind,
    NotificationList, NotificationRow, NotificationSettings, NotificationSettingsView, NotifyLevel,
    UserView,
};

fn note(
    id: &str,
    kind: NotificationKind,
    author: UserView,
    channel: Option<&str>,
    preview: &str,
    ago: i64,
    read: bool,
) -> NotificationRow {
    let conversation = match (kind, channel) {
        (NotificationKind::DirectMessage, _) | (_, None) => Conversation::DirectMessage {
            id: format!("dm-{}", author.id),
        },
        (_, Some(name)) => Conversation::Channel {
            id: format!("ch-{name}"),
        },
    };
    NotificationRow {
        id: id.into(),
        kind,
        author,
        link: MessageLink {
            community_id: channel.map(|_| "nightowl".to_owned()),
            conversation,
            message_id: Some(format!("m-{id}")),
        },
        parent_message_id: (kind == NotificationKind::ThreadReply).then(|| "parent-1".to_owned()),
        channel_name: channel.map(str::to_owned),
        preview: preview.into(),
        created_at_ms: NOW_MS - ago,
        read,
    }
}

fn mixed() -> Vec<NotificationRow> {
    vec![
        note(
            "n1",
            NotificationKind::Mention,
            ava(),
            Some("general"),
            "@mike can you look at the deploy before lunch?",
            2 * MINUTE,
            false,
        ),
        note(
            "n2",
            NotificationKind::DirectMessage,
            ben(),
            None,
            "Are we still on for Thursday?",
            20 * MINUTE,
            false,
        ),
        note(
            "n3",
            NotificationKind::ThreadReply,
            cleo(),
            Some("help-desk"),
            "That fixed it, thanks!",
            3 * HOUR,
            true,
        ),
        note(
            "n4",
            NotificationKind::ChannelMessage,
            dev(),
            Some("announcements"),
            "Release 0.9 is out. Notes are in the wiki.",
            DAY + HOUR,
            true,
        ),
        note(
            "n5",
            NotificationKind::DirectMessage,
            emma(),
            None,
            "",
            3 * DAY,
            false,
        ),
    ]
}

fn long() -> Vec<NotificationRow> {
    let mut rows = vec![
        note(
            "l1",
            NotificationKind::Mention,
            long_user(),
            Some("a-channel-name-that-keeps-on-going-long-past-the-right-edge"),
            "A mention long enough that the preview has to stop at the end of its line with an \
             ellipsis instead of wrapping, however wide the panel happens to be today",
            MINUTE,
            false,
        ),
        note(
            "l2",
            NotificationKind::ThreadReply,
            long_user(),
            Some("general"),
            "Line one\n\nLine two, joined onto one line",
            HOUR,
            true,
        ),
    ];
    rows.extend((0..14).map(|index| {
        note(
            &format!("lx{index}"),
            if index % 2 == 0 {
                NotificationKind::Mention
            } else {
                NotificationKind::DirectMessage
            },
            ava(),
            Some("general"),
            "Filler so the list scrolls",
            (index + 2) * HOUR,
            index % 3 == 0,
        )
    }));
    rows
}

fn center_story(list: NotificationList, loading_more: bool, cx: &mut App) -> AnyView {
    let center = cx.new(|cx| {
        let mut center = NotificationCenter::new(cx);
        center.set_clock(PanelClock::fixed(NOW_MS), cx);
        center.set_list(list, loading_more, cx);
        center
    });
    framed(center.into(), cx)
}

fn ready(rows: Vec<NotificationRow>, has_more: bool) -> NotificationList {
    let unread_count = rows.iter().filter(|row| !row.read).count() as u32;
    NotificationList {
        state: LoadState::Ready,
        rows,
        unread_count,
        has_more,
    }
}

/// A stand-in channel header with the menu at its end, as the shell draws it.
struct HeaderFrame {
    menu: Entity<ChannelNotifyMenu>,
}

impl Render for HeaderFrame {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(sem.background_default)
            .child(
                div()
                    .h(px(56.))
                    .px(px(16.))
                    .flex()
                    .items_center()
                    .justify_between()
                    .bg(sem.paper)
                    .border_b_1()
                    .border_color(sem.divider)
                    .child(text(Variant::H6, "# general").text_color(sem.text_primary))
                    .child(self.menu.clone()),
            )
    }
}

fn menu(
    level: Option<NotifyLevel>,
    state: LoadState,
    open: bool,
    cx: &mut App,
) -> Entity<ChannelNotifyMenu> {
    cx.new(|cx| {
        let mut menu = ChannelNotifyMenu::new(cx);
        menu.set_view(
            ChannelNotifyLevelView {
                state,
                level,
                effective: level.unwrap_or(NotifyLevel::Mentions),
            },
            cx,
        );
        menu.set_channel_name(Some("general".into()), cx);
        menu.set_default(NotifyLevel::Mentions, cx);
        menu.open = open;
        menu
    })
}

fn menu_story(level: Option<NotifyLevel>, state: LoadState, open: bool, cx: &mut App) -> AnyView {
    let menu = menu(level, state, open, cx);
    cx.new(|_| HeaderFrame { menu }).into()
}

fn menu_in_shell(env: &StoryEnv, cx: &mut App) -> AnyView {
    let menu = menu(Some(NotifyLevel::All), LoadState::Ready, true, cx);
    shell_view(
        env,
        Options {
            accessory: Some(menu.into()),
            phone_content: true,
            ..Options::default()
        },
        cx,
    )
}

/// The section at a settings page's width, or filling a phone.
struct SettingsFrame {
    section: Entity<NotificationSettingsSection>,
}

impl Render for SettingsFrame {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem();
        let phone = f32::from(window.viewport_size().width) < PHONE;
        div()
            .size_full()
            .flex()
            .justify_center()
            .bg(sem.background_default)
            .when(!phone, |frame| frame.p(px(24.)))
            .child(
                div()
                    .w_full()
                    .max_w(px(720.))
                    .h_full()
                    .rounded(px(if phone { 0. } else { 8. }))
                    .overflow_hidden()
                    .border_1()
                    .border_color(sem.divider)
                    .child(self.section.clone()),
            )
    }
}

fn settings_story(
    state: LoadState,
    settings: NotificationSettings,
    edit: fn(
        &mut NotificationSettingsSection,
        &mut Window,
        &mut Context<NotificationSettingsSection>,
    ),
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    let section = cx.new(|cx| {
        let mut section = NotificationSettingsSection::new(window, cx);
        section.set_local_timezone(Some("Europe/Berlin".into()), cx);
        section.set_view(NotificationSettingsView { state, settings }, window, cx);
        edit(&mut section, window, cx);
        section
    });
    cx.new(|_| SettingsFrame { section }).into()
}

fn schedule() -> NotificationSettings {
    NotificationSettings {
        dnd: true,
        dnd_start: Some("22:00".into()),
        dnd_end: Some("07:30".into()),
        dnd_timezone: Some("Europe/Berlin".into()),
        default_level: NotifyLevel::All,
        ..NotificationSettings::default()
    }
}

pub fn stories() -> Vec<Story> {
    vec![
        Story::new("notifications-loading", |_, _, cx| {
            center_story(NotificationList::default(), false, cx)
        }),
        Story::new("notifications-empty", |_, _, cx| {
            center_story(ready(Vec::new(), false), false, cx)
        }),
        Story::new("notifications-failed", |_, _, cx| {
            let list = NotificationList {
                state: failed(),
                ..NotificationList::default()
            };
            center_story(list, false, cx)
        }),
        Story::new("notifications-unread-mix", |_, _, cx| {
            center_story(ready(mixed(), false), false, cx)
        }),
        Story::new("notifications-all-read", |_, _, cx| {
            let rows = mixed()
                .into_iter()
                .map(|row| NotificationRow { read: true, ..row })
                .collect();
            center_story(ready(rows, false), false, cx)
        }),
        Story::new("notifications-long", |_, _, cx| {
            center_story(ready(long(), true), false, cx)
        }),
        Story::new("notifications-has-more", |_, _, cx| {
            center_story(ready(mixed(), true), false, cx)
        }),
        Story::new("notifications-loading-more", |_, _, cx| {
            center_story(ready(mixed(), true), true, cx)
        }),
        Story::new("notifications-menu-default", |_, _, cx| {
            menu_story(None, LoadState::Ready, true, cx)
        }),
        Story::new("notifications-menu-override", |_, _, cx| {
            menu_story(Some(NotifyLevel::Muted), LoadState::Ready, true, cx)
        }),
        Story::new("notifications-menu-closed", |_, _, cx| {
            menu_story(Some(NotifyLevel::All), LoadState::Ready, false, cx)
        }),
        Story::new("notifications-menu-loading", |_, _, cx| {
            menu_story(None, LoadState::Loading, false, cx)
        }),
        Story::new("notifications-menu-in-shell", |env, _, cx| {
            menu_in_shell(env, cx)
        }),
        Story::new("notifications-settings-loading", |_, window, cx| {
            settings_story(
                LoadState::Loading,
                NotificationSettings::default(),
                |_, _, _| {},
                window,
                cx,
            )
        }),
        Story::new("notifications-settings-failed", |_, window, cx| {
            settings_story(
                failed(),
                NotificationSettings::default(),
                |_, _, _| {},
                window,
                cx,
            )
        }),
        Story::new("notifications-settings-default", |_, window, cx| {
            settings_story(
                LoadState::Ready,
                NotificationSettings::default(),
                |_, _, _| {},
                window,
                cx,
            )
        }),
        Story::new("notifications-settings-schedule", |_, window, cx| {
            settings_story(LoadState::Ready, schedule(), |_, _, _| {}, window, cx)
        }),
        Story::new("notifications-settings-dirty", |_, window, cx| {
            settings_story(
                LoadState::Ready,
                NotificationSettings::default(),
                |section, _, cx| {
                    section.edit(cx, |draft| {
                        draft.play_sound = false;
                        draft.default_level = NotifyLevel::Muted;
                        draft.dm_notifications = false;
                    })
                },
                window,
                cx,
            )
        }),
        Story::new("notifications-settings-bad-time", |_, window, cx| {
            settings_story(
                LoadState::Ready,
                schedule(),
                |section, window, cx| {
                    section
                        .start
                        .update(cx, |field, cx| field.set_value("25:00", window, cx));
                    section.form.set_time(true, "25:00");
                    cx.notify();
                },
                window,
                cx,
            )
        }),
    ]
}
